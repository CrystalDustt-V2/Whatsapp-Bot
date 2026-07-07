# Puter.js AI setup

This bot can use Puter.js as an AI provider through the internal `AIService` wrapper in `src/services/ai-service.ts`. The `.ai` command keeps the existing OpenAI-compatible providers, but switches to Puter when you enable it with env variables.

## 1. Install and initialize Puter.js

The project includes the npm package:

```bash
npm install @heyputer/puter.js
```

Puter's Node guide currently recommends Node.js 24 or newer for server-side usage. The bot lazy-loads Puter only when you enable it, so the rest of the bot can still run without Puter.

The service initializes Puter like this internally:

```ts
import { init } from '@heyputer/puter.js/src/init.cjs';

const puter = init(process.env.PUTER_AUTH_TOKEN);
```

Do not call Puter directly from commands. Use `AIService` instead.

## 2. Authentication

Create an auth token from the Puter dashboard, then set it on your server:

```env
PUTER_AUTH_TOKEN=your_token_here
```

For this always-on WhatsApp bot, use the token flow. Browser login is useful for local experiments, but it is not a good fit for a headless VPS or panel container.

## 3. Enable AI features

Use Puter for everything:

```env
AI_PROVIDER=puter
PUTER_AUTH_TOKEN=your_token_here
PUTER_CHAT_MODEL=gpt-5-nano
```

You can set ordered fallback models with commas or pipes. The bot tries them left to right and moves to the next one on retryable provider failures such as rate limits or temporary server errors:

```env
PUTER_CHAT_MODEL=model1,model2,model3
PUTER_IMAGE_MODEL=model1|model2
PUTER_TTS_MODEL=model1,model2
PUTER_STT_MODEL=model1|model2
```

Or enable Puter only for a specific feature:

```env
AI_IMAGE_PROVIDER=puter
AI_TTS_PROVIDER=puter
AI_STT_PROVIDER=puter
```

Supported bot paths:

- Chat: `.ai <message>`
- Image generation: `.ai generate image <prompt>`
- Text to speech: `.ai say <text>`
- Speech to text from a public audio URL: `.ai transcribe <audio-url>`
- Image analysis from a public image URL: `.ai analyze image <image-url>`

## 4. Change models

Configure models independently:

```env
PUTER_CHAT_MODEL=gpt-5-nano
PUTER_IMAGE_MODEL=
PUTER_TTS_MODEL=
PUTER_TTS_VOICE=
PUTER_STT_MODEL=
```

You can also keep using the existing env names:

```env
AI_MODEL=gpt-5-nano
AI_IMAGE_MODEL=
AI_TTS_MODEL=
AI_TTS_VOICE=
AI_STT_MODEL=
```

Puter can list available chat models through the service:

```ts
const models = await aiService.listModels();
```

## 5. Use the service layer

Use `createPuterAIService` from `src/services/ai-service.ts`:

```ts
import { createPuterAIService } from '../services/ai-service';

const aiService = createPuterAIService({
  authToken: process.env.PUTER_AUTH_TOKEN,
  chatModel: process.env.PUTER_CHAT_MODEL,
  timeoutMs: 60_000,
  retries: 1,
});

const answer = await aiService.chat(
  [{ role: 'user', content: 'Write a short intro.' }],
  { conversationId: 'chat-id' }
);

const image = await aiService.generateImage('a clean robot mascot');
const audio = await aiService.textToSpeech('Hello from the bot.', { voice: 'alloy' });
const transcript = await aiService.speechToText('https://example.com/audio.mp3');
```

The service supports:

- `chat(messages, options)`
- `streamChat(messages, options)`
- `generateImage(prompt, options)`
- `textToSpeech(text, options)`
- `speechToText(audio, options)`
- `analyzeImage(image, options)`
- `embedText(input, options)`

`embedText` exists so the public interface is stable, but Puter.js does not currently expose a documented embeddings API. It returns a descriptive unsupported-provider error for now.

## 6. Limitations and browser requirements

- Server-side Puter.js currently expects a modern Node runtime. Prefer Node.js 24+.
- The bot uses `PUTER_AUTH_TOKEN`; browser popup login is not suitable for panel/container startup.
- WhatsApp messages are not truly live-streamed yet. The service supports streaming, but `.ai` sends a normal WhatsApp reply after the model finishes.
- Media conversion depends on Puter returning a downloadable URL, data URI, Blob-like object, or binary response.
- Image analysis currently works best with public image URLs.

## 7. Test it

Run the normal build:

```bash
npm run build
```

Then test in WhatsApp:

```text
.ai hello
.ai generate image a small blue crystal bot logo
.ai say this is a Puter text to speech test
.ai transcribe https://example.com/audio.mp3
.ai analyze image https://example.com/image.png
```

If a Puter request fails, turn on:

```env
AI_DEBUG=true
```

The bot logs request state and provider errors without intentionally dumping secrets.
