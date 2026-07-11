# Tour Gallery — Required R2 CORS Policy (production-blocking)

## Why this exists

Tour Gallery uploads go **directly from the browser to Cloudflare R2** with
presigned URLs (the GOS server never carries media bytes — project decision).
Browsers send a CORS preflight (`OPTIONS`) before every cross-origin `PUT`.
**If the bucket has no CORS policy, R2 answers 403 with no CORS headers and the
browser blocks every upload** — staff, guide portal, and customer page all fail
the same way (the UI shows "החיבור לאחסון נכשל — בעיית רשת או חסימת אבטחה (CORS)").

This was verified against production on 2026-07-11:
server-side presigned PUT → **200 OK** (credentials/signature fine);
browser-equivalent preflight from `https://app.grafitiyul.co.il` → **403, no
CORS headers** (no bucket policy).

## Required policy

Cloudflare dashboard → **R2 → bucket `grafitiyul-os` → Settings → CORS policy**
→ paste exactly:

```json
[
  {
    "AllowedOrigins": ["https://app.grafitiyul.co.il", "http://localhost:5173"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Notes:
- `localhost:5173` is the Vite dev server; remove it if local-dev uploads
  against the production bucket are not wanted.
- No `DELETE`/`POST` is exposed to browsers — deletion and multipart
  create/complete happen server-side only.
- CORS origins are not a security boundary here (presigned URLs are the
  capability); the policy only tells browsers the requests are expected.

Alternatively, with an R2 API token that has **Admin (bucket settings)**
permission in the env, run:

```
node server/scripts/setup-r2-cors.mjs --apply
```

(The current production token is object-scoped read/write and gets
`AccessDenied` on bucket settings — that is fine and intentional; use the
dashboard.)

## Verifying after applying

Any ONE of:

1. **Admin API (recommended):** `POST /api/tour-gallery/self-test`
   (admin-authed). Expect `{ serverPut: "ok", corsPreflight: "ok", ready: true }`.
2. **Server logs on boot:** the gallery worker probes readiness at startup and
   logs `[tour-gallery] upload readiness: OK` — or a loud
   `⚠️ UPLOADS WILL FAIL` line naming the failing leg.
3. **Manually:** upload one photo from the staff gallery and one from a
   customer `/g/<token>` page.

CORS changes on R2 propagate within ~a minute; also note browsers cache
preflight results up to `MaxAgeSeconds`, so retry in a fresh tab after fixing.
