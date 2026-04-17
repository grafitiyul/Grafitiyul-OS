# Grafitiyul OS

A future business operating system for the company.
This repository is the clean foundation — no business features yet.

## Structure

```
grafitiyul-os/
├── package.json        # root orchestration (install / build / start)
├── client/             # React + Vite frontend
└── server/             # Node.js + Express + Prisma backend
                        # also serves the built client in production
```

## Deployment Model

**Single Railway service.** The Express server serves both:
- the API (e.g. `GET /health`)
- the built client static files from `client/dist`

During local development the client still runs on Vite (`npm run dev:client`)
for hot reload, and the server runs separately (`npm run dev:server`).

## Tech Stack

- **Frontend:** React 18 + Vite
- **Backend:** Node.js + Express
- **Database:** PostgreSQL
- **ORM:** Prisma

## Local Development

From the repo root:

```bash
npm install                 # installs root, server, and client deps
cp server/.env.example server/.env
# edit server/.env and set DATABASE_URL
```

Run the two dev processes in separate terminals:

```bash
npm run dev:server          # http://localhost:4000
npm run dev:client          # http://localhost:5173
```

### Production-like run (local)

```bash
npm run build               # builds client + runs prisma generate
npm start                   # server serves API + client/dist
# -> http://localhost:4000
```

## Scripts (root)

| Script              | What it does                                              |
| ------------------- | --------------------------------------------------------- |
| `npm install`       | Installs root deps, then server deps, then client deps    |
| `npm run build`     | Builds the React client, then runs `prisma generate`      |
| `npm start`         | Starts the Express server (serves API + `client/dist`)    |
| `npm run dev:server`| Runs server with `node --watch`                           |
| `npm run dev:client`| Runs Vite dev server                                      |

## Railway Configuration

Deploy **one** service from the repo root:

1. **Create a new Railway project** and connect it to this GitHub repo.
2. **Root Directory:** leave as `/` (the repo root).
3. **Build Command:** `npm install && npm run build`
4. **Start Command:** `npm start`
5. **Attach a PostgreSQL plugin** — Railway will inject `DATABASE_URL` automatically.
6. **Environment variables** (Railway Dashboard → Variables):
   - `DATABASE_URL` → from the Postgres plugin (auto)
   - `PORT` → Railway injects this; the server already reads `process.env.PORT`
7. **Generate a public domain** for the service — that URL serves both the API and the UI.

When a Prisma schema change is added later, extend the Start Command to:
```
npx prisma migrate deploy --schema=server/prisma/schema.prisma && npm start
```

## Environment Variables Reference

**server/.env**
- `PORT` — defaults to `4000`. Railway overrides this automatically.
- `DATABASE_URL` — PostgreSQL connection string.

**client/.env** — not required in the single-service setup (same origin).
