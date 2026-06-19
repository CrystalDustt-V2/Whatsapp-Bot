# Northflank Deployment Guide

This project should be split into two deployable parts:

- Bot backend on Northflank: runs `node dist/index.js`, keeps the Baileys WhatsApp socket alive, exposes the bot API/Socket.IO dashboard API.
- Dashboard on Vercel later: runs the Next.js UI and points `NEXT_PUBLIC_BOT_API_URL` to the Northflank backend URL.

Do not deploy the Baileys bot worker to Vercel. The bot needs a persistent process and persistent auth files.

## What Changed For Deployment

- `PORT` is now configurable through env vars and defaults to `3001`.
- `/healthz` was added for platform health checks.
- `Dockerfile` now runs `npx prisma generate`, copies the generated Prisma client, and exposes `3001`.
- `.dockerignore` now excludes `.env`, `sessions/`, logs, build output, and dependencies from Docker build context.

## 1. Prepare The Repository

Make sure these files are committed/pushed:

- `Dockerfile`
- `.dockerignore`
- `package-lock.json`
- `package.json`
- `prisma/`
- `src/`
- `.env.example`

Do not commit:

- `.env`
- `sessions/`
- `logs/`
- `temp/`

Run locally before pushing:

```bash
npm run build
```

## 2. Create The Northflank Project

In Northflank:

1. Create a new project.
2. Create a new service from your Git repository.
3. Choose Dockerfile build.
4. Use the root directory of this repo as the build context.
5. Use `Dockerfile` as the Dockerfile path.

Recommended service type:

- Use a normal long-running service/container, not a job.
- Set replicas to `1`. Do not run multiple replicas for the same WhatsApp account/session.

## 3. Configure Ports

The bot API listens on:

```text
3001
```

Northflank port settings:

- Internal/container port: `3001`
- Public HTTP port: enabled if you want the dashboard/API reachable from browser
- Health check path: `/healthz`

Useful API routes after deploy:

- `/healthz`
- `/api/status`
- `/api/commands`
- `/api/auth/qr`

## 4. Add Persistent Volumes

The most important mount is the WhatsApp session directory.

Add persistent volumes:

```text
/app/sessions
/app/logs
/app/temp
```

Minimum required:

```text
/app/sessions
```

Without a persistent `/app/sessions` volume, every redeploy/restart may require scanning WhatsApp QR again.

## 5. Environment Variables

Add these Northflank env vars:

```env
NODE_ENV=production
PORT=3001
BOT_PREFIX=.
HANDLE_SELF_MESSAGES=true
HANDLE_INCOMING_MESSAGES=true
OWNER_NUMBER=628xxxxxxxxxx
OWNER_NAME=Your Name
DASHBOARD_URL=https://your-dashboard-domain.vercel.app
SESSION_PATH=/app/sessions
```

Optional content env vars:

```env
SCRIPT_URL=
DONATE_TEXT=
RULES_TEXT=
```

If using Postgres/Prisma:

```env
DATABASE_URL=postgresql://...
```

If using Redis:

```env
REDIS_HOST=...
REDIS_PORT=6379
REDIS_PASSWORD=...
```

At the current code state, Redis and Prisma are present in the project, but the bot startup does not require `connectDatabase()` and most commands do not require Redis. You can add them when you start enabling persisted reminders, economy, queues, or analytics.

## 6. Database Options

For Prisma/Postgres, use one of:

- Northflank Postgres addon
- Neon Postgres
- Supabase Postgres
- Any hosted Postgres with a connection URL

Then run migrations from your local machine or a one-off Northflank job:

```bash
npx prisma migrate deploy
```

Use the same `DATABASE_URL` that the production bot will use.

For Redis, use one of:

- Northflank Redis addon
- Upstash Redis
- Any hosted Redis instance

Redis is useful later for queues, cooldowns, rate limits, and distributed state. For one bot replica, it is not mandatory for the current command set.

## 7. Deploy And Connect WhatsApp

After the service is deployed:

1. Open Northflank logs.
2. Wait for the bot to start.
3. Open the public Northflank URL in a browser.
4. Visit `/api/status` to confirm the API responds.
5. Visit the root page or dashboard auth page to scan the QR.
6. Keep the service at one replica after pairing.

If the QR does not appear:

- Check logs for Baileys connection errors.
- Check `/api/auth/qr`.
- Make sure the service is not repeatedly restarting.
- Make sure `/app/sessions` is writable and mounted.

## 8. Vercel Dashboard Later

When deploying the `dashboard/` app to Vercel, set:

```env
NEXT_PUBLIC_BOT_API_URL=https://your-northflank-service-url
```

The dashboard should call the Northflank bot API. The dashboard itself should not run Baileys.

## 9. Operational Notes

- Keep replicas at `1` per WhatsApp account.
- Do not bake `.env` or `sessions/` into Docker images.
- Use a persistent volume for `/app/sessions`.
- If you reset the volume, you will need to scan QR again.
- If you change `BOT_PREFIX`, `.menu` and command examples should be updated mentally to that new prefix.
- Media commands need FFmpeg and Sharp support; the Dockerfile installs `ffmpeg` on Alpine and installs production dependencies.

## 10. Quick Production Checklist

- `npm run build` passes locally.
- Dockerfile build succeeds.
- Northflank service exposes port `3001`.
- `/healthz` returns `ok: true`.
- `/app/sessions` persistent volume is mounted.
- `SESSION_PATH=/app/sessions`.
- Only one replica is running.
- QR is scanned successfully.
- `.status` or `.ping` works from WhatsApp.
