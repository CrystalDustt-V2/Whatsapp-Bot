import config from '../config';
import { commandRegistry } from '../core/command-registry';
import logger from '../core/logger';
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
const AI_API_KEY = config.AI_API_KEY || config.OPENROUTER_API_KEY;
const IS_POLLINATIONS = AI_API_BASE_URL.includes('pollinations.ai');
const AI_MODEL = config.AI_MODEL || (IS_POLLINATIONS ? 'openai-fast' : config.OPENROUTER_MODEL);
const AI_IMAGE_API_BASE_URL = (config.AI_IMAGE_API_BASE_URL || AI_API_BASE_URL).replace(/\/$/, '');
const AI_IMAGE_API_KEY = config.AI_IMAGE_API_KEY || AI_API_KEY;
const IS_IMAGE_POLLINATIONS = AI_IMAGE_API_BASE_URL.includes('pollinations.ai');
const AI_IMAGE_MODEL = config.AI_IMAGE_MODEL || (IS_IMAGE_POLLINATIONS ? 'sana' : config.OPENROUTER_IMAGE_MODEL);
const AI_IMAGE_ENDPOINT = config.AI_IMAGE_ENDPOINT || (IS_IMAGE_POLLINATIONS ? '/prompt' : config.AI_API_BASE_URL ? '/images/generations' : '/images');
const AI_TTS_API_BASE_URL = (config.AI_TTS_API_BASE_URL || AI_API_BASE_URL).replace(/\/$/, '');
const AI_TTS_API_KEY = config.AI_TTS_API_KEY || AI_API_KEY;
const IS_TTS_POLLINATIONS = AI_TTS_API_BASE_URL.includes('pollinations.ai');
const AI_TTS_MODEL = config.AI_TTS_MODEL || (IS_TTS_POLLINATIONS ? 'openai-audio' : config.OPENROUTER_TTS_MODEL);
const AI_TTS_VOICE = config.AI_TTS_VOICE || (IS_TTS_POLLINATIONS ? 'nova' : config.OPENROUTER_TTS_VOICE);
const MAX_MEMORY_MESSAGES = 12;
const MAX_FETCH_BYTES = 10 * 1024 * 1024;
const chatMemory = new Map<string, ChatMessage[]>();

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

  if (message.includes('HTTP 404') && message.includes('requested endpoint does not exist')) {
    return 'AI image endpoint is not available on this provider. Vision means image input, not image generation.';
  }

  return 'AI request failed. Check your AI provider key/model and try again.';
}

function headers(baseUrl = AI_API_BASE_URL, apiKey = AI_API_KEY): Record<string, string> {
  const result: Record<string, string> = { 'Content-Type': 'application/json' };

  if (apiKey) result.Authorization = `Bearer ${apiKey}`;

  if (baseUrl.includes('openrouter.ai')) {
    result['HTTP-Referer'] = config.DASHBOARD_URL;
    result['X-Title'] = 'WhatsApp Hybrid Bot';
  }

  return result;
}

function apiUrl(path: string): string {
  if (IS_POLLINATIONS && path === '/chat/completions') {
    return AI_API_BASE_URL.includes('gen.pollinations.ai') ? `${AI_API_BASE_URL}${path}` : 'https://gen.pollinations.ai/v1/chat/completions';
  }

  return `${AI_API_BASE_URL}${path}`;
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

async function chat(messages: ChatMessage[], withTools = true) {
  const body: Record<string, unknown> = {
    model: AI_MODEL,
    messages,
    max_tokens: 800,
  };

  if (withTools && config.AI_ENABLE_TOOLS) {
    body.tools = [
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
          description: 'Generate a new image from scratch with AI and send it to WhatsApp. Use this for image creation requests.',
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
          description: 'Generate speech/voice audio from text and send it to WhatsApp.',
          parameters: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Text to speak.' },
            },
            required: ['text'],
          },
        },
      },
    ];
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
      ? [/^(?:image|draw|generate image|create image|make image)\s*:?\s*(.+)$/i, /\b(?:generate|create|make|draw)\b[\s\S]*?\bimage\b(?:\s+(?:of|about)\s+)?([\s\S]+)?$/i]
      : [/^(?:audio|voice|tts|say)\s*:?\s*(.+)$/i, /\b(?:generate|create|make)\b[\s\S]*?\b(?:audio|voice|speech)\b(?:\s+(?:of|saying|about)\s+)?([\s\S]+)?$/i];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) return (match[1]?.trim() || input).trim();
  }

  return null;
}

async function generateImage(ctx: BotContext, prompt: string, asSticker = false): Promise<string> {
  aiDebug({ prompt: snippet(prompt, 200), asSticker, imageModel: AI_IMAGE_MODEL, endpoint: AI_IMAGE_ENDPOINT }, 'image generation requested');

  if (!AI_IMAGE_MODEL) {
    return 'Set AI_IMAGE_MODEL first to use AI image generation.';
  }

  let buffer: Buffer;
  let mimetype = 'image/png';

  if (IS_IMAGE_POLLINATIONS) {
    const params = new URLSearchParams({ model: AI_IMAGE_MODEL, width: '1024', height: '1024' });
    const image = await fetchBinary(`https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?${params}`, 'image', AI_IMAGE_API_KEY);
    buffer = image.buffer;
    mimetype = image.contentType.startsWith('image/') ? image.contentType : mimetype;
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

  if (!AI_TTS_MODEL) {
    return 'Set AI_TTS_MODEL first to use AI audio generation.';
  }

  const startedAt = Date.now();
  const audio = IS_TTS_POLLINATIONS
    ? await fetchBinary(
        `https://gen.pollinations.ai/audio/${encodeURIComponent(input.slice(0, 4000))}?${new URLSearchParams({
          model: AI_TTS_MODEL,
          voice: AI_TTS_VOICE,
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

async function runTool(ctx: BotContext, toolCall: ToolCall): Promise<string> {
  aiDebug({ tool: toolCall.function.name, arguments: snippet(toolCall.function.arguments || '', 500) }, 'running tool');

  return toolCall.function.name === 'run_bot_command'
    ? runBotCommand(ctx, toolCall)
    : toolCall.function.name === 'fetch_url'
      ? fetchUrl(ctx, toolCall)
      : toolCall.function.name === 'generate_image'
        ? generateImageFromTool(ctx, toolCall)
        : toolCall.function.name === 'generate_audio'
          ? generateAudioFromTool(ctx, toolCall)
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
        chatModel: AI_MODEL,
        imageModel: AI_IMAGE_MODEL,
        ttsModel: AI_TTS_MODEL,
        baseUrl: AI_API_BASE_URL,
        toolsEnabled: config.AI_ENABLE_TOOLS,
      },
      'request started'
    );

    if (!input) {
      await replyText(ctx, 'Usage: .ai <message>');
      return;
    }

    if (!AI_API_KEY && !IS_POLLINATIONS) {
      await replyText(ctx, 'Set AI_API_KEY first to use .ai.');
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

      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: `Your name is CrystalDust V0. You were made by your owner, CrystalDust, to live in WhatsApp and behave as a helpful assistant for all users. Answer briefly.
You can generate text, create images, create voice audio, fetch public URLs, and run bot commands. Just like what a normal AI usually can do but you work on whatsapp and you've been given a bot commands capability.
Use generate_image for image creation requests; set as_sticker=true when the user asks for a sticker. Use generate_audio for voice/speech/audio generation. Use run_bot_command when an existing command fits the user's request, especially for menu, stickers, media conversion, downloader, search, fun, group, or utility tasks. Use fetch_url when the user asks you to inspect or send a public URL. Never run ai.
If your model cannot call tools, reply exactly as RUN_COMMAND {"command":"name","args":["arg1"]} when a bot command should be used.

Available commands:
${commandList()}`,
        },
        ...(chatMemory.get(memoryKey(ctx)) || []),
        { role: 'user', content: input },
      ];

      const first = await chat(messages);
      const assistant = first?.choices?.[0]?.message;
      const toolCalls = assistant?.tool_calls as ToolCall[] | undefined;
      const assistantText = textFrom(assistant);
      aiDebug(
        { finishReason: first?.choices?.[0]?.finish_reason, toolCalls: toolCalls?.map((tool) => tool.function.name), text: snippet(assistantText, 500) },
        'chat response parsed'
      );

      if (toolCalls?.length) {
        messages.push({ role: 'assistant', content: assistant.content ?? null, tool_calls: toolCalls });

        for (const toolCall of toolCalls) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: await runTool(ctx, toolCall),
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
        aiDebug(directive, 'fallback command directive');
        const result = await runCommand(ctx, directive.command, directive.args);
        remember(ctx, { role: 'user', content: input }, { role: 'assistant', content: result });
        return;
      }

      const xmlToolCall = parseXmlToolCall(assistantText);
      if (xmlToolCall) {
        aiDebug({ tool: xmlToolCall.function.name }, 'fallback xml tool call');
        const result = await runTool(ctx, xmlToolCall);
        remember(ctx, { role: 'user', content: input }, { role: 'assistant', content: result });
        return;
      }

      const imageUrl = parseMarkdownImage(assistantText);
      if (imageUrl) {
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
