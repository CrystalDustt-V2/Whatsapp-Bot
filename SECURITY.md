# Security Policy

## Private Data

Never commit or share:

- `.env`
- `runtime.env`
- `sessions/`
- `logs/`
- `temp/`
- `cookies.txt`
- `openai keys.txt`
- WhatsApp auth exports
- API keys, GitHub tokens, MEGA passwords, Spotify secrets, or database URLs

If any secret is exposed, rotate it immediately. For WhatsApp session exposure,
unlink the device from WhatsApp and create a new session.

## Reporting Issues

Please open a GitHub security advisory or contact the maintainer privately for
security-sensitive reports. Do not post real tokens, session files, phone
numbers, or private logs in public issues.

## Runtime Notes

This bot uses WhatsApp Web through Baileys. Keep the process on a trusted server,
protect the private auth page with `DASHBOARD_AUTH_TOKEN`, and keep `SESSION_PATH`
on persistent storage that only the bot process can read.
