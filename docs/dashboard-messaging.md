# Dashboard messaging

- Hover over a message to edit your recent text messages or toggle its star. Incoming edits update the existing bubble and AI memory; the original activity timestamp is preserved.
- Open **Starred Messages** to view persisted stars, open their chats, or unstar them. Stars sync through WhatsApp AppState updates.
- Use the disappearing-message selector in a DM/group header: Off, 24 hours, 7 days, or 90 days. Unknown means WhatsApp has not supplied the current setting. WhatsApp enforces group permissions.
- Enable **Queue when offline** for text messages or **Queue on Mute** for restricted groups. Open **Queued Messages** to inspect pending/failed sends, retry failures, or cancel pending jobs.

## Redis for queued sends

The outbound queue uses the existing BullMQ and Redis dependencies. For local development with Docker:

```powershell
docker compose up -d redis
npm run build
npm start
```

Redis is exposed only on localhost. Configure `REDIS_HOST`, `REDIS_PORT`, and `REDIS_PASSWORD` when using another Redis instance. The compose service enables append-only persistence and stores Redis data in its named volume. A queue request fails visibly when Redis is unavailable; ordinary messaging, edits, stars, and timers do not require Redis.

Jobs survive bot restarts, wait while WhatsApp is offline or the group blocks sending, and retry delivery failures up to five times with exponential backoff. Failed jobs remain available for manual retry/cancel. Each job is bound to its WhatsApp account and retains the same message ID across retries; repeated queue requests with the same request ID share a job. This reduces duplicate delivery, but does not promise exactly-once delivery across WhatsApp and Redis after an interrupted acknowledgement. Queued replies preserve a text preview of the quoted message.

Edits, starred snapshots, and observed timers are stored atomically in `sessions/message-edits.json`, `sessions/starred-messages.json`, and `sessions/chat-settings.json` (under the configured `SESSION_PATH`). Relinking preserves these files. The disappearing timer changes WhatsApp behavior; recovered media and local archived messages retain the bot's existing retention policy.

## Verification

```powershell
npm run build
node --test scripts/dashboard-message-info.test.cjs
```

Live verification needs a linked WhatsApp session and running Redis: edit a recent outgoing message; star/unstar it from the dashboard and phone; change a DM/group timer; queue a message while disconnected or blocked, restart the bot, and reconnect/open the group.
