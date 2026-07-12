import config from '../config';
import { commandRegistry } from '../core/command-registry';
import logger from '../core/logger';
import { createPuterAIService, type AIServiceTool } from '../services/ai-service';
import { readAiMemoryContext } from '../services/message-memory';
import { stickerEngine } from '../services/sticker-engine';
import { BotContext, Command, CommandCategory } from '../types';

type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
};

type ToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

const AI_API_BASE_URL = (config.AI_API_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
const IS_PUTER = AI_API_BASE_URL.toLowerCase() === 'puter';
const IS_POLLINATIONS = AI_API_BASE_URL.includes('pollinations.ai');
const IS_GEMINI = AI_API_BASE_URL.includes('generativelanguage.googleapis.com');
const AI_API_KEY = IS_GEMINI ? config.AI_API_KEY : config.AI_API_KEY || config.OPENROUTER_API_KEY;
const AI_MODEL = config.AI_MODEL || (IS_PUTER ? config.PUTER_CHAT_MODEL || 'gpt-5-nano' : IS_POLLINATIONS ? 'openai-fast' : IS_GEMINI ? '' : config.OPENROUTER_MODEL);
const AI_IMAGE_API_BASE_URL = (config.AI_IMAGE_API_BASE_URL || AI_API_BASE_URL).replace(/\/$/, '');
const IS_IMAGE_PUTER = AI_IMAGE_API_BASE_URL.toLowerCase() === 'puter';
const IS_IMAGE_POLLINATIONS = AI_IMAGE_API_BASE_URL.includes('pollinations.ai');
const IS_IMAGE_GEMINI = AI_IMAGE_API_BASE_URL.includes('generativelanguage.googleapis.com');
const IS_IMAGE_CLOUDFLARE = AI_IMAGE_API_BASE_URL.includes('api.cloudflare.com');
const AI_IMAGE_API_KEY = config.AI_IMAGE_API_KEY || (IS_IMAGE_GEMINI ? config.AI_API_KEY : IS_IMAGE_CLOUDFLARE ? '' : AI_API_KEY);
const AI_IMAGE_MODEL = config.AI_IMAGE_MODEL || (IS_IMAGE_PUTER ? config.PUTER_IMAGE_MODEL : IS_IMAGE_POLLINATIONS ? 'sana' : config.OPENROUTER_IMAGE_MODEL);
const AI_IMAGE_ENDPOINT = config.AI_IMAGE_ENDPOINT || (IS_IMAGE_POLLINATIONS ? '/prompt' : config.AI_API_BASE_URL ? '/images/generations' : '/images');
const AI_TTS_API_BASE_URL = (config.AI_TTS_API_BASE_URL || AI_API_BASE_URL).replace(/\/$/, '');
const IS_TTS_PUTER = AI_TTS_API_BASE_URL.toLowerCase() === 'puter';
const AI_TTS_API_KEY = config.AI_TTS_API_KEY || AI_API_KEY;
const IS_TTS_POLLINATIONS = AI_TTS_API_BASE_URL.includes('pollinations.ai');
const AI_TTS_MODEL = config.AI_TTS_MODEL || (IS_TTS_PUTER ? config.PUTER_TTS_MODEL : IS_TTS_POLLINATIONS ? 'openai-audio' : config.OPENROUTER_TTS_MODEL);
const AI_TTS_VOICE = config.AI_TTS_VOICE || (IS_TTS_PUTER ? config.PUTER_TTS_VOICE || '' : IS_TTS_POLLINATIONS ? 'nova' : config.OPENROUTER_TTS_VOICE);
const IS_STT_PUTER = IS_PUTER;
const AI_STT_MODEL = config.AI_STT_MODEL || config.PUTER_STT_MODEL;
const AI_EMBEDDING_API_BASE_URL = (config.AI_EMBEDDING_API_BASE_URL || AI_API_BASE_URL).replace(/\/$/, '');
const IS_EMBEDDING_PUTER = AI_EMBEDDING_API_BASE_URL.toLowerCase() === 'puter' || IS_PUTER;
const IS_EMBEDDING_GEMINI = AI_EMBEDDING_API_BASE_URL.includes('generativelanguage.googleapis.com');
const AI_EMBEDDING_API_KEY = config.AI_EMBEDDING_API_KEY || (IS_EMBEDDING_GEMINI ? config.AI_API_KEY : AI_API_KEY);
const AI_EMBEDDING_MODEL = config.AI_EMBEDDING_MODEL;
const AI_EMBEDDING_ENDPOINT = config.AI_EMBEDDING_ENDPOINT || '/embeddings';
const MAX_MEMORY_MESSAGES = 12;
const MAX_FETCH_BYTES = 10 * 1024 * 1024;
const chatMemory = new Map<string, ChatMessage[]>();
const puterAI = createPuterAIService({
  authToken: config.PUTER_AUTH_TOKEN,
  chatModel: AI_MODEL,
  imageModel: AI_IMAGE_MODEL,
  ttsModel: AI_TTS_MODEL,
  ttsVoice: AI_TTS_VOICE,
  sttModel: AI_STT_MODEL,
  timeoutMs: config.PUTER_TIMEOUT_MS,
  retries: config.PUTER_RETRIES,
});

function aiDebug(data: Record<string, unknown>, msg: string): void {
  if (config.AI_DEBUG) logger.info(data, `[ai] ${msg}`);
}

function snippet(value: string, max = 800): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function aiFailureMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);

  if (message.includes('unauthorized_client_error')) {
    return 'AI provider rejected this bot client. Your provider may only allow specific supported clients.';
  }

  if (message.includes('HTTP 401')) {
    return 'AI provider authentication failed. Check your API key, base URL, and provider client support.';
  }

  if (message.includes('PUTER_AUTH_TOKEN_MISSING')) {
    return 'Set PUTER_AUTH_TOKEN first to use Puter.js AI from the bot server.';
  }

  if (message.includes('PUTER_EMBEDDINGS_UNAVAILABLE')) {
    return 'Puter.js does not currently expose a documented embeddings API, so embeddings are not available with the Puter provider yet.';
  }

  if (message.includes('HTTP 404') && message.includes('requested endpoint does not exist')) {
    return 'AI image endpoint is not available on this provider. Vision means image input, not image generation.';
  }

  return 'AI request failed. Check your AI provider key/model and try again.';
}

function headers(baseUrl = AI_API_BASE_URL, apiKey = AI_API_KEY): Record<string, string> {
  const result: Record<string, string> = { 'Content-Type': 'application/json' };

  if (baseUrl.includes('generativelanguage.googleapis.com')) {
    if (apiKey) result['x-goog-api-key'] = apiKey;
    return result;
  }

  if (apiKey) result.Authorization = `Bearer ${apiKey}`;

  if (baseUrl.includes('openrouter.ai')) {
    result['HTTP-Referer'] = config.DASHBOARD_URL;
    result['X-Title'] = 'WhatsApp Hybrid Bot';
  }

  return result;
}

function geminiModelName(model: string): string {
  return model.replace(/^models\//, '');
}

function providerUrl(baseUrl: string, path: string, method: string, model = AI_MODEL): string {
  if (baseUrl.includes('{MODEL}') || baseUrl.includes('{aiMethod}')) {
    return baseUrl
      .replace(/\{MODEL\}/g, encodeURIComponent(geminiModelName(model)))
      .replace(/\{aiMethod\}/g, method);
  }

  if (baseUrl.includes('generativelanguage.googleapis.com')) {
    if (/\/models\/[^:]+:[a-zA-Z]+$/.test(baseUrl)) {
      return baseUrl.replace(/\/models\/[^:]+:[a-zA-Z]+$/, `/models/${encodeURIComponent(geminiModelName(model))}:${method}`);
    }
    const root = baseUrl.replace(/\/models(?:\/[^/]*)?$/, '');
    return `${root}/models/${encodeURIComponent(geminiModelName(model))}:${method}`;
  }

  return `${baseUrl}${path}`;
}

function cloudflareImageUrl(): string {
  const endpoint = AI_IMAGE_ENDPOINT || '';
  const model = AI_IMAGE_MODEL || '';
  let url = AI_IMAGE_API_BASE_URL;

  if (endpoint.includes('/ai/run') || endpoint.includes('{MODEL}') || endpoint.includes('{AI_IMAGE_MODEL}')) {
    url = `${url}${endpoint}`;
  }

  url = url.replace(/\{AI_IMAGE_MODEL\}|\{MODEL\}/g, model);
  if (/\/ai\/run\/.+/.test(url)) return url;
  if (url.endsWith('/ai/run')) return `${url}/${model}`;
  return `${url}/ai/run/${model}`;
}

function apiUrl(path: string): string {
  if (IS_POLLINATIONS && path === '/chat/completions') {
    return AI_API_BASE_URL.includes('gen.pollinations.ai') ? `${AI_API_BASE_URL}${path}` : 'https://gen.pollinations.ai/v1/chat/completions';
  }

  return providerUrl(AI_API_BASE_URL, path, 'generateContent');
}

async function postJson(path: string, body: unknown): Promise<any> {
  const startedAt = Date.now();
  aiDebug(
    {
      path,
      baseUrl: AI_API_BASE_URL,
      model: (body as { model?: unknown })?.model,
      hasTools: Array.isArray((body as { tools?: unknown })?.tools),
    },
    'provider request'
  );

  const response = await fetch(apiUrl(path), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });

  const responseText = await response.text();
  aiDebug(
    {
      path,
      status: response.status,
      ok: response.ok,
      ms: Date.now() - startedAt,
      body: response.ok ? undefined : snippet(responseText),
    },
    'provider response'
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${snippet(responseText)}`);
  }

  return JSON.parse(responseText);
}

async function fetchBinary(url: string, label: string, apiKey = AI_API_KEY): Promise<{ buffer: Buffer; contentType: string }> {
  const startedAt = Date.now();
  const response = await fetch(url, { headers: headers(url, apiKey) });

  if (!response.ok) {
    const body = await response.text();
    aiDebug({ status: response.status, ms: Date.now() - startedAt, body: snippet(body) }, `${label} provider failed`);
    throw new Error(`HTTP ${response.status}: ${snippet(body)}`);
  }

  const contentType = response.headers.get('content-type')?.split(';')[0]?.toLowerCase() || 'application/octet-stream';
  const buffer = Buffer.from(await response.arrayBuffer());
  aiDebug({ status: response.status, ms: Date.now() - startedAt, contentType, bytes: buffer.byteLength }, `${label} provider response`);
  return { buffer, contentType };
}

function geminiContentText(message: ChatMessage): string {
  const text = typeof message.content === 'string' ? message.content.trim() : '';
  return text || (message.tool_calls?.length ? '[assistant requested a tool]' : '');
}

async function geminiChat(messages: ChatMessage[]) {
  const startedAt = Date.now();
  const systemText = messages
    .filter((message) => message.role === 'system')
    .map(geminiContentText)
    .filter(Boolean)
    .join('\n\n');
  const contents = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: geminiContentText(message) }],
    }))
    .filter((content) => content.parts[0].text);
  const body: Record<string, unknown> = {
    contents,
    generationConfig: { maxOutputTokens: 800 },
  };

  if (systemText) {
    body.systemInstruction = { parts: [{ text: systemText }] };
  }

  aiDebug({ baseUrl: AI_API_BASE_URL, model: AI_MODEL, contents: contents.length }, 'gemini request');
  const response = await fetch(providerUrl(AI_API_BASE_URL, '/chat/completions', 'generateContent'), {
    method: 'POST',
    headers: headers(AI_API_BASE_URL, AI_API_KEY),
    body: JSON.stringify(body),
  });
  const responseText = await response.text();

  aiDebug(
    {
      status: response.status,
      ok: response.ok,
      ms: Date.now() - startedAt,
      body: response.ok ? undefined : snippet(responseText),
    },
    'gemini response'
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${snippet(responseText)}`);
  }

  const result = JSON.parse(responseText);
  const content = (result?.candidates?.[0]?.content?.parts || [])
    .map((part: { text?: string }) => part.text || '')
    .join('')
    .trim();

  return {
    choices: [
      {
        finish_reason: result?.candidates?.[0]?.finishReason,
        message: { content },
      },
    ],
  };
}

function botToolDefinitions(): AIServiceTool[] {
  return [
    {
      type: 'function',
      function: {
        name: 'run_bot_command',
        description: 'Run one existing WhatsApp bot command. Command output is sent directly to WhatsApp.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Command name without prefix, for example menu or sbrat.' },
            args: { type: 'array', items: { type: 'string' }, description: 'Command arguments.' },
          },
          required: ['command'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'fetch_url',
        description: 'Fetch a public HTTP/HTTPS URL for text, JSON, or a small direct media asset. Direct media is sent to WhatsApp.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string' },
          },
          required: ['url'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'generate_image',
        description: 'Generate a new image/sticker/visual from scratch and send it to WhatsApp. Use only when the user explicitly asks for an image, drawing, picture, sticker, logo, illustration, or visual generation.',
        parameters: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'Detailed image prompt.' },
            as_sticker: { type: 'boolean', description: 'Send the generated image as a WhatsApp sticker.' },
          },
          required: ['prompt'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'generate_audio',
        description: 'Generate speech/voice/audio from text and send it to WhatsApp. Use only when the user explicitly asks for audio, speech, voice, TTS, or sound.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text to speak.' },
          },
          required: ['text'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'embed_text',
        description: 'Create an embedding vector for text. Use this only when the user asks for embeddings, vectors, or semantic similarity data.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text to embed.' },
          },
          required: ['text'],
        },
      },
    },
  ];
}

async function chat(messages: ChatMessage[], withTools = true) {
  if (IS_PUTER) {
    const result = await puterAI.chat(messages, {
      model: AI_MODEL,
      maxTokens: 800,
      tools: withTools && config.AI_ENABLE_TOOLS ? botToolDefinitions() : undefined,
      onProgress: (progress) => aiDebug(progress, 'puter progress'),
    });

    return {
      choices: [
        {
          finish_reason: result.finishReason,
          message: { content: result.text, tool_calls: result.toolCalls },
        },
      ],
    };
  }

  if (IS_GEMINI) {
    return geminiChat(messages);
  }

  const body: Record<string, unknown> = {
    model: AI_MODEL,
    messages,
    max_tokens: 800,
  };

  if (withTools && config.AI_ENABLE_TOOLS) {
    body.tools = botToolDefinitions();
    body.tool_choice = 'auto';
    body.parallel_tool_calls = false;
  }

  try {
    return await postJson('/chat/completions', body);
  } catch (err) {
    if (withTools && config.AI_ENABLE_TOOLS && /tools?|tool_choice|parallel_tool_calls/i.test(err instanceof Error ? err.message : String(err))) {
      delete body.tools;
      delete body.tool_choice;
      delete body.parallel_tool_calls;
      aiDebug({ model: AI_MODEL }, 'retrying without provider tool fields');
      return postJson('/chat/completions', body);
    }
    throw err;
  }
}

function textFrom(message: any): string {
  return typeof message?.content === 'string' ? message.content.trim() : '';
}

function isMalformedFunctionCall(response: any): boolean {
  return response?.choices?.[0]?.finish_reason === 'MALFORMED_FUNCTION_CALL';
}

function noNativeToolRetry(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message, index) =>
    index === 0 && message.role === 'system'
      ? {
          ...message,
          content: `${message.content || ''}\n\nRetry rule: do not emit native provider function calls. If a bot command should run, reply only as RUN_COMMAND {"command":"name","args":["arg1"]}. Otherwise answer in plain text.`,
        }
      : message
  );
}

async function replyText(ctx: BotContext, text: string): Promise<void> {
  await ctx.socket.sendMessage(
    ctx.message.key.remoteJid!,
    { text, linkPreview: null },
    { quoted: ctx.message }
  );
}

function commandList(): string {
  return commandRegistry
    .getAll()
    .filter((command) => command.name !== 'ai')
    .map((command) => `${config.BOT_PREFIX}${command.usage || command.name} - ${command.description || command.category}`)
    .join('\n');
}

function memoryKey(ctx: BotContext): string {
  return ctx.message.key.remoteJid || 'unknown';
}

function remember(ctx: BotContext, ...messages: ChatMessage[]): void {
  const key = memoryKey(ctx);
  const next = [...(chatMemory.get(key) || []), ...messages].slice(-MAX_MEMORY_MESSAGES);
  chatMemory.set(key, next);
}

function commandArgs(raw?: string): string[] {
  return (raw || '')
    .trim()
    .replace(/^(?:with|for|on|using)\s+/i, '')
    .split(/\s+/)
    .filter(Boolean);
}

function parseCommandRequest(input: string): { command: string; args: string[] } | null {
  const dotCommand = input.match(/(?:^|\s)\.([a-z0-9-]+)(?:\s+(.+))?$/i);
  const directCommand = input.match(/^([a-z0-9-]+)(?:\s+(.+))?$/i);
  const match = dotCommand || directCommand;

  if (!match) return null;

  const command = match[1].toLowerCase();
  if (command === 'ai' || !commandRegistry.get(command)) return null;

  return { command, args: commandArgs(match[2]) };
}

function parseCommandDirective(text: string): { command: string; args: string[] } | null {
  const match = text.match(/RUN_COMMAND\s+({[\s\S]*})/i);
  if (!match) return null;

  try {
    const value = JSON.parse(match[1]) as { command?: string; args?: unknown };
    const command = (value.command || '').replace(config.BOT_PREFIX, '').toLowerCase();
    if (!command || command === 'ai') return null;
    return { command, args: Array.isArray(value.args) ? value.args.map(String) : [] };
  } catch {
    return null;
  }
}

function parseMarkdownImage(text: string): string | null {
  const match = text.match(/!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/i);
  return match?.[1] || null;
}

function parseXmlToolCall(text: string): ToolCall | null {
  const name = text.match(/<tool_call>\s*([a-z0-9_/-]+)/i)?.[1];
  if (!name) return null;

  const argKey = text.match(/<arg_key>\s*([^<]+)\s*<\/arg_key>/i)?.[1]?.trim();
  const argValue = text.match(/<arg_value>\s*([\s\S]*?)\s*<\/arg_value>/i)?.[1]?.trim();
  const args: Record<string, unknown> = {};

  if (argKey && argValue) {
    try {
      args[argKey] = JSON.parse(argValue);
    } catch {
      args[argKey] = argValue;
    }
  }

  return {
    id: 'fallback-tool-call',
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  };
}

function promptFor(kind: 'image' | 'audio', input: string): string | null {
  const patterns =
    kind === 'image'
      ? [
          /^(?:image|picture|photo|drawing|draw|sticker|logo|illustration|visual)\s*:?\s*(.+)$/i,
          /\b(?:generate|create|make|draw|design)\b[\s\S]*?\b(?:image|picture|photo|drawing|sticker|logo|illustration|visual|artwork)\b(?:\s+(?:of|for|about)\s+)?([\s\S]+)?$/i,
        ]
      : [
          /^(?:audio|voice|speech|tts|sound)\s*:?\s*(.+)$/i,
          /\b(?:generate|create|make)\b[\s\S]*?\b(?:audio|voice|speech|tts|sound)\b(?:\s+(?:of|saying|that says|about)\s+)?([\s\S]+)?$/i,
        ];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) return (match[1]?.trim() || input).trim();
  }

  return null;
}

function explicitCommandToolRequest(input: string): boolean {
  if (parseCommandRequest(input)) return true;
  if (!/\b(?:bot command|command|run|use|call|execute)\b/i.test(input)) return false;

  const lower = input.toLowerCase();
  return commandRegistry.getAll().some((command) =>
    [command.name, ...(command.aliases || [])].some((name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(lower))
  );
}

export function aiToolAllowedForInput(input: string, toolName: string): boolean {
  return toolName === 'generate_image'
    ? Boolean(promptFor('image', input))
    : toolName === 'generate_audio'
      ? Boolean(promptFor('audio', input))
      : toolName === 'embed_text'
        ? Boolean(embeddingInput(input))
        : toolName === 'run_bot_command'
          ? explicitCommandToolRequest(input)
          : true;
}

function embeddingInput(input: string): string | null {
  const patterns = [
    /^(?:embed|embedding|vectorize)\s*:?\s*([\s\S]+)$/i,
    /^(?:create|generate|make)\s+(?:an?\s+)?(?:embedding|vector)\s+(?:for|of)\s+([\s\S]+)$/i,
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match?.[1]?.trim()) return match[1].trim();
  }

  return null;
}

function speechToTextUrl(input: string): string | null {
  const match = input.match(/\b(?:transcribe|speech\s*to\s*text|stt)\b[\s\S]*?(https?:\/\/\S+)/i);
  return match?.[1]?.trim() || null;
}

function imageAnalysisRequest(input: string): { url: string; prompt: string } | null {
  const match = input.match(/\b(?:analy[sz]e|describe|ocr|read|what(?:'s| is) in)\b[\s\S]*?(https?:\/\/\S+)/i);
  if (!match?.[1]) return null;

  return {
    url: match[1].trim(),
    prompt: input.replace(match[1], '').trim() || 'Describe this image.',
  };
}

async function transcribeAudio(input: string): Promise<string> {
  if (!IS_STT_PUTER) {
    return 'Speech-to-text is currently wired through Puter.js. Set AI_API_BASE_URL=puter first.';
  }

  const result = await puterAI.speechToText(input, {
    model: AI_STT_MODEL,
    language: config.AI_STT_LANGUAGE,
    timeoutMs: config.AI_STT_TIMEOUT_MS,
    onProgress: (progress) => aiDebug(progress, 'puter speech-to-text progress'),
  });

  return result.text ? `Transcription:\n${result.text}` : 'Puter did not return transcription text.';
}

async function analyzeImage(input: { url: string; prompt: string }): Promise<string> {
  if (!IS_PUTER) {
    return 'Image analysis is currently wired through Puter.js. Set AI_API_BASE_URL=puter first.';
  }

  const result = await puterAI.analyzeImage(input.url, {
    prompt: input.prompt,
    model: AI_MODEL,
    onProgress: (progress) => aiDebug(progress, 'puter image analysis progress'),
  });

  return result.text || 'Puter did not return image analysis text.';
}

async function embedText(input: string): Promise<string> {
  aiDebug({ textLength: input.length, embeddingModel: AI_EMBEDDING_MODEL, endpoint: AI_EMBEDDING_ENDPOINT }, 'embedding requested');

  if (IS_EMBEDDING_PUTER) {
    const result = await puterAI.embedText(input);
    const first = result.embeddings[0] || [];
    const preview = first
      .slice(0, 8)
      .map((value) => value.toFixed(4))
      .join(', ');
    return `Embedding created.\nProvider: Puter\nDimensions: ${first.length}\nPreview: [${preview}${first.length > 8 ? ', ...' : ''}]`;
  }

  if (!AI_EMBEDDING_MODEL) {
    return 'Set AI_EMBEDDING_MODEL first to use AI embeddings.';
  }

  const response = await fetch(
    IS_EMBEDDING_GEMINI
      ? providerUrl(AI_EMBEDDING_API_BASE_URL, AI_EMBEDDING_ENDPOINT, 'embedContent', AI_EMBEDDING_MODEL)
      : `${AI_EMBEDDING_API_BASE_URL}${AI_EMBEDDING_ENDPOINT}`,
    {
      method: 'POST',
      headers: headers(AI_EMBEDDING_API_BASE_URL, AI_EMBEDDING_API_KEY),
      body: JSON.stringify(
        IS_EMBEDDING_GEMINI
          ? {
            model: `models/${geminiModelName(AI_EMBEDDING_MODEL)}`,
            content: { parts: [{ text: input.slice(0, 8000) }] },
          }
          : { model: AI_EMBEDDING_MODEL, input: input.slice(0, 8000) }
      ),
    }
  );
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${snippet(text)}`);
  }

  const result = JSON.parse(text);
  const embedding = IS_EMBEDDING_GEMINI ? result?.embedding?.values : result?.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    return 'Your AI embedding provider did not return an embedding.';
  }

  const preview = embedding
    .slice(0, 8)
    .map((value) => (typeof value === 'number' ? value.toFixed(4) : String(value)))
    .join(', ');

  return `Embedding created.\nModel: ${AI_EMBEDDING_MODEL}\nDimensions: ${embedding.length}\nPreview: [${preview}${embedding.length > 8 ? ', ...' : ''}]`;
}

async function generateImage(ctx: BotContext, prompt: string, asSticker = false): Promise<string> {
  aiDebug({ prompt: snippet(prompt, 200), asSticker, imageModel: AI_IMAGE_MODEL, endpoint: AI_IMAGE_ENDPOINT }, 'image generation requested');

  if (!AI_IMAGE_MODEL && !IS_IMAGE_PUTER) {
    return 'Set AI_IMAGE_MODEL first to use AI image generation.';
  }

  let buffer: Buffer;
  let mimetype = 'image/png';

  if (IS_IMAGE_PUTER) {
    await replyText(ctx, 'Generating image with Puter AI...');
    const image = await puterAI.generateImage(prompt, {
      model: AI_IMAGE_MODEL,
      onProgress: (progress) => aiDebug(progress, 'puter image progress'),
    });
    buffer = image.buffer;
    mimetype = image.mimeType.startsWith('image/') ? image.mimeType : mimetype;
  } else if (IS_IMAGE_POLLINATIONS) {
    const params = new URLSearchParams({ model: AI_IMAGE_MODEL || '', width: '1024', height: '1024' });
    const image = await fetchBinary(`https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?${params}`, 'image', AI_IMAGE_API_KEY);
    buffer = image.buffer;
    mimetype = image.contentType.startsWith('image/') ? image.contentType : mimetype;
  } else if (IS_IMAGE_GEMINI) {
    const response = await fetch(providerUrl(AI_IMAGE_API_BASE_URL, AI_IMAGE_ENDPOINT, 'generateContent', AI_IMAGE_MODEL), {
      method: 'POST',
      headers: headers(AI_IMAGE_API_BASE_URL, AI_IMAGE_API_KEY),
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['Image'] },
      }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${snippet(text)}`);

    const result = JSON.parse(text);
    const parts = (result?.candidates || []).flatMap((candidate: any) => candidate?.content?.parts || []);
    const inline = parts.map((part: any) => part?.inlineData || part?.inline_data).find((part: any) => part?.data);

    if (inline?.data) {
      buffer = Buffer.from(inline.data, 'base64');
      mimetype = inline.mimeType || inline.mime_type || mimetype;
    } else {
      return 'Your AI provider did not return an image.';
    }
  } else if (IS_IMAGE_CLOUDFLARE) {
    if (!AI_IMAGE_API_KEY) {
      return 'Set AI_IMAGE_API_KEY first to use Cloudflare image generation.';
    }

    const response = await fetch(cloudflareImageUrl(), {
      method: 'POST',
      headers: headers(AI_IMAGE_API_BASE_URL, AI_IMAGE_API_KEY),
      body: JSON.stringify({ prompt }),
    });
    const contentType = response.headers.get('content-type')?.split(';')[0]?.toLowerCase() || 'application/octet-stream';

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${snippet(text)}`);
    }

    if (contentType.startsWith('image/')) {
      buffer = Buffer.from(await response.arrayBuffer());
      mimetype = contentType;
    } else {
      const text = await response.text();
      const result = JSON.parse(text);
      const image = result?.result?.image || result?.image || result?.result;
      if (typeof image !== 'string') return 'Your AI provider did not return an image.';
      buffer = Buffer.from(image.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      mimetype = result?.result?.mime_type || result?.mime_type || mimetype;
    }
  } else {
    const response = await fetch(`${AI_IMAGE_API_BASE_URL}${AI_IMAGE_ENDPOINT}`, {
      method: 'POST',
      headers: headers(AI_IMAGE_API_BASE_URL, AI_IMAGE_API_KEY),
      body: JSON.stringify({ model: AI_IMAGE_MODEL, prompt, n: 1, response_format: 'b64_json' }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${snippet(text)}`);
    const result = JSON.parse(text);
    const image = result?.data?.[0];

    if (image?.b64_json) {
      buffer = Buffer.from(image.b64_json, 'base64');
      mimetype = image.media_type || mimetype;
    } else if (image?.url) {
      const fetched = await fetchBinary(image.url, 'image url');
      buffer = fetched.buffer;
      mimetype = fetched.contentType.startsWith('image/') ? fetched.contentType : mimetype;
    } else {
      return 'Your AI provider did not return an image.';
    }
  }

  if (asSticker) {
    await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
      sticker: await stickerEngine.createSticker(buffer),
      mimetype: 'image/webp',
    });
  } else {
    await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
      image: buffer,
      mimetype,
      caption: prompt,
    });
  }

  remember(ctx, { role: 'user', content: prompt }, { role: 'assistant', content: 'Generated an image.' });
  return asSticker ? 'Generated and sent an AI image as a sticker.' : 'Generated and sent an AI image.';
}

async function generateAudio(ctx: BotContext, input: string): Promise<string> {
  aiDebug({ textLength: input.length, ttsModel: AI_TTS_MODEL, voice: AI_TTS_VOICE }, 'audio generation requested');

  if (!AI_TTS_MODEL && !IS_TTS_PUTER) {
    return 'Set AI_TTS_MODEL first to use AI audio generation.';
  }

  const startedAt = Date.now();
  const audio = IS_TTS_PUTER
    ? await (async () => {
      await replyText(ctx, 'Generating voice with Puter AI...');
      const result = await puterAI.textToSpeech(input, {
        model: AI_TTS_MODEL,
        voice: AI_TTS_VOICE,
        onProgress: (progress) => aiDebug(progress, 'puter text-to-speech progress'),
      });
      return { buffer: result.buffer, contentType: result.mimeType };
    })()
    : IS_TTS_POLLINATIONS
    ? await fetchBinary(
      `https://gen.pollinations.ai/audio/${encodeURIComponent(input.slice(0, 4000))}?${new URLSearchParams({
        model: AI_TTS_MODEL || '',
        voice: AI_TTS_VOICE || '',
      })}`,
      'audio',
      AI_TTS_API_KEY
    )
    : await (async () => {
      const response = await fetch(`${AI_TTS_API_BASE_URL}/audio/speech`, {
        method: 'POST',
        headers: headers(AI_TTS_API_BASE_URL, AI_TTS_API_KEY),
        body: JSON.stringify({
          model: AI_TTS_MODEL,
          input: input.slice(0, 4000),
          voice: AI_TTS_VOICE,
          response_format: 'mp3',
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        aiDebug({ status: response.status, ms: Date.now() - startedAt, body: snippet(body) }, 'audio provider failed');
        throw new Error(`HTTP ${response.status}: ${snippet(body)}`);
      }

      aiDebug({ status: response.status, ms: Date.now() - startedAt }, 'audio provider response');
      return { buffer: Buffer.from(await response.arrayBuffer()), contentType: 'audio/mpeg' };
    })();

  await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
    audio: audio.buffer,
    mimetype: audio.contentType.startsWith('audio/') ? audio.contentType : 'audio/mpeg',
    ptt: true,
  });
  remember(ctx, { role: 'user', content: input }, { role: 'assistant', content: 'Generated voice audio.' });
  return 'Generated and sent voice audio.';
}

async function generateImageFromTool(ctx: BotContext, toolCall: ToolCall): Promise<string> {
  try {
    const args = JSON.parse(toolCall.function.arguments || '{}') as { prompt?: string; as_sticker?: boolean };
    const prompt = args.prompt?.trim();
    if (!prompt) return 'Refused: image prompt is required.';
    return generateImage(ctx, prompt, Boolean(args.as_sticker));
  } catch {
    return 'Refused: invalid image generation arguments.';
  }
}

async function generateAudioFromTool(ctx: BotContext, toolCall: ToolCall): Promise<string> {
  try {
    const args = JSON.parse(toolCall.function.arguments || '{}') as { text?: string };
    const text = args.text?.trim();
    if (!text) return 'Refused: audio text is required.';
    return generateAudio(ctx, text);
  } catch {
    return 'Refused: invalid audio generation arguments.';
  }
}

async function embedTextFromTool(toolCall: ToolCall): Promise<string> {
  try {
    const args = JSON.parse(toolCall.function.arguments || '{}') as { text?: string };
    const text = args.text?.trim();
    if (!text) return 'Refused: text is required.';
    return embedText(text);
  } catch {
    return 'Refused: invalid embedding arguments.';
  }
}

async function runCommand(ctx: BotContext, commandName: string, commandArgs: string[]): Promise<string> {
  aiDebug({ commandName, args: commandArgs }, 'running bot command');

  if (!commandName || commandName === 'ai') return 'Refused: invalid command.';

  const command = commandRegistry.get(commandName);
  if (!command) return `Unknown command: ${commandName}`;

  await command.execute({ ...ctx, args: commandArgs, rawArgs: commandArgs.join(' ') });
  return `Executed ${config.BOT_PREFIX}${command.name}${commandArgs.length ? ` ${commandArgs.join(' ')}` : ''}`;
}

async function runBotCommand(ctx: BotContext, toolCall: ToolCall): Promise<string> {
  try {
    const args = JSON.parse(toolCall.function.arguments || '{}') as { command?: string; args?: unknown };
    const commandName = (args.command || '').replace(config.BOT_PREFIX, '').toLowerCase();
    const commandArgs = Array.isArray(args.args) ? args.args.map(String) : [];
    return runCommand(ctx, commandName, commandArgs);
  } catch {
    return 'Refused: invalid command arguments.';
  }
}

async function fetchUrl(ctx: BotContext, toolCall: ToolCall): Promise<string> {
  const args = JSON.parse(toolCall.function.arguments || '{}') as { url?: string };
  const url = new URL(args.url || '');
  aiDebug({ url: url.toString() }, 'fetch_url requested');

  if (!['http:', 'https:'].includes(url.protocol)) {
    return 'Refused: only http/https URLs are supported.';
  }

  const response = await fetch(url);
  if (!response.ok) return `Fetch failed: HTTP ${response.status}`;

  const contentType = response.headers.get('content-type')?.split(';')[0]?.toLowerCase() || 'application/octet-stream';
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_FETCH_BYTES) return 'Fetch refused: file is over 10 MB.';

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_FETCH_BYTES) return 'Fetch refused: file is over 10 MB.';

  if (/^(text\/|application\/json|application\/xml)/.test(contentType)) {
    return buffer.toString('utf8').slice(0, 6000);
  }

  const fileName = url.pathname.split('/').pop() || 'asset';
  if (contentType.startsWith('image/')) {
    await ctx.socket.sendMessage(ctx.message.key.remoteJid!, { image: buffer, mimetype: contentType, caption: fileName });
    return `Fetched and sent image: ${fileName}`;
  }
  if (contentType.startsWith('audio/')) {
    await ctx.socket.sendMessage(ctx.message.key.remoteJid!, { audio: buffer, mimetype: contentType });
    return `Fetched and sent audio: ${fileName}`;
  }
  if (contentType.startsWith('video/')) {
    await ctx.socket.sendMessage(ctx.message.key.remoteJid!, { video: buffer, mimetype: contentType, caption: fileName });
    return `Fetched and sent video: ${fileName}`;
  }

  await ctx.socket.sendMessage(ctx.message.key.remoteJid!, { document: buffer, mimetype: contentType, fileName });
  return `Fetched and sent file: ${fileName}`;
}

async function runTool(ctx: BotContext, toolCall: ToolCall, userInput: string): Promise<string> {
  aiDebug({ tool: toolCall.function.name, arguments: snippet(toolCall.function.arguments || '', 500) }, 'running tool');

  if (!aiToolAllowedForInput(userInput, toolCall.function.name)) {
    return 'Refused: the user did not explicitly ask for this kind of output. Answer in plain text or ask a short clarification.';
  }

  return toolCall.function.name === 'run_bot_command'
    ? runBotCommand(ctx, toolCall)
    : toolCall.function.name === 'fetch_url'
      ? fetchUrl(ctx, toolCall)
      : toolCall.function.name === 'generate_image'
        ? generateImageFromTool(ctx, toolCall)
        : toolCall.function.name === 'generate_audio'
          ? generateAudioFromTool(ctx, toolCall)
          : toolCall.function.name === 'embed_text'
            ? embedTextFromTool(toolCall)
            : `Unknown tool: ${toolCall.function.name}`;
}

export const AiCommand: Command = {
  name: 'ai',
  aliases: ['ask'],
  category: CommandCategory.AI,
  description: 'Ask "CrystalDust V0" AI or let it use bot commands',
  usage: 'ai <message>',
  async execute(ctx) {
    const input = ctx.args.join(' ').trim();
    aiDebug(
      {
        input: snippet(input, 300),
        provider: IS_PUTER ? 'puter' : IS_GEMINI ? 'gemini' : IS_POLLINATIONS ? 'pollinations' : 'openai-compatible',
        chatModel: AI_MODEL,
        imageModel: AI_IMAGE_MODEL,
        ttsModel: AI_TTS_MODEL,
        sttModel: AI_STT_MODEL,
        embeddingModel: AI_EMBEDDING_MODEL,
        baseUrl: AI_API_BASE_URL,
        toolsEnabled: config.AI_ENABLE_TOOLS,
      },
      'request started'
    );

    if (!input) {
      await replyText(ctx, 'Usage: .ai <message>');
      return;
    }

    try {
      const commandRequest = parseCommandRequest(input);
      if (commandRequest) {
        aiDebug(commandRequest, 'direct command shortcut');
        const result = await runCommand(ctx, commandRequest.command, commandRequest.args);
        remember(ctx, { role: 'user', content: input }, { role: 'assistant', content: result });
        return;
      }

      const imagePrompt = promptFor('image', input);
      if (imagePrompt) {
        aiDebug({ prompt: snippet(imagePrompt, 300) }, 'direct image shortcut');
        const result = await generateImage(ctx, imagePrompt, /\bsticker\b/i.test(input));
        if (!result.startsWith('Generated ')) await replyText(ctx, result);
        return;
      }

      const audioPrompt = promptFor('audio', input);
      if (audioPrompt) {
        aiDebug({ prompt: snippet(audioPrompt, 300) }, 'direct audio shortcut');
        const result = await generateAudio(ctx, audioPrompt);
        if (!result.startsWith('Generated ')) await replyText(ctx, result);
        return;
      }

      const transcriptionUrl = speechToTextUrl(input);
      if (transcriptionUrl) {
        aiDebug({ url: transcriptionUrl }, 'direct speech-to-text shortcut');
        await replyText(ctx, 'Transcribing audio with Puter AI...');
        await replyText(ctx, await transcribeAudio(transcriptionUrl));
        return;
      }

      const imageAnalysis = imageAnalysisRequest(input);
      if (imageAnalysis) {
        aiDebug({ url: imageAnalysis.url, prompt: snippet(imageAnalysis.prompt, 200) }, 'direct image analysis shortcut');
        await replyText(ctx, 'Analyzing image with Puter AI...');
        await replyText(ctx, await analyzeImage(imageAnalysis));
        return;
      }

      const textToEmbed = embeddingInput(input);
      if (textToEmbed) {
        aiDebug({ textLength: textToEmbed.length }, 'direct embedding shortcut');
        await replyText(ctx, await embedText(textToEmbed));
        return;
      }

      if (!IS_PUTER && !AI_API_KEY && !IS_POLLINATIONS) {
        await replyText(ctx, 'Set AI_API_KEY first to use AI chat.');
        return;
      }

      if (!AI_MODEL) {
        await replyText(ctx, 'Set AI_MODEL first to use AI chat.');
        return;
      }

      const savedMemory = readAiMemoryContext(ctx.message.key.remoteJid || '');
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: `You are CrystalDust V0, a helpful WhatsApp assistant made by CrystalDust. Default to concise text replies.
Do not generate images, stickers, audio, voice, embeddings, or run bot commands unless the user explicitly asks for that exact kind of output. Simple questions, greetings, explanations, opinions, jokes, recommendations, and normal chat must be answered as plain text only.
Use generate_image only for explicit image, drawing, picture, sticker, logo, illustration, or visual creation requests; set as_sticker=true when the user asks for a sticker. Use generate_audio only for explicit audio, speech, voice, TTS, or sound requests. Use embed_text only for explicit embedding, vector, or semantic similarity requests. Use run_bot_command only when an existing bot command clearly matches the user's requested bot action. Use fetch_url when the user asks you to inspect or send a public URL. If unsure, ask a short text clarification. Never run ai.
Do not select image or audio output just because the selected model supports it; modality must come from the user's explicit request.
When Puter.js is enabled, you can transcribe public audio URLs and analyze public image URLs only when the user explicitly asks for it.
If the user asks who you are, says hello, asks an opinion, or asks a normal question, reply in text only.
If your model cannot call tools, reply exactly as RUN_COMMAND {"command":"name","args":["arg1"]} only when a bot command should be used.
${IS_GEMINI ? 'Gemini-specific rule: do not emit native functionCall parts. Use plain text RUN_COMMAND JSON for bot commands.' : ''}
Current requester: ${ctx.sender.displayName}${ctx.sender.phoneNumber ? ` (${ctx.sender.phoneNumber})` : ''}.
Use saved chat memory only as background context, and do not claim certainty when the memory is incomplete.
${savedMemory ? `\nSaved chat memory:\n${savedMemory}\n` : ''}

Available commands:
${commandList()}`,
        },
        ...(chatMemory.get(memoryKey(ctx)) || []),
        { role: 'user', content: input },
      ];

      let first = await chat(messages);
      let assistant = first?.choices?.[0]?.message;
      let toolCalls = assistant?.tool_calls as ToolCall[] | undefined;
      let assistantText = textFrom(assistant);
      aiDebug(
        { finishReason: first?.choices?.[0]?.finish_reason, toolCalls: toolCalls?.map((tool) => tool.function.name), text: snippet(assistantText, 500) },
        'chat response parsed'
      );

      if (!assistantText && !toolCalls?.length && isMalformedFunctionCall(first)) {
        aiDebug({ finishReason: first?.choices?.[0]?.finish_reason }, 'retrying malformed function call as text directive');
        first = await chat(noNativeToolRetry(messages), false);
        assistant = first?.choices?.[0]?.message;
        toolCalls = assistant?.tool_calls as ToolCall[] | undefined;
        assistantText = textFrom(assistant);
        aiDebug(
          { finishReason: first?.choices?.[0]?.finish_reason, toolCalls: toolCalls?.map((tool) => tool.function.name), text: snippet(assistantText, 500) },
          'retry chat response parsed'
        );
      }

      if (toolCalls?.length) {
        messages.push({ role: 'assistant', content: assistant.content ?? null, tool_calls: toolCalls });

        for (const toolCall of toolCalls) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: await runTool(ctx, toolCall, input),
          });
        }

        const second = await chat(messages, false);
        const finalText = textFrom(second?.choices?.[0]?.message);
        aiDebug({ finishReason: second?.choices?.[0]?.finish_reason, text: snippet(finalText, 500) }, 'final chat response parsed');
        if (finalText) await replyText(ctx, finalText);
        remember(ctx, { role: 'user', content: input }, { role: 'assistant', content: finalText || 'Used a bot tool.' });
        return;
      }

      const directive = parseCommandDirective(assistantText);
      if (directive) {
        if (!aiToolAllowedForInput(input, 'run_bot_command')) {
          await replyText(ctx, 'Which bot command or action do you want me to run?');
          return;
        }
        aiDebug(directive, 'fallback command directive');
        const result = await runCommand(ctx, directive.command, directive.args);
        remember(ctx, { role: 'user', content: input }, { role: 'assistant', content: result });
        return;
      }

      const xmlToolCall = parseXmlToolCall(assistantText);
      if (xmlToolCall) {
        aiDebug({ tool: xmlToolCall.function.name }, 'fallback xml tool call');
        const result = await runTool(ctx, xmlToolCall, input);
        remember(ctx, { role: 'user', content: input }, { role: 'assistant', content: result });
        return;
      }

      const imageUrl = parseMarkdownImage(assistantText);
      if (imageUrl && aiToolAllowedForInput(input, 'generate_image')) {
        aiDebug({ imageUrl }, 'markdown image fallback');
        await fetchUrl(ctx, {
          id: 'markdown-image',
          type: 'function',
          function: { name: 'fetch_url', arguments: JSON.stringify({ url: imageUrl }) },
        });
        remember(ctx, { role: 'user', content: input }, { role: 'assistant', content: 'Sent image from AI response URL.' });
        return;
      }

      await replyText(ctx, assistantText || 'No AI response.');
      remember(ctx, { role: 'user', content: input }, { role: 'assistant', content: assistantText || 'No AI response.' });
    } catch (err) {
      logger.error({ err, input: config.AI_DEBUG ? snippet(input, 300) : undefined }, '[ai] request failed');
      await replyText(ctx, aiFailureMessage(err));
    }
  },
};

export default AiCommand;
