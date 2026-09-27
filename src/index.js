const UPLOAD_URL = "https://ads.tiktok.com/instant_page/api/v1/file/upload/";
const REFERER = "https://ads.tiktok.com/instant_page/editor/main";
const ORIGIN = "https://ads.tiktok.com";
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const DEFAULT_CDN = "p21-ad-sg.ibyteimg.com";
const MAX_BYTES = 2 * 1024 * 1024;
const DAILY_LIMIT = 50;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/config" && request.method === "GET") {
      return json({
        success: true,
        turnstileSiteKey: env.TURNSTILE_SITE_KEY || "",
        limits: {
          perMinute: 5,
          perDay: DAILY_LIMIT
        }
      });
    }

    if (url.pathname === "/api/images" && request.method === "GET") {
      return listImages(url, env);
    }

    if (url.pathname === "/api/images" && request.method === "POST") {
      return uploadImage(request, url, env);
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ success: false, error: "Not found" }, 404);
    }

    return env.ASSETS.fetch(request);
  }
};

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

  const { results = [] } = await statement.all();

  return json({
    success: true,
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

async function uploadImage(request, url, env) {
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
  let payload;

  try {
    payload = JSON.parse(text);
  } catch {
    return json({ success: false, error: "TikTok returned an unreadable response." }, 502);
  }

  if (
    upstream.status === 401 ||
    upstream.status === 403 ||
    !payload ||
    payload.code !== 0 ||
    payload.message !== "success" ||
    typeof payload.data?.src !== "string"
  ) {
    return json(
      {
        success: false,
        error: payload?.message || "TikTok rejected the upload."
      },
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

  return json(
    {
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
    },
    201
  );
}

async function verifyTurnstile(token, ip, secret) {
  try {
    const body = new URLSearchParams({
      secret,
      response: token,
      remoteip: ip
    });

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
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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

function assertSameOrigin(request, url) {
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) {
    const error = new Error("Cross-origin uploads are not allowed.");
    error.status = 403;
    throw error;
  }
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
