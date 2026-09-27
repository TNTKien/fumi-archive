# Fumi Archive

A small public archive for Fumo and plushie photos, with an optional world map for location-based **Fumi Spots**.

## Features

- Public image gallery with anonymous uploads
- JPEG/PNG uploads with Cloudflare Turnstile and rate limiting
- Fumi Spots map with title, display name, optional description, and location privacy modes:
  - Exact
  - Approximate
  - City only
- MapLibre + Protomaps basemap with disputed/maritime boundary layers omitted
- Light and dark themes
- Admin moderation protected by Cloudflare Access
- Discord webhook alerts when the TikTok upload session expires or recovers

Images are uploaded through TikTok Ads' Instant Page upload endpoint and served from ByteDance CDN. This is an undocumented internal endpoint and may change without notice.

## Tech Stack

- React 19 + TypeScript
- Vite
- ReEnd Components
- Cloudflare Workers
- Cloudflare D1
- Cloudflare Turnstile
- Cloudflare Access
- Cloudflare Workers Rate Limiting
- MapLibre GL JS
- Protomaps
- TikTok / ByteDance CDN
- Discord Webhooks

## Deployment

Install dependencies:

```bash
npm install
```

Create/configure the required Cloudflare resources in `wrangler.jsonc`:

- D1 database bound as `DB`
- Rate limiter bound as `UPLOAD_RATE_LIMITER`
- Turnstile site key as `TURNSTILE_SITE_KEY`

Configure the required Worker secrets:

```bash
npx wrangler secret put UPLOAD_SESSION
npx wrangler secret put UPLOAD_CSRF
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put RATE_LIMIT_SALT
npx wrangler secret put PROTOMAPS_API_KEY
```

Optional/admin secrets:

```bash
npx wrangler secret put DISCORD_WEBHOOK_URL
npx wrangler secret put ACCESS_TEAM_DOMAIN
npx wrangler secret put ACCESS_AUD
npx wrangler secret put ADMIN_EMAIL
```

Apply D1 migrations:

```bash
npm run db:migrate:remote
```

Build and deploy:

```bash
npm run deploy
```

For local development:

```bash
npm run frontend:dev
```
