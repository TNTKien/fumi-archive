import { createRemoteJWKSet, jwtVerify } from "jose";
import { handleSpotsRequest } from "./spots.js";

const UPLOAD_URL = "https://ads.tiktok.com/instant_page/api/v1/file/upload/";
const REFERER = "https://ads.tiktok.com/instant_page/editor/main";
const ORIGIN = "https://ads.tiktok.com";
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const DEFAULT_CDN = "p21-ad-sg.ibyteimg.com";
const MAX_BYTES = 2 * 1024 * 1024;
const DAILY_LIMIT = 50;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/config" && request.method === "GET") {
      return json({
        success: true,
        turnstileSiteKey: env.TURNSTILE_SITE_KEY || "",
        limits: { perMinute: 5, perDay: DAILY_LIMIT }
      });
    }

    if (url.pathname === "/api/status" && request.method === "GET") {
      return getPublicStatus(env);
    }

    if (url.pathname === "/spots") {
      return Response.redirect(url.origin + "/spots/", 302);
    }

    if (url.pathname === "/api/spots" || url.pathname.startsWith("/api/spots/")) {
      return handleSpotsRequest(request, url, env, ctx);
    }

    if (url.pathname === "/api/images" && request.method === "GET") {
      return listImages(url, env);
    }

    if (url.pathname === "/api/images" && request.method === "POST") {
      return uploadImage(request, url, env, ctx);
    }

    if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
      const auth = await requireAdmin(request, env);
      if (auth instanceof Response) return auth;

      if (url.pathname === "/admin") {
        return Response.redirect(url.origin + "/admin/", 302);
      }

      return env.ASSETS.fetch(request);
    }

    if (url.pathname.startsWith("/api/admin/")) {
      const auth = await requireAdmin(request, env);
      if (auth instanceof Response) return auth;

      if (url.pathname === "/api/admin/images" && request.method === "GET") {
        return listAdminImages(url, env, auth);
      }

      if (url.pathname === "/api/admin/discord/test" && request.method === "POST") {
        return sendDiscordTest(url, env, auth);
      }

      const match = url.pathname.match(/^\/api\/admin\/images\/([^/]+)\/status$/);
      if (match && request.method === "PATCH") {
        return updateImageStatus(request, url, env, decodeURIComponent(match[1]), auth);
      }

      return json({ success: false, error: "Admin route not found." }, 404);
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ success: false, error: "Not found" }, 404);
    }

    return env.ASSETS.fetch(request);
  }
};

async function requireAdmin(request, env) {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !env.ADMIN_EMAIL) {
    return json({ success: false, error: "Admin access is not configured." }, 503);
  }

  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) {
    return json({ success: false, error: "Cloudflare Access authentication required." }, 401);
  }

  try {
    const issuer = normalizeAccessIssuer(env.ACCESS_TEAM_DOMAIN);
    const jwks = createRemoteJWKSet(new URL(issuer + "/cdn-cgi/access/certs"));
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: env.ACCESS_AUD
    });

    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
    const expectedEmail = env.ADMIN_EMAIL.trim().toLowerCase();

    if (!email || email !== expectedEmail) {
      return json({ success: false, error: "Admin access denied." }, 403);
    }

    return { email };
  } catch (error) {
    console.error("Access JWT verification failed", error);
    return json({ success: false, error: "Invalid Cloudflare Access session." }, 401);
  }
}

function normalizeAccessIssuer(value) {
  const raw = String(value || "").trim().replace(/\/$/, "");
  if (raw.startsWith("https://")) return raw;
  return "https://" + raw;
}

async function sendDiscordTest(url, env, auth) {
  const sent = await sendDiscordAlert(env, {
    title: "Discord webhook test",
    description: "This is a manual test message from the Fumi Archive admin panel.",
    color: 5793266,
    fields: [
      { name: "Site", value: url.origin, inline: false },
      { name: "Triggered by", value: auth.email, inline: false },
      { name: "Time", value: new Date().toISOString(), inline: false }
    ]
  });

  if (!sent) {
    return json({ success: false, error: "Discord webhook test failed." }, 502);
  }

  return json({ success: true });
}

async function listAdminImages(url, env, auth) {
  const requestedLimit = Number(url.searchParams.get("limit")) || 60;
  const limit = Math.max(1, Math.min(100, requestedLimit));
  const status = url.searchParams.get("status") || "all";

  let statement;

  if (status === "published" || status === "hidden") {
    statement = env.DB.prepare(
      "SELECT id,direct_url,src_url,mime_type,bytes,width,height,created_at,status FROM images WHERE status = ? ORDER BY created_at DESC LIMIT ?"
    ).bind(status, limit);
  } else {
    statement = env.DB.prepare(
      "SELECT id,direct_url,src_url,mime_type,bytes,width,height,created_at,status FROM images ORDER BY created_at DESC LIMIT ?"
    ).bind(limit);
  }

  const { results = [] } = await statement.all();

  return json({
    success: true,
    admin: auth.email,
    images: results.map(toAdminImage)
  });
}

async function updateImageStatus(request, url, env, id, auth) {
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) {
    return json({ success: false, error: "Cross-origin admin actions are not allowed." }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: "Invalid JSON body." }, 400);
  }

  const status = body?.status;
  if (status !== "published" && status !== "hidden") {
    return json({ success: false, error: "Status must be published or hidden." }, 400);
  }

  const result = await env.DB.prepare(
    "UPDATE images SET status = ? WHERE id = ?"
  ).bind(status, id).run();

  if (!result.meta?.changes) {
    return json({ success: false, error: "Image not found." }, 404);
  }

  console.log("Admin image status changed", {
    admin: auth.email,
    imageId: id,
    status
  });

  return json({ success: true, id, status });
}

async function getPublicStatus(env) {
  const configured = Boolean(
    env.UPLOAD_SESSION &&
    env.UPLOAD_CSRF &&
    env.TURNSTILE_SECRET &&
    env.TURNSTILE_SITE_KEY &&
    env.RATE_LIMIT_SALT
  );

  if (!configured) {
    return json({ success: true, uploadAvailable: false });
  }

  try {
    const state = await env.DB.prepare(
      "SELECT status FROM service_state WHERE key='tiktok_session'"
    ).first();

    return json({
      success: true,
      uploadAvailable: state?.status !== "expired"
    });
  } catch (error) {
    console.error("Could not read TikTok session state", error);
    return json({ success: true, uploadAvailable: false });
  }
}

async function listImages(url, env) {
  const limit = Math.max(1, Math.min(60, Number(url.searchParams.get("limit")) || 36));
  const cursor = url.searchParams.get("cursor");

  const statement = cursor
    ? env.DB.prepare(
        "SELECT id,direct_url,src_url,mime_type,bytes,width,height,created_at FROM images WHERE status='published' AND created_at < ? ORDER BY created_at DESC LIMIT ?"
      ).bind(cursor, limit)
    : env.DB.prepare(
        "SELECT id,direct_url,src_url,mime_type,bytes,width,height,created_at FROM images WHERE status='published' ORDER BY created_at DESC LIMIT ?"
      ).bind(limit);

  const [{ results = [] }, countRow] = await Promise.all([
    statement.all(),
    env.DB.prepare(
      "SELECT COUNT(*) AS total FROM images WHERE status='published'"
    ).first()
  ]);

  return json({
    success: true,
    total: Number(countRow?.total) || 0,
    images: results.map((row) => ({
      id: row.id,
      directUrl: row.direct_url,
      srcUrl: row.src_url,
      mimeType: row.mime_type,
      bytes: row.bytes,
      width: row.width,
      height: row.height,
      createdAt: row.created_at
    })),
    nextCursor: results.length === limit ? results[results.length - 1].created_at : null
  });
}

async function uploadImage(request, url, env, ctx) {
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) {
    return json({ success: false, error: "Cross-origin uploads are not allowed." }, 403);
  }

  if (!env.UPLOAD_SESSION || !env.UPLOAD_CSRF) {
    return json({ success: false, error: "Upload session is not configured." }, 503);
  }

  if (!env.TURNSTILE_SECRET || !env.TURNSTILE_SITE_KEY || !env.RATE_LIMIT_SALT) {
    return json({ success: false, error: "Upload protection is not configured." }, 503);
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const burst = await env.UPLOAD_RATE_LIMITER.limit({ key: "upload:" + ip });

  if (!burst.success) {
    return json(
      { success: false, error: "Too many uploads. Please try again in a minute." },
      429,
      { "retry-after": "60" }
    );
  }

  const form = await request.formData();
  const token = form.get("cf-turnstile-response");
  const file = form.get("file");

  if (typeof token !== "string" || !token || token.length > 2048) {
    return json({ success: false, error: "Please complete the verification challenge." }, 400);
  }

  const verification = await verifyTurnstile(token, ip, env.TURNSTILE_SECRET);
  if (
    !verification.success ||
    verification.action !== "upload" ||
    verification.hostname !== url.hostname
  ) {
    return json({ success: false, error: "Verification failed. Please try again." }, 403);
  }

  if (!(file instanceof File)) {
    return json({ success: false, error: "Image file is required." }, 400);
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

  const name = crypto.randomUUID() + kind.ext;
  const upstreamBody = new FormData();
  upstreamBody.append("name", name);
  upstreamBody.append("file", new File([file], name, { type: kind.type }), name);

  const upstream = await fetch(UPLOAD_URL, {
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

  const text = await upstream.text();

  if (isTikTokLoginResponse(upstream.status, text)) {
    ctx.waitUntil(
      markTikTokSessionExpired(
        env,
        "TikTok returned an authentication/login response.",
        url.origin
      )
    );

    return json(
      { success: false, error: "Upload service authentication expired. Please try again later." },
      503
    );
  }

  let payload;

  try {
    payload = JSON.parse(text);
  } catch {
    return json({ success: false, error: "TikTok returned an unreadable response." }, 502);
  }

  if (
    !payload ||
    payload.code !== 0 ||
    payload.message !== "success" ||
    typeof payload.data?.src !== "string"
  ) {
    if (looksLikeTikTokAuthError(payload)) {
      ctx.waitUntil(
        markTikTokSessionExpired(
          env,
          payload?.message || payload?.msg || "TikTok rejected the authenticated session.",
          url.origin
        )
      );

      return json(
        { success: false, error: "Upload service authentication expired. Please try again later." },
        503
      );
    }

    return json(
      { success: false, error: payload?.message || "TikTok rejected the upload." },
      upstream.status >= 400 ? upstream.status : 502
    );
  }

  const srcUrl = payload.data.src;
  const storageUri = extractUri(srcUrl);
  const cdnHost = env.TIKTOK_DIRECT_CDN_HOST || DEFAULT_CDN;
  const directUrl = "https://" + cdnHost + "/obj/" + storageUri;
  const createdAt = new Date().toISOString();
  const id = crypto.randomUUID();

  await env.DB.prepare(
    "INSERT INTO images (id,direct_url,src_url,storage_uri,mime_type,bytes,width,height,created_at,status) VALUES (?,?,?,?,?,?,?,?,?,'published')"
  ).bind(
    id,
    directUrl,
    srcUrl,
    storageUri,
    kind.type,
    Number(payload.data.size) || file.size,
    Number(payload.data.width) || null,
    Number(payload.data.height) || null,
    createdAt
  ).run();

  ctx.waitUntil(markTikTokSessionHealthy(env, url.origin));

  return json({
    success: true,
    image: {
      id,
      directUrl,
      srcUrl,
      mimeType: kind.type,
      bytes: Number(payload.data.size) || file.size,
      width: Number(payload.data.width) || null,
      height: Number(payload.data.height) || null,
      createdAt
    }
  }, 201);
}

function isTikTokLoginResponse(status, text) {
  if (status === 401 || status === 403) return true;

  return (
    /<!doctype|<html/i.test(text) &&
    /login|sign in|passport|session|tiktok/i.test(text)
  );
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
  if (!env.DISCORD_WEBHOOK_URL) {
    console.warn("Discord webhook is not configured; skipping alert.");
    return false;
  }

  try {
    const response = await fetch(env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "Fumi Archive",
        allowed_mentions: { parse: [] },
        embeds: [
          {
            ...embed,
            timestamp: new Date().toISOString()
          }
        ]
      }),
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      console.error("Discord webhook failed", response.status, await response.text());
      return false;
    }

    return true;
  } catch (error) {
    console.error("Discord webhook request failed", error);
    return false;
  }
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

function toAdminImage(row) {
  return {
    id: row.id,
    directUrl: row.direct_url,
    srcUrl: row.src_url,
    mimeType: row.mime_type,
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    createdAt: row.created_at,
    status: row.status
  };
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
