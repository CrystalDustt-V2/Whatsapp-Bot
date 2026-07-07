import { createRequire } from 'module';

import logger from '../core/logger';

export type AIServiceRole = 'system' | 'user' | 'assistant' | 'tool';

export type AIServiceToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

export type AIServiceMessage = {
  role: AIServiceRole;
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: AIServiceToolCall[];
};

export type AIServiceTool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type AIServiceProgress = {
  state: 'loading' | 'retrying' | 'done' | 'error';
  operation: string;
  attempt: number;
  message?: string;
};

export type AIServiceOptions = {
  model?: string;
  provider?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: AIServiceTool[];
  stream?: boolean;
  conversationId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
  testMode?: boolean;
  onProgress?: (progress: AIServiceProgress) => void;
};

export type AIServiceChatResult = {
  text: string;
  toolCalls?: AIServiceToolCall[];
  finishReason?: string;
  raw?: unknown;
};

export type AIServiceStreamChunk = {
  text?: string;
  toolCall?: AIServiceToolCall;
  raw?: unknown;
};

export type AIServiceMediaResult = {
  buffer: Buffer;
  mimeType: string;
  raw?: unknown;
};

export type AIServiceSpeechResult = {
  text: string;
  language?: string;
  duration?: number;
  raw?: unknown;
};

export interface AIService {
  chat(messages: AIServiceMessage[], options?: AIServiceOptions): Promise<AIServiceChatResult>;
  streamChat(messages: AIServiceMessage[], options?: AIServiceOptions): AsyncIterable<AIServiceStreamChunk>;
  generateImage(prompt: string, options?: AIServiceOptions & Record<string, unknown>): Promise<AIServiceMediaResult>;
  textToSpeech(text: string, options?: AIServiceOptions & { voice?: string; language?: string; format?: string }): Promise<AIServiceMediaResult>;
  speechToText(audio: Buffer | string, options?: AIServiceOptions & { mimeType?: string; language?: string }): Promise<AIServiceSpeechResult>;
  analyzeImage(image: Buffer | string, options?: AIServiceOptions & { prompt?: string; mimeType?: string }): Promise<AIServiceChatResult>;
  embedText(input: string | string[], options?: AIServiceOptions): Promise<{ embeddings: number[][]; raw?: unknown }>;
  listModels(provider?: string): Promise<Record<string, unknown>[]>;
  resetConversation(conversationId: string): void;
}

export class AIServiceError extends Error {
  public readonly code: string;
  public readonly cause?: unknown;

  constructor(message: string, code = 'AI_SERVICE_ERROR', cause?: unknown) {
    super(message);
    this.name = 'AIServiceError';
    this.code = code;
    this.cause = cause;
  }
}

type PuterClient = {
  ai: {
    chat: (...args: unknown[]) => Promise<unknown> | AsyncIterable<unknown>;
    txt2img: (...args: unknown[]) => Promise<unknown>;
    txt2speech: (...args: unknown[]) => Promise<unknown>;
    speech2txt: (...args: unknown[]) => Promise<unknown>;
    img2txt?: (...args: unknown[]) => Promise<unknown>;
    listModels?: (provider?: string) => Promise<Record<string, unknown>[]>;
  };
};

type PuterServiceOptions = {
  authToken?: string;
  chatModel?: string;
  imageModel?: string;
  ttsModel?: string;
  ttsVoice?: string;
  sttModel?: string;
  timeoutMs?: number;
  retries?: number;
};

const nodeRequire = createRequire(__filename);
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_RETRIES = 1;
const MAX_HISTORY_MESSAGES = 24;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function splitModels(value?: string): string[] {
  return (value || '')
    .split(/[|,]/)
    .map((model) => model.trim())
    .filter(Boolean);
}

function dataUriToBinary(value: string, fallbackMimeType: string): AIServiceMediaResult | null {
  const match = value.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/i);
  if (!match) return null;

  return {
    buffer: Buffer.from(match[2], 'base64'),
    mimeType: match[1] || fallbackMimeType,
  };
}

async function fetchBinary(url: string, fallbackMimeType: string): Promise<AIServiceMediaResult> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new AIServiceError(`Puter media URL returned HTTP ${response.status}.`, 'PUTER_MEDIA_FETCH_FAILED');
  }

  const mimeType = response.headers.get('content-type')?.split(';')[0]?.toLowerCase() || fallbackMimeType;
  return { buffer: Buffer.from(await response.arrayBuffer()), mimeType };
}

async function mediaFromUnknown(value: unknown, fallbackMimeType: string): Promise<AIServiceMediaResult> {
  if (Buffer.isBuffer(value)) {
    return { buffer: value, mimeType: fallbackMimeType, raw: value };
  }

  if (value instanceof ArrayBuffer) {
    return { buffer: Buffer.from(value), mimeType: fallbackMimeType, raw: value };
  }

  if (ArrayBuffer.isView(value)) {
    return { buffer: Buffer.from(value.buffer, value.byteOffset, value.byteLength), mimeType: fallbackMimeType, raw: value };
  }

  if (typeof value === 'string') {
    const dataUri = dataUriToBinary(value, fallbackMimeType);
    if (dataUri) return { ...dataUri, raw: value };
    if (/^https?:\/\//i.test(value)) return { ...(await fetchBinary(value, fallbackMimeType)), raw: value };
    if (/^[a-z0-9+/=\r\n]+$/i.test(value) && value.length > 256) {
      return { buffer: Buffer.from(value, 'base64'), mimeType: fallbackMimeType, raw: value };
    }
  }

  if (isRecord(value)) {
    if (typeof value.arrayBuffer === 'function') {
      const buffer = Buffer.from(await (value.arrayBuffer as () => Promise<ArrayBuffer>)());
      return { buffer, mimeType: typeof value.type === 'string' && value.type ? value.type : fallbackMimeType, raw: value };
    }

    for (const key of ['src', 'url', 'href', 'data', 'base64', 'image', 'audio', 'result', 'output']) {
      if (key in value) {
        try {
          return { ...(await mediaFromUnknown(value[key], fallbackMimeType)), raw: value };
        } catch {
          // Try the next likely field before giving up.
        }
      }
    }

    if (Array.isArray(value.images) && value.images.length) {
      return { ...(await mediaFromUnknown(value.images[0], fallbackMimeType)), raw: value };
    }
  }

  throw new AIServiceError('Puter did not return downloadable media.', 'PUTER_MEDIA_NOT_FOUND', value);
}

function contentText(value: unknown): string {
  if (typeof value === 'string') return value;

  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === 'string') return part;
        if (isRecord(part)) {
          if (typeof part.text === 'string') return part.text;
          if (typeof part.content === 'string') return part.content;
          if (typeof part.value === 'string') return part.value;
        }
        return '';
      })
      .join('')
      .trim();
  }

  if (isRecord(value)) {
    if (typeof value.text === 'string') return value.text;
    if (typeof value.content === 'string') return value.content;
    if (typeof value.value === 'string') return value.value;
  }

  return '';
}

function normalizeToolCalls(value: unknown): AIServiceToolCall[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const calls = value
    .map((tool, index): AIServiceToolCall | null => {
      if (!isRecord(tool)) return null;
      const fn = isRecord(tool.function) ? tool.function : tool;
      const name = typeof fn.name === 'string' ? fn.name : '';
      if (!name) return null;
      const rawArguments = 'arguments' in fn ? fn.arguments : 'input' in fn ? fn.input : {};

      return {
        id: typeof tool.id === 'string' ? tool.id : `puter-tool-${index}`,
        type: 'function',
        function: {
          name,
          arguments: typeof rawArguments === 'string' ? rawArguments : JSON.stringify(rawArguments || {}),
        },
      };
    })
    .filter((tool): tool is AIServiceToolCall => Boolean(tool));

  return calls.length ? calls : undefined;
}

function binarySource(input: Buffer | string, mimeType: string): string | unknown {
  if (typeof input === 'string') return input;
  const BlobCtor = (globalThis as Record<string, unknown>).Blob as undefined | (new (parts: unknown[], options?: Record<string, unknown>) => unknown);
  if (BlobCtor) return new BlobCtor([input], { type: mimeType });
  return `data:${mimeType};base64,${input.toString('base64')}`;
}

export class PuterAIService implements AIService {
  private clientPromise?: Promise<PuterClient>;
  private warnedNodeVersion = false;
  private readonly histories = new Map<string, AIServiceMessage[]>();

  constructor(private readonly options: PuterServiceOptions) {}

  async chat(messages: AIServiceMessage[], options: AIServiceOptions = {}): Promise<AIServiceChatResult> {
    const client = await this.client();
    const requestMessages = this.messagesWithHistory(messages, options.conversationId);
    const raw = await this.runWithModelFallback('puter.chat', this.models(options.model, this.options.chatModel), options, (model) =>
      client.ai.chat(this.toPuterMessages(requestMessages), this.chatOptions({ ...options, model }), options.testMode)
    );
    const result = this.normalizeChat(raw);
    this.remember(options.conversationId, requestMessages, result);
    return result;
  }

  async *streamChat(messages: AIServiceMessage[], options: AIServiceOptions = {}): AsyncIterable<AIServiceStreamChunk> {
    const client = await this.client();
    const requestMessages = this.messagesWithHistory(messages, options.conversationId);
    const stream = await this.runWithModelFallback('puter.chat.stream', this.models(options.model, this.options.chatModel), options, (model) =>
      client.ai.chat(this.toPuterMessages(requestMessages), { ...this.chatOptions({ ...options, model }), stream: true }, options.testMode)
    );

    if (!stream || typeof (stream as AsyncIterable<unknown>)[Symbol.asyncIterator] !== 'function') {
      yield { text: this.normalizeChat(stream).text, raw: stream };
      return;
    }

    let collected = '';
    for await (const chunk of stream as AsyncIterable<unknown>) {
      const text = isRecord(chunk) ? contentText(chunk.text ?? chunk.content ?? chunk.message) : contentText(chunk);
      const toolCalls = isRecord(chunk) ? normalizeToolCalls(chunk.tool_calls ?? chunk.toolCalls) : undefined;
      if (text) collected += text;
      if (toolCalls?.[0]) yield { toolCall: toolCalls[0], raw: chunk };
      else yield { text, raw: chunk };
    }

    this.remember(options.conversationId, requestMessages, { text: collected });
  }

  async generateImage(prompt: string, options: AIServiceOptions & Record<string, unknown> = {}): Promise<AIServiceMediaResult> {
    const client = await this.client();
    const raw = await this.runWithModelFallback('puter.txt2img', this.models(typeof options.model === 'string' ? options.model : undefined, this.options.imageModel), options, (model) =>
      client.ai.txt2img({ ...this.cleanOptions(options), prompt, model })
    );
    return { ...(await mediaFromUnknown(raw, 'image/png')), raw };
  }

  async textToSpeech(
    text: string,
    options: AIServiceOptions & { voice?: string; language?: string; format?: string } = {}
  ): Promise<AIServiceMediaResult> {
    const client = await this.client();
    const raw = await this.runWithModelFallback('puter.txt2speech', this.models(options.model, this.options.ttsModel), options, (model) =>
      client.ai.txt2speech(text.slice(0, 2990), {
        ...this.cleanOptions(options),
        model,
        voice: options.voice || this.options.ttsVoice,
        language: options.language,
        response_format: options.format || 'mp3',
      })
    );
    return { ...(await mediaFromUnknown(raw, 'audio/mpeg')), raw };
  }

  async speechToText(audio: Buffer | string, options: AIServiceOptions & { mimeType?: string; language?: string } = {}): Promise<AIServiceSpeechResult> {
    const client = await this.client();
    const raw = await this.runWithModelFallback('puter.speech2txt', this.models(options.model, this.options.sttModel), options, (model) =>
      client.ai.speech2txt(binarySource(audio, options.mimeType || 'audio/mpeg'), {
        ...this.cleanOptions(options),
        model,
        language: options.language,
      })
    );

    if (typeof raw === 'string') return { text: raw, raw };
    if (isRecord(raw)) {
      return {
        text: typeof raw.text === 'string' ? raw.text : contentText(raw),
        language: typeof raw.language === 'string' ? raw.language : undefined,
        duration: typeof raw.duration === 'number' ? raw.duration : undefined,
        raw,
      };
    }

    return { text: contentText(raw), raw };
  }

  async analyzeImage(image: Buffer | string, options: AIServiceOptions & { prompt?: string; mimeType?: string } = {}): Promise<AIServiceChatResult> {
    const client = await this.client();
    const source = binarySource(image, options.mimeType || 'image/png');

    if (options.prompt) {
      const raw = await this.runWithModelFallback('puter.image.chat', this.models(options.model, this.options.chatModel), options, (model) =>
        client.ai.chat(options.prompt || 'Describe this image.', source, this.chatOptions({ ...options, model }), options.testMode)
      );
      return this.normalizeChat(raw);
    }

    if (!client.ai.img2txt) {
      throw new AIServiceError('Puter image analysis is not available in this SDK version.', 'PUTER_IMAGE_ANALYSIS_UNAVAILABLE');
    }

    const raw = await this.run('puter.img2txt', () => client.ai.img2txt?.(source, this.cleanOptions(options), options.testMode), options);
    return { text: contentText(raw) || (typeof raw === 'string' ? raw : ''), raw };
  }

  async embedText(): Promise<{ embeddings: number[][]; raw?: unknown }> {
    throw new AIServiceError('Puter.js does not currently expose a documented embeddings API. The AIService interface is ready for it when Puter adds one.', 'PUTER_EMBEDDINGS_UNAVAILABLE');
  }

  async listModels(provider?: string): Promise<Record<string, unknown>[]> {
    const client = await this.client();
    if (!client.ai.listModels) return [];
    return client.ai.listModels(provider);
  }

  resetConversation(conversationId: string): void {
    this.histories.delete(conversationId);
  }

  private async client(): Promise<PuterClient> {
    if (!this.options.authToken) {
      throw new AIServiceError('Set PUTER_AUTH_TOKEN first to use Puter.js AI from the bot server.', 'PUTER_AUTH_TOKEN_MISSING');
    }

    this.warnIfNodeIsOlderThanDocs();
    if (!this.clientPromise) {
      this.clientPromise = Promise.resolve().then(() => {
        const initModule = nodeRequire('@heyputer/puter.js/src/init.cjs') as { init?: (authToken?: string) => PuterClient };
        if (typeof initModule.init !== 'function') {
          throw new AIServiceError('Puter.js init function was not found.', 'PUTER_INIT_MISSING');
        }
        return initModule.init(this.options.authToken);
      });
    }

    return this.clientPromise;
  }

  private warnIfNodeIsOlderThanDocs(): void {
    const major = Number(process.versions.node.split('.')[0]);
    if (major >= 24 || this.warnedNodeVersion) return;
    this.warnedNodeVersion = true;
    logger.warn({ node: process.versions.node }, 'Puter.js official Node guide recommends Node.js 24+.');
  }

  private chatOptions(options: AIServiceOptions): Record<string, unknown> {
    return this.cleanOptions({
      model: options.model || this.options.chatModel,
      provider: options.provider,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      tools: options.tools,
      stream: options.stream,
    });
  }

  private models(...values: Array<string | undefined>): string[] {
    return [...new Set(values.flatMap(splitModels))];
  }

  private cleanOptions(options: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(options).filter(
        ([key, value]) =>
          !['signal', 'timeoutMs', 'retries', 'conversationId', 'onProgress', 'testMode', 'maxTokens', 'format', 'mimeType'].includes(key) &&
          value !== undefined &&
          value !== ''
      )
    );
  }

  private toPuterMessages(messages: AIServiceMessage[]): Record<string, unknown>[] {
    return messages.map((message) =>
      this.cleanOptions({
        role: message.role,
        content: message.content ?? '',
        tool_call_id: message.tool_call_id,
        tool_calls: message.tool_calls?.map((tool) => ({
          id: tool.id,
          function: tool.function,
        })),
      })
    );
  }

  private normalizeChat(raw: unknown): AIServiceChatResult {
    const root = isRecord(raw) ? raw : {};
    const choice = Array.isArray(root.choices) && isRecord(root.choices[0]) ? root.choices[0] : undefined;
    const message = choice && isRecord(choice.message) ? choice.message : isRecord(root.message) ? root.message : root;
    const text = contentText(message.content ?? root.text ?? root.content ?? root.response ?? raw);
    const toolCalls = normalizeToolCalls(message.tool_calls ?? message.toolCalls ?? root.tool_calls ?? root.toolCalls);

    return {
      text,
      toolCalls,
      finishReason:
        (choice && typeof choice.finish_reason === 'string' ? choice.finish_reason : undefined) ||
        (typeof root.finishReason === 'string' ? root.finishReason : undefined) ||
        (typeof root.finish_reason === 'string' ? root.finish_reason : undefined),
      raw,
    };
  }

  private messagesWithHistory(messages: AIServiceMessage[], conversationId?: string): AIServiceMessage[] {
    if (!conversationId) return messages;
    return [...(this.histories.get(conversationId) || []), ...messages];
  }

  private remember(conversationId: string | undefined, requestMessages: AIServiceMessage[], result: Pick<AIServiceChatResult, 'text' | 'toolCalls'>): void {
    if (!conversationId) return;
    const next = [
      ...requestMessages.filter((message) => message.role !== 'system'),
      {
        role: 'assistant' as const,
        content: result.text || null,
        tool_calls: result.toolCalls,
      },
    ].slice(-MAX_HISTORY_MESSAGES);
    this.histories.set(conversationId, next);
  }

  private async runWithModelFallback<T>(
    operation: string,
    models: string[],
    options: AIServiceOptions,
    action: (model?: string) => Promise<T> | T
  ): Promise<T> {
    const candidates = models.length ? models : [undefined];
    let lastError: unknown;

    for (let index = 0; index < candidates.length; index += 1) {
      const model = candidates[index];
      try {
        return await this.run(operation, () => action(model), options);
      } catch (err) {
        lastError = err;
        if (index >= candidates.length - 1 || !this.isRetryable(err)) break;
        logger.warn({ operation, model, nextModel: candidates[index + 1], error: this.errorText(err) }, 'Puter model failed, trying fallback model.');
        options.onProgress?.({
          state: 'retrying',
          operation,
          attempt: index + 1,
          message: `Trying fallback model ${candidates[index + 1]}.`,
        });
      }
    }

    throw this.toServiceError(operation, lastError);
  }

  private async run<T>(operation: string, action: () => Promise<T> | T, options: AIServiceOptions): Promise<T> {
    const attempts = Math.max(1, (options.retries ?? this.options.retries ?? DEFAULT_RETRIES) + 1);
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (options.signal?.aborted) throw new AIServiceError(`${operation} was cancelled.`, 'AI_CANCELLED');
      options.onProgress?.({
        state: attempt === 1 ? 'loading' : 'retrying',
        operation,
        attempt,
        message: attempt === 1 ? 'Request started.' : 'Retrying after a provider error.',
      });

      try {
        const result = await this.withTimeout(Promise.resolve().then(action), options.timeoutMs ?? this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS, options.signal, operation);
        options.onProgress?.({ state: 'done', operation, attempt, message: 'Request completed.' });
        return result;
      } catch (err) {
        lastError = err;
        if (attempt >= attempts || !this.isRetryable(err)) break;
        await delay(300 * attempt);
      }
    }

    options.onProgress?.({ state: 'error', operation, attempt: attempts, message: this.errorText(lastError) });
    throw this.toServiceError(operation, lastError);
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, signal: AbortSignal | undefined, operation: string): Promise<T> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        settled = true;
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
      };
      const abort = () => {
        if (!settled) {
          cleanup();
          reject(new AIServiceError(`${operation} was cancelled.`, 'AI_CANCELLED'));
        }
      };
      const timeout = setTimeout(() => {
        if (!settled) {
          cleanup();
          reject(new AIServiceError(`${operation} timed out after ${timeoutMs}ms.`, 'AI_TIMEOUT'));
        }
      }, timeoutMs);

      signal?.addEventListener('abort', abort, { once: true });
      promise.then(
        (value) => {
          cleanup();
          resolve(value);
        },
        (err) => {
          cleanup();
          reject(err);
        }
      );
    });
  }

  private isRetryable(err: unknown): boolean {
    if (err instanceof AIServiceError && ['AI_CANCELLED', 'PUTER_EMBEDDINGS_UNAVAILABLE'].includes(err.code)) return false;
    const message = this.errorText(err);
    if (/HTTP\s+(400|401|403|404)/i.test(message)) return false;
    return /timeout|network|fetch|socket|ECONN|ETIMEDOUT|HTTP\s+(408|409|429|5\d\d)/i.test(message);
  }

  private toServiceError(operation: string, err: unknown): AIServiceError {
    if (err instanceof AIServiceError) return err;
    return new AIServiceError(`${operation} failed: ${this.errorText(err)}`, 'AI_PROVIDER_FAILED', err);
  }

  private errorText(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}

export function createPuterAIService(options: PuterServiceOptions): AIService {
  return new PuterAIService(options);
}
