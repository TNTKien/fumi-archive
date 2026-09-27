const UPLOAD_URL = "https://ads.tiktok.com/instant_page/api/v1/file/upload/";
const REFERER = "https://ads.tiktok.com/instant_page/editor/main";
const ORIGIN = "https://ads.tiktok.com";
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const DEFAULT_CDN = "p21-ad-sg.ibyteimg.com";
const MAX_BYTES = 2 * 1024 * 1024;
const DAILY_LIMIT = 50;

export async function handleSpotsRequest(request, url, env, ctx) {
  if (url.pathname === "/api/spots/config" && request.method === "GET") {
    return json({
      success: true,
      turnstileSiteKey: env.TURNSTILE_SITE_KEY || "",
      protomapsApiKey: env.PROTOMAPS_API_KEY || ""
    });
  }

  if (url.pathname === "/api/spots/location-fallback" && request.method === "GET") {
    return getNetworkLocation(request);
  }

  if (url.pathname === "/api/spots" && request.method === "GET") {
    return listSpots(url, env);
  }

  if (url.pathname === "/api/spots" && request.method === "POST") {
    return createSpot(request, url, env, ctx);
  }

  return json({ success: false, error: "Spot route not found." }, 404);
}

function getNetworkLocation(request) {
  const cf = request.cf || {};
  const latitude = Number(cf.latitude);
  const longitude = Number(cf.longitude);

  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return json(
      { success: false, error: "Network location is unavailable." },
      503
    );
  }

  return json({
    success: true,
    location: {
      latitude,
      longitude,
      city: cf.city || "",
      region: cf.region || "",
      countryCode: cf.country || ""
    }
  });
}

async function listSpots(url, env) {
  const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get("limit")) || 500));
  const west = numberParam(url, "west", -180, 180);
  const east = numberParam(url, "east", -180, 180);
  const south = numberParam(url, "south", -90, 90);
  const north = numberParam(url, "north", -90, 90);

  let statement;

  if (west !== null && east !== null && south !== null && north !== null) {
    if (west <= east) {
      statement = env.DB.prepare(
        "SELECT * FROM spots WHERE status='published' AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ? ORDER BY created_at DESC LIMIT ?"
      ).bind(south, north, west, east, limit);
    } else {
      statement = env.DB.prepare(
        "SELECT * FROM spots WHERE status='published' AND latitude BETWEEN ? AND ? AND (longitude >= ? OR longitude <= ?) ORDER BY created_at DESC LIMIT ?"
      ).bind(south, north, west, east, limit);
    }
  } else {
    statement = env.DB.prepare(
      "SELECT * FROM spots WHERE status='published' ORDER BY created_at DESC LIMIT ?"
    ).bind(limit);
  }

  const [{ results = [] }, countRow] = await Promise.all([
    statement.all(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM spots WHERE status='published'").first()
  ]);

  return json({
    success: true,
    total: Number(countRow?.total) || 0,
    spots: results.map(toSpot)
  });
}

async function createSpot(request, url, env, ctx) {
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) {
    return json({ success: false, error: "Cross-origin spot creation is not allowed." }, 403);
  }

  if (!env.UPLOAD_SESSION || !env.UPLOAD_CSRF) {
    return json({ success: false, error: "Upload session is not configured." }, 503);
  }

  if (!env.TURNSTILE_SECRET || !env.TURNSTILE_SITE_KEY || !env.RATE_LIMIT_SALT) {
    return json({ success: false, error: "Spot protection is not configured." }, 503);
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const burst = await env.UPLOAD_RATE_LIMITER.limit({ key: "spot:" + ip });

  if (!burst.success) {
    return json(
      { success: false, error: "Too many spot submissions. Please try again in a minute." },
      429,
      { "retry-after": "60" }
    );
  }

  const form = await request.formData();
  const token = stringField(form, "cf-turnstile-response");
  const displayName = stringField(form, "displayName").trim();
  const title = stringField(form, "title").trim();
  const description = stringField(form, "description").trim();
  const locationMode = stringField(form, "locationMode");
  const locationSource = stringField(form, "locationSource");
  const city = stringField(form, "city").trim();
  const country = stringField(form, "country").trim();
  const file = form.get("file");
  const rawLatitude = Number(form.get("latitude"));
  const rawLongitude = Number(form.get("longitude"));

  if (!token || token.length > 2048) {
    return json({ success: false, error: "Please complete the verification challenge." }, 400);
  }

  const verification = await verifyTurnstile(token, ip, env.TURNSTILE_SECRET);
  if (
    !verification.success ||
    verification.action !== "spot" ||
    verification.hostname !== url.hostname
  ) {
    return json({ success: false, error: "Verification failed. Please try again." }, 403);
  }

  if (displayName.length < 2 || displayName.length > 40) {
    return json({ success: false, error: "Display name must be 2–40 characters." }, 400);
  }

  if (title.length < 2 || title.length > 100) {
    return json({ success: false, error: "Title must be 2–100 characters." }, 400);
  }

  if (description.length > 1000) {
    return json({ success: false, error: "Description must be 1000 characters or fewer." }, 400);
  }

  if (!["exact", "approximate", "city"].includes(locationMode)) {
    return json({ success: false, error: "Invalid location privacy mode." }, 400);
  }

  if (!["device", "network"].includes(locationSource)) {
    return json({ success: false, error: "Invalid location source." }, 400);
  }

  if (locationMode === "exact" && locationSource !== "device") {
    return json(
      { success: false, error: "Exact location requires device geolocation." },
      400
    );
  }

  if (
    !Number.isFinite(rawLatitude) ||
    rawLatitude < -90 ||
    rawLatitude > 90 ||
    !Number.isFinite(rawLongitude) ||
    rawLongitude < -180 ||
    rawLongitude > 180
  ) {
    return json({ success: false, error: "A valid current location is required." }, 400);
  }

  if (locationMode === "city" && !city) {
    return json({ success: false, error: "City-only mode requires a detected city." }, 400);
  }

  if (!(file instanceof File)) {
    return json({ success: false, error: "Spot image is required." }, 400);
  }

  if (file.size <= 0 || file.size > MAX_BYTES) {
    return json({ success: false, error: "Image must be 2 MB or smaller." }, 413);
  }

  const kind = await sniff(file);
  if (!kind) {
    return json({ success: false, error: "Only real JPEG and PNG files are accepted." }, 400);
  }

  const actorHash = await hashActor(ip, env.RATE_LIMIT_SALT);
  const allowed = await consumeDailyQuota(env.DB, actorHash);

  if (!allowed) {
    return json(
      { success: false, error: "Daily upload limit reached. Please try again tomorrow." },
      429
    );
  }

  const uploaded = await uploadToTikTok(file, kind, env);

  if (uploaded.authExpired) {
    ctx.waitUntil(
      markTikTokSessionExpired(
        env,
        uploaded.error || "TikTok rejected the authenticated session.",
        url.origin
      )
    );

    return json(
      { success: false, error: "Upload service authentication expired. Please try again later." },
      503
    );
  }

  if (!uploaded.success) {
    return json({ success: false, error: uploaded.error || "TikTok rejected the upload." }, 502);
  }

  const [latitude, longitude] = privatizeLocation(
    rawLatitude,
    rawLongitude,
    locationMode
  );
  const createdAt = new Date().toISOString();
  const id = crypto.randomUUID();
  const locationName = [city, country].filter(Boolean).join(", ");

  await env.DB.prepare(
    "INSERT INTO spots (id,display_name,title,description,direct_url,src_url,storage_uri,mime_type,bytes,width,height,latitude,longitude,location_mode,location_name,city,country,created_at,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'published')"
  ).bind(
    id,
    displayName,
    title,
    description || null,
    uploaded.directUrl,
    uploaded.srcUrl,
    uploaded.storageUri,
    kind.type,
    uploaded.bytes,
    uploaded.width,
    uploaded.height,
    latitude,
    longitude,
    locationMode,
    locationName || null,
    city || null,
    country || null,
    createdAt
  ).run();

  ctx.waitUntil(markTikTokSessionHealthy(env, url.origin));

  return json({
    success: true,
    spot: {
      id,
      displayName,
      title,
      description: description || null,
      directUrl: uploaded.directUrl,
      srcUrl: uploaded.srcUrl,
      bytes: uploaded.bytes,
      width: uploaded.width,
      height: uploaded.height,
      latitude,
      longitude,
      locationMode,
      locationName: locationName || null,
      city: city || null,
      country: country || null,
      createdAt
    }
  }, 201);
}

async function uploadToTikTok(file, kind, env) {
  const name = crypto.randomUUID() + kind.ext;
  const upstreamBody = new FormData();
  upstreamBody.append("name", name);
  upstreamBody.append("file", new File([file], name, { type: kind.type }), name);

  let upstream;
  try {
    upstream = await fetch(UPLOAD_URL, {
      method: "POST",
      headers: {
        accept: "application/json, text/plain, */*",
        cookie: env.UPLOAD_SESSION,
        "x-csrftoken": env.UPLOAD_CSRF,
        referer: REFERER,
        origin: ORIGIN
      },
      body: upstreamBody
    });
  } catch {
    return { success: false, authExpired: false, error: "TikTok upload request failed." };
  }

  const text = await upstream.text();

  if (isTikTokLoginResponse(upstream.status, text)) {
    return {
      success: false,
      authExpired: true,
      error: "TikTok returned an authentication/login response."
    };
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return { success: false, authExpired: false, error: "TikTok returned an unreadable response." };
  }

  if (
    !payload ||
    payload.code !== 0 ||
    payload.message !== "success" ||
    typeof payload.data?.src !== "string"
  ) {
    return {
      success: false,
      authExpired: looksLikeTikTokAuthError(payload),
      error: payload?.message || payload?.msg || "TikTok rejected the upload."
    };
  }

  const srcUrl = payload.data.src;
  const storageUri = extractUri(srcUrl);
  const cdnHost = env.TIKTOK_DIRECT_CDN_HOST || DEFAULT_CDN;

  return {
    success: true,
    authExpired: false,
    srcUrl,
    storageUri,
    directUrl: "https://" + cdnHost + "/obj/" + storageUri,
    bytes: Number(payload.data.size) || file.size,
    width: Number(payload.data.width) || null,
    height: Number(payload.data.height) || null
  };
}

function privatizeLocation(latitude, longitude, mode) {
  const step = mode === "exact" ? 0.000001 : mode === "approximate" ? 0.005 : 0.05;
  return [snap(latitude, step), snap(longitude, step)];
}

function snap(value, step) {
  return Number((Math.round(value / step) * step).toFixed(6));
}

function numberParam(url, name, min, max) {
  if (!url.searchParams.has(name)) return null;
  const value = Number(url.searchParams.get(name));
  if (!Number.isFinite(value) || value < min || value > max) return null;
  return value;
}

function stringField(form, name) {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function toSpot(row) {
  return {
    id: row.id,
    displayName: row.display_name,
    title: row.title,
    description: row.description,
    directUrl: row.direct_url,
    srcUrl: row.src_url,
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    latitude: row.latitude,
    longitude: row.longitude,
    locationMode: row.location_mode,
    locationName: row.location_name,
    city: row.city,
    country: row.country,
    createdAt: row.created_at
  };
}

async function verifyTurnstile(token, ip, secret) {
  try {
    const body = new URLSearchParams({ secret, response: token, remoteip: ip });
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) return { success: false };
    return await response.json();
  } catch {
    return { success: false };
  }
}

async function hashActor(ip, salt) {
  const bytes = new TextEncoder().encode(salt + ":" + ip);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function consumeDailyQuota(db, actorHash) {
  const day = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();

  await db.prepare(
    "INSERT OR IGNORE INTO upload_quotas (day, actor_hash, count, updated_at) VALUES (?, ?, 0, ?)"
  ).bind(day, actorHash, now).run();

  const row = await db.prepare(
    "UPDATE upload_quotas SET count = count + 1, updated_at = ? WHERE day = ? AND actor_hash = ? AND count < ? RETURNING count"
  ).bind(now, day, actorHash, DAILY_LIMIT).first();

  return Boolean(row);
}

async function sniff(file) {
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { type: "image/jpeg", ext: ".jpg" };
  }

  const png = [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a];
  if (png.every((value, index) => bytes[index] === value)) {
    return { type: "image/png", ext: ".png" };
  }

  return null;
}

function extractUri(src) {
  const parsed = new URL(src);
  const pathname = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
  const uri = pathname.split("~")[0];
  if (!uri || !uri.includes("/")) throw new Error("Unable to parse TikTok image URI.");
  return uri;
}

function isTikTokLoginResponse(status, text) {
  if (status === 401 || status === 403) return true;
  return /<!doctype|<html/i.test(text) && /login|sign in|passport|session|tiktok/i.test(text);
}

function looksLikeTikTokAuthError(payload) {
  const message = String(payload?.message || payload?.msg || "").toLowerCase();
  return (
    message.includes("login") ||
    message.includes("session") ||
    message.includes("csrf") ||
    message.includes("unauthorized") ||
    message.includes("authentication")
  );
}

async function markTikTokSessionExpired(env, reason, siteOrigin) {
  const now = new Date().toISOString();
  const safeReason = String(reason || "Authentication failed").slice(0, 500);

  await env.DB.prepare(
    "INSERT OR IGNORE INTO service_state (key,status,changed_at,alerted_at,last_error) VALUES ('tiktok_session','healthy',?,NULL,NULL)"
  ).bind(now).run();

  await env.DB.prepare(
    "UPDATE service_state SET status='expired', changed_at=?, alerted_at=NULL, last_error=? WHERE key='tiktok_session' AND status!='expired'"
  ).bind(now, safeReason).run();

  await env.DB.prepare(
    "UPDATE service_state SET last_error=? WHERE key='tiktok_session' AND status='expired'"
  ).bind(safeReason).run();

  const state = await env.DB.prepare(
    "SELECT status, alerted_at FROM service_state WHERE key='tiktok_session'"
  ).first();

  if (state?.status !== "expired" || state?.alerted_at) return;

  const sent = await sendDiscordAlert(env, {
    title: "TikTok upload session expired",
    description:
      "Fumi Archive can no longer authenticate uploads to TikTok. New uploads are temporarily unavailable.",
    color: 15158332,
    fields: [
      { name: "Site", value: siteOrigin, inline: false },
      { name: "Reason", value: safeReason, inline: false },
      { name: "Detected", value: now, inline: false }
    ]
  });

  if (sent) {
    await env.DB.prepare(
      "UPDATE service_state SET alerted_at=? WHERE key='tiktok_session' AND status='expired' AND alerted_at IS NULL"
    ).bind(now).run();
  }
}

async function markTikTokSessionHealthy(env, siteOrigin) {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    "UPDATE service_state SET status='healthy', changed_at=?, alerted_at=NULL, last_error=NULL WHERE key='tiktok_session' AND status='expired' RETURNING key"
  ).bind(now).first();

  if (!result) return;

  await sendDiscordAlert(env, {
    title: "TikTok upload session recovered",
    description: "Fumi Archive successfully authenticated an upload to TikTok again.",
    color: 5763719,
    fields: [
      { name: "Site", value: siteOrigin, inline: false },
      { name: "Recovered", value: now, inline: false }
    ]
  });
}

async function sendDiscordAlert(env, embed) {
  if (!env.DISCORD_WEBHOOK_URL) return false;

  try {
    const response = await fetch(env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "Fumi Archive",
        allowed_mentions: { parse: [] },
        embeds: [{ ...embed, timestamp: new Date().toISOString() }]
      }),
      signal: AbortSignal.timeout(10000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders
    }
  });
}
