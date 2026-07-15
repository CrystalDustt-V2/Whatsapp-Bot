# CrystalDust V0 WhatsApp Bot

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/C4S823841D)

CrystalDust V0 is a TypeScript WhatsApp hybrid bot. It connects to a normal
WhatsApp account through WhatsApp Web/Baileys, then lets that account keep being
used by a human while also responding to bot commands.

The backend is meant to run on an always-on VPS, panel host, or container. Static
hosts such as Vercel can host a public website for the bot, but they cannot host
the long-running WhatsApp socket process.

> This project is not affiliated with WhatsApp or Meta. It uses an unofficial
> WhatsApp Web library, so use it responsibly and keep your auth/session files
> private.

## What It Does

- Prefix commands with a configurable prefix, defaulting to `.`
- Public status page and private WhatsApp login page served by Express
- QR login and optional phone-number pairing code login
- AI chat, image, audio, speech-to-text, embedding, and tool-calling support
- Sticker creation, sticker metadata, brat-style stickers, sticker editing, and
  sticker-to-media conversion
- Image, audio, and video media tools powered by Sharp and FFmpeg
- TikTok and music download helpers powered by `yt-dlp` when installed
- Search, utility, group, fun, social, text, and community commands
- Deleted-message metadata/media recovery for normal messages where WhatsApp
  provides a decryptable payload
- Optional MEGA storage for recovered deleted media
- Prisma/PostgreSQL and Redis/BullMQ scaffolding for features that need them

## Requirements

- Node.js `20.19+`, `22.12+`, or `24+`
- npm
- FFmpeg for media commands
- `yt-dlp` for TikTok and music playback/download commands
- PostgreSQL if you enable database-backed features
- Redis if you enable queue/worker features

Node.js 23 is not recommended because Prisma does not support it.

## Quick Start

```bash
git clone https://github.com/your-name/your-repo.git
cd your-repo
npm install
cp .env.example .env
npm run build
npm start
```

Open the public bot page:

```text
http://localhost:3001
```

Open the private auth page:

```text
http://localhost:3001/auth?token=YOUR_DASHBOARD_AUTH_TOKEN
```

Set `DASHBOARD_AUTH_TOKEN` in `.env` before exposing the server publicly.

## Local Development

```bash
npm run dev
```

Useful checks:

```bash
npm run build
npx prisma generate
```

The `lint` script is present for projects that add ESLint config later; this
repo currently uses TypeScript build verification as the main safety check.

## Environment Setup

Copy `.env.example` to `.env`, then change only what you need. Keep `.env`
private. Never commit it.

Minimum local setup:

```env
NODE_ENV=development
BOT_PREFIX=.
PORT=3001
OWNER_NAME=Your Name
DASHBOARD_AUTH_TOKEN=choose-a-long-random-token
SESSION_PATH=./sessions
```

Useful production setup:

```env
NODE_ENV=production
PORT=3001
OWNER_NUMBER=628xxxxxxxxxx
AUTH_PHONE_NUMBER=628xxxxxxxxxx
OWNER_NAME=Your Name
DASHBOARD_URL=https://your-domain.example
DASHBOARD_AUTH_TOKEN=choose-a-long-random-token
SESSION_PATH=./sessions
```

AI, music, deleted-message recovery, MEGA, Spotify, Redis, and database options
are documented inline in `.env.example`.

## Running With Docker

```bash
cp .env.example .env
docker compose up -d --build
```

Docker stores WhatsApp sessions, logs, and temp files in local mounted folders:

```text
./sessions
./logs
./temp
```

Back up `sessions/` if you do not want to re-link WhatsApp after moving servers.

## Manual VPS Or Panel Hosting

1. Push this repo to GitHub.
2. Create a Node.js server/container on your host.
3. Use Node.js `20.19+`, `22.12+`, or `24+`.
4. Install dependencies with `npm install` or `npm ci --include=dev`.
5. Create `.env` from `.env.example`.
6. Make `SESSION_PATH` persistent.
7. Run `npm run build`.
8. Start with `npm start`.

For panels that only let you set a main file, use:

```text
start.js
```

For panels that support npm scripts, use:

```bash
npm run start:lunafy
```

The Lunafy/HidenCloud-style startup script can pull the latest Git changes,
install dependencies, generate Prisma, build, and then run `dist/index.js`.
Control that behavior with:

```env
AUTO_GIT_PULL=true
AUTO_NPM_INSTALL=true
AUTO_PRISMA_GENERATE=true
AUTO_BUILD=true
BOT_ENTRY=dist/index.js
```

If your host provides a dynamic `SERVER_PORT`, the startup script prefers it over
`PORT`.

## Private Files

Do not publish or share these:

- `.env`
- `runtime.env`
- `openai keys.txt`
- `cookies.txt`
- `sessions/`
- `logs/`
- `temp/`
- WhatsApp auth/session exports
- API keys, GitHub tokens, MEGA passwords, Spotify secrets

If any secret was committed, rotate it immediately before making the repository
public.

## Common Problems

### `Cannot find module './index.ts'` on a panel host

The panel is starting the wrong file. Use `start.js` as the main file, or use
`npm run start:lunafy` if the panel allows custom npm scripts.

### `EALLOWGIT Fetching packages of type "git" have been disabled`

Baileys may install a Git dependency. This repo includes `.npmrc` with
`allow-git=all`, but some hosts disable Git dependencies globally. Ask the host
to allow Git dependencies or install on a host that permits them.

### Prisma rejects the Node version

Use Node.js `20.19+`, `22.12+`, or `24+`. Avoid Node.js 23.

### The web page says connection refused

The bot is not listening on the public port. Check `PORT`, panel allocation
ports, firewall rules, and whether the process crashed during startup.

### The private auth page returns unauthorized

Set `DASHBOARD_AUTH_TOKEN`, then open:

```text
/auth?token=YOUR_TOKEN
```

### Music or TikTok commands fail

Install FFmpeg and `yt-dlp`. For YouTube, you may also need cookies and a
supported JavaScript runtime because YouTube sometimes blocks automated
requests.

### Spotify search works but audio comes from another platform

Spotify is used for metadata/search. Actual downloadable audio usually has to
come from a provider that exposes downloadable media, such as YouTube Music or
SoundCloud through `yt-dlp`.

### MEGA deleted-media upload says wrong password or node not found

Check `MEGA_EMAIL`, `MEGA_PASSWORD`, `MEGA_2FA_CODE`, and `MEGA_FOLDER_PATH`.
The recovery service falls back to local storage when remote upload fails.

### View-once deleted media is not recovered

Normal media can be recovered when the bot cached a decryptable payload before
deletion. View-once media is best-effort only and often cannot be recovered if
Baileys receives no usable payload or fails decryption.

## Q&A

### Can I host the bot backend on Vercel?

No. The WhatsApp connection must stay alive, so use a VPS, panel host, or
container. You can host a separate public website on Vercel.

### Is PostgreSQL required?

Not for every command. Keep `DATABASE_URL` configured when using Prisma-backed
features or when running Prisma scripts.

### Is Redis required?

Not for simple command usage. Redis is used by queue/worker scaffolding and any
feature that depends on it.

### Can other people message the bot from the website?

Not by default. The public site can show status and commands. A public send
message endpoint should be added only with rate limits, authentication, and spam
protection.

### Can I make the repo public safely?

Yes, after checking that no private files or real credentials were committed.
Run:

```bash
git status --short
git ls-files
```

Review the tracked list before publishing.

## Project Layout

```text
src/
  commands/              Command definitions
  core/                  Baileys connection, message handling, API server
  services/              AI, media, sticker, storage, utility services
  workers/               BullMQ worker scaffolding
  config/                Environment parsing
  types/                 Shared TypeScript types
public/
  index.html             Public status/commands page
  auth.html              Private WhatsApp QR/pairing page
docs/
  *.md                   Deployment and provider notes
prisma/
  schema.prisma          Database schema
scripts/
  lunafy-start.js        Panel-friendly production startup script
```

## License

MIT. See `LICENSE`.
