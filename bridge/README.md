# gos-whatsapp-bridge

Baileys-backed WhatsApp bridge for Grafitiyul OS — a faithful port of the
proven Challenge System bridge, account-scoped.

**One Railway service = one WhatsApp number.** Both services
(`gos-whatsapp-main`, `gos-whatsapp-office`) run this exact code from this
repo; the ONLY difference is env vars. They share the GOS Postgres, and every
row they touch is scoped by `accountId` (no singleton assumptions).

The Baileys session (creds + signal keys) is persisted in Postgres
(`WhatsAppSession`), so a redeploy resumes the session without re-scanning a
QR. On WhatsApp's `loggedOut` signal the bridge **never** auto-wipes
credentials (deploy-overlap protection); wiping is an explicit admin action
(sign-out / hard-reset) from the GOS admin UI.

**This service never runs Prisma migrations.** The GOS server service owns
`prisma migrate deploy`; the bridge only generates a client from the same
schema file (`server/prisma/schema.prisma`) at install time — one schema
source of truth.

## Railway setup (per bridge service)

Both services point at the SAME GitHub repo.

| Setting | Value |
|---|---|
| Root Directory | *(repo root — leave empty)* |
| Build Command | `cd bridge && npm install` |
| Start Command | `cd bridge && npm start` |
| Watch Paths (optional) | `bridge/**`, `server/prisma/schema.prisma` |
| Healthcheck path (optional) | `/health` |

`npm install` runs the `postinstall` hook → `prisma generate --schema
../server/prisma/schema.prisma` (this is why Root Directory must stay the repo
root: the schema lives outside `bridge/`).

### Environment variables — gos-whatsapp-main

```
DATABASE_URL            = (same Postgres as the GOS server)
WHATSAPP_ACCOUNT_ID     = main
WHATSAPP_ACCOUNT_LABEL  = מספר ראשי          (optional; first-boot label only)
BRIDGE_INTERNAL_SECRET  = <long random secret, shared with the GOS server>
PORT                    = 3000
```

### Environment variables — gos-whatsapp-office

```
DATABASE_URL            = (same Postgres)
WHATSAPP_ACCOUNT_ID     = office
WHATSAPP_ACCOUNT_LABEL  = מספר משרד          (optional)
BRIDGE_INTERNAL_SECRET  = <same secret>
PORT                    = 3000
```

`PORT=3000` is set EXPLICITLY so the listen port always matches the `:3000`
in the GOS server's `WHATSAPP_BRIDGE_URLS` — never rely on an injected PORT
for private-only services.

**Only `WHATSAPP_ACCOUNT_ID` / `WHATSAPP_ACCOUNT_LABEL` differ between the two
services.** Everything else is identical.

Optional tunables (defaults in parentheses): `PORT` (3000),
`BRIDGE_HTTP_HOST` (`::` — IPv6 wildcard, required for Railway private
networking), `BRIDGE_RECONNECT_MIN_MS` (1000), `BRIDGE_RECONNECT_MAX_MS`
(60000), `BRIDGE_RECONNECT_HEALTHY_MS` (300000), `LOG_LEVEL` (info).

### GOS server variables (the main service)

```
WHATSAPP_BRIDGE_URLS   = main=http://gos-whatsapp-main.railway.internal:3000,office=http://gos-whatsapp-office.railway.internal:3000
WHATSAPP_BRIDGE_SECRET = <the same BRIDGE_INTERNAL_SECRET value>
```

### Networking

- GOS server → bridges over Railway **private networking**
  (`<service>.railway.internal`). Both services must be in the same Railway
  project/environment. The bridges need **no public domain** — do not expose
  one.
- The bridge binds `::` (IPv6) because Railway's internal network routes over
  IPv6; binding 0.0.0.0 makes GOS→bridge fetches hang until timeout.
- All bridge endpoints except `/health` require
  `Authorization: Bearer <BRIDGE_INTERNAL_SECRET>`.

## HTTP API (Slice 1)

| Endpoint | Purpose |
|---|---|
| `GET /health` | Honest health: 200 = restart would NOT help (healthy / boot grace / reconnecting / waiting on QR); 503 = restart MIGHT help. No auth. |
| `GET /status` | Persisted account row + live readiness snapshot + QR as data URL. |
| `POST /restart-socket` | Rebuild the socket, KEEP the session (zombie recovery). |
| `POST /hard-reset-session` | Wipe the session + fresh QR (corrupt session). |
| `POST /sign-out` | Unlink the device on WhatsApp's side + wipe the session. |

## Pairing a number

1. Deploy the bridge service → it creates its `WhatsAppAccount` row and,
   having no creds, emits a QR.
2. In GOS: הגדרות → תקשורת → the account card shows the QR.
3. On the phone: WhatsApp → Settings → Linked Devices → Link a Device → scan.
4. The card flips to מחובר; from now on redeploys resume the session
   automatically.

## Local development

```
cd bridge
npm install
# .env (or shell env): DATABASE_URL, WHATSAPP_ACCOUNT_ID=main, BRIDGE_INTERNAL_SECRET=dev-secret
npm run dev
```
