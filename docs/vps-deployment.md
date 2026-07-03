# VPS Deployment Guide

This guide runs the WhatsApp bot backend as a long-lived Docker Compose service on Ubuntu.

## VPS Order Form

Use these values in the VPS setup form:

- Hostname: `bot.yourdomain.com` if you own a domain, otherwise use something like `whatsapp-bot`
- Root password: generate a long unique password and save it in a password manager
- NS1 prefix: leave as `ns1`
- NS2 prefix: leave as `ns2`
- Location: choose the region nearest you or your users
- OS: Ubuntu 24.04 is fine

You do not need custom nameservers for the bot unless your VPS provider requires them for DNS hosting. For a simple bot server, the important thing is the VPS IP address.

## DNS

If you own a domain, create an `A` record:

```text
bot.yourdomain.com -> YOUR_VPS_IP
```

If you do not own a domain yet, you can use the raw VPS IP:

```text
http://YOUR_VPS_IP:3001
```

## Initial Server Setup

SSH into the VPS:

```bash
ssh root@YOUR_VPS_IP
```

Update the server:

```bash
apt update && apt upgrade -y
```

Install base tools:

```bash
apt install -y git curl ufw ca-certificates
```

Install Docker:

```bash
curl -fsSL https://get.docker.com | sh
```

Enable Docker on boot:

```bash
systemctl enable docker
systemctl start docker
```

## Firewall

Allow SSH and the bot API port:

```bash
ufw allow OpenSSH
ufw allow 3001/tcp
ufw enable
```

If you later add Nginx/Caddy with HTTPS, also allow:

```bash
ufw allow 80/tcp
ufw allow 443/tcp
```

## Deploy The Project

Clone your repo:

```bash
cd /opt
git clone YOUR_REPO_URL whatsapp-half-bot
cd /opt/whatsapp-half-bot
```

Create the runtime env file:

```bash
cp .env.example .env
nano .env
```

Recommended `.env` values:

```env
NODE_ENV=production
BOT_PREFIX=.
PORT=3001
HANDLE_SELF_MESSAGES=true
HANDLE_INCOMING_MESSAGES=true
OWNER_NUMBER=628xxxxxxxxxx
OWNER_NAME=Your Name
DASHBOARD_URL=http://YOUR_VPS_IP:3001
SESSION_PATH=/app/sessions
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=
DATABASE_URL=
```

If you use a domain:

```env
DASHBOARD_URL=http://bot.yourdomain.com:3001
```

Start the bot:

```bash
docker compose up -d --build
```

Watch logs:

```bash
docker compose logs -f bot
```

Open the bot API:

```text
http://YOUR_VPS_IP:3001
```

or:

```text
http://bot.yourdomain.com:3001
```

Scan the WhatsApp QR when it appears.

## Persistent Sessions

The Compose file mounts:

```text
./sessions -> /app/sessions
./logs -> /app/logs
./temp -> /app/temp
```

Do not delete `sessions/` unless you want to log in to WhatsApp again.

## Updating The Bot

On the VPS:

```bash
cd /opt/whatsapp-half-bot
git pull
docker compose up -d --build
docker compose logs -f bot
```

## Useful Commands

Check status:

```bash
docker compose ps
```

Restart:

```bash
docker compose restart bot
```

Stop:

```bash
docker compose down
```

View recent logs:

```bash
docker compose logs --tail=100 bot
```

## Optional HTTPS Later

The simplest first deployment is:

```text
http://YOUR_VPS_IP:3001
```

Later, add Caddy or Nginx as a reverse proxy:

```text
https://bot.yourdomain.com -> localhost:3001
```

Then set:

```env
DASHBOARD_URL=https://bot.yourdomain.com
```

and update the future Vercel dashboard env:

```env
NEXT_PUBLIC_BOT_API_URL=https://bot.yourdomain.com
```
