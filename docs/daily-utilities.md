# Everyday utilities

## Translation

Send `.translate en Selamat pagi`, or reply to a text message with `.translate id`. Aliases: `.tr`, `.terjemah`. Use a language code such as `en`, `id`, `ja`, or `pt-BR`; the source language is detected automatically. Replied image/video/document captions also work.

Requires `PUTER_AUTH_TOKEN` and the existing Puter AI service. `PUTER_CHAT_MODEL` takes precedence over `AI_MODEL` for this command. Input is limited to 4000 characters. Line breaks are preserved and long results are split into replies. Translation text is sent to Puter on demand.

## Saved reminders

- `.remind 10m Drink water` creates a reminder and returns its ID.
- `.remind list` shows your active reminders in the current chat; due dates are shown in UTC.
- `.remind cancel <id>` cancels one of your reminders in that chat.

Existing aliases `.reminder` and `.ingatkan` still work. Reminders are saved atomically to `sessions/reminders.json` (or your configured `SESSION_PATH`). They survive process restarts and session re-pairing. The connected bot checks once per second, delivers overdue reminders after reconnecting, and retries failed sends after at least a minute. Group reminders mention their creator.

Limits: seven days, 1000 characters per reminder, 100 active reminders across the bot. Listing and cancellation are scoped to the creator and chat. Reminders deliver in the original chat; they are not private messages when created in a group. A send interrupted after WhatsApp accepts it but before the local save may be retried, so delivery is not guaranteed to be exactly once. Cancellation cannot retract a send already in progress.

## Text to speech

Send `.tts Hello`, or reply to text with `.tts`. Explicit command text takes precedence over the replied message.

For Puter, set `AI_TTS_API_BASE_URL=puter` (or `AI_API_BASE_URL=puter`) and `PUTER_AUTH_TOKEN`. The command uses `PUTER_TTS_MODEL` / `PUTER_TTS_VOICE`, falling back to `AI_TTS_MODEL` / `AI_TTS_VOICE`. Existing HTTP speech providers remain supported. Input is limited to 2990 characters with Puter or 4000 with other providers; longer text is rejected rather than silently shortened.

## Verification

```powershell
npm run build
node --test scripts/daily-utilities.test.cjs
```

Tests use isolated temporary reminder stores and mocked WhatsApp/AI adapters. They do not send real messages or make provider requests.
