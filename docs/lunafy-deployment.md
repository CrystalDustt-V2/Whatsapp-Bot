# Lunafy Panel Deployment Guide

This guide deploys the WhatsApp bot backend as one long-running Node.js server on `panel.lunafy.run`.

The dashboard can be hosted separately later. The Baileys WhatsApp bot process must stay online on Lunafy or another always-on host.

## 1. Prepare GitHub

Make sure these are committed and pushed:

- `package.json`
- `package-lock.json`
- `scripts/lunafy-start.cjs`
- `src/`
- `prisma/`
- `.env.example`

Do not commit:

- `.env`
- `runtime.env`
- `openai keys.txt`
- `sessions/`
- `logs/`
- `temp/`

From your local repo:

```bash
npm run build
git status
git add .
git commit -m "Prepare Lunafy deployment"
git push origin main
```

If your repo uses `master`, push `master` instead of `main`.

## 2. Log In To Lunafy

Open:

```text
https://panel.lunafy.run
```

Create or log in to your account, then create a new Node.js server.

If Lunafy asks for GitHub access, use one of these:

- Public repo: paste the repo URL.
- Private repo: use Lunafy's GitHub OAuth, a read-only deploy key, or a fine-grained GitHub token with repository contents read access only.

Do not put GitHub tokens in `.env`, chat messages, or committed files.

## 3. Clone Or Connect The Repo

Use the bot repo:

```text
https://github.com/CrystalDustt-V2/whatsapp-halfbot.git
```

Recommended branch:

```text
main
```

If your repo currently uses `master`, use:

```text
master
```

## 4. Startup Command

Set the Lunafy startup command to:

```bash
npm run start:lunafy
```

That script does this on every server start:

1. `git fetch --prune origin`
2. `git merge --ff-only origin/<branch>`
3. `npm install --include=dev`
4. `npx prisma generate`
5. `npm run build`
6. `node dist/index.js`

It uses fast-forward Git updates only. If the server has local edits that conflict with the repo, startup stops instead of deleting files.

## 5. Environment Variables

Set these in Lunafy, not in committed files:

```env
NODE_ENV=production
BOT_PREFIX=.
PORT=3001
HANDLE_SELF_MESSAGES=true
HANDLE_INCOMING_MESSAGES=true
OWNER_NUMBER=628xxxxxxxxxx
OWNER_NAME=Your Name
DASHBOARD_URL=https://your-lunafy-host-or-allocation
SESSION_PATH=./sessions
AUTO_GIT_PULL=true
GIT_REMOTE=origin
GIT_BRANCH=main
AUTO_NPM_INSTALL=true
AUTO_PRISMA_GENERATE=true
AUTO_BUILD=true
```

If Lunafy gives you a dynamic server port, set `PORT` to that allocated port. If Lunafy exposes `SERVER_PORT`, the startup script will use that when `PORT` is empty.

If your branch is `master`:

```env
GIT_BRANCH=master
```

AI/media provider env vars are optional and should be copied from `.env.example` only when you use those providers.

## 6. Persistent WhatsApp Session

Keep:

```env
SESSION_PATH=./sessions
```

Do not delete the `sessions/` folder from the Lunafy file manager after pairing WhatsApp. If the session folder is removed, the bot will need a fresh QR scan.

## 7. Start And Pair WhatsApp

Start the server in Lunafy.

Open the server URL and check:

```text
/healthz
/api/status
/api/auth/qr
```

Scan the QR from the dashboard/root auth page or `/api/auth/qr`.

Keep the server count at one instance for one WhatsApp account.

## 8. Updating Later

Push updates to GitHub:

```bash
git push origin main
```

Then restart the Lunafy server. Because the startup command is `npm run start:lunafy`, the server pulls the latest fast-forward changes before starting the bot.

If Lunafy already performs Git deploys for you, set:

```env
AUTO_GIT_PULL=false
```

## 9. Known Limits

- TikTok/media commands that call `yt-dlp` or FFmpeg need those binaries available on the Lunafy server.
- If the panel does not provide FFmpeg/yt-dlp, normal bot commands still work, but those downloader/media commands can fail.
- Use one running server/instance per WhatsApp account.
