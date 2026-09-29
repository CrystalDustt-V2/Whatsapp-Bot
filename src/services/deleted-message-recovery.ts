import { downloadContentFromMessage, downloadMediaMessage, proto, type MediaType, type WAMessage, type WAMessageUpdate, type WASocket } from '@whiskeysockets/baileys';
import * as fs from 'fs';
import * as path from 'path';
import config from '../config';
import logger from '../core/logger';
import type { SenderIdentity } from '../types';
import { deleteMegaFile, downloadMegaFile, findMegaFileByNamePattern, uploadMegaFile } from './mega-storage';

type RecoverableMessage = {
  chatJid: string;
  messageId: string;
  senderJid: string;
  senderName: string;
  senderNumber: string;
  fromMe: boolean;
  messageType: string;
  text: string;
  media?: RecoverableMediaRecord;
  viewOnce?: boolean;
  timestamp: string;
};

type RecoverableMediaRecord = {
  kind: 'audio' | 'video' | 'image' | 'sticker';
  mimetype: string;
  extension: string;
  fileName: string;
  storage?: 'local' | 'mega';
  path?: string;
  megaNodeId?: string;
  size: number;
  ptt?: boolean;
  viewOnce?: boolean;
};

export type DeletedMessageRecord = RecoverableMessage & {
  deletedAt: string;
  deletedByJid: string;
  deletedByName: string;
  deletedByNumber: string;
};

type RecoveryState = {
  messages: RecoverableMessage[];
  deleted: DeletedMessageRecord[];
  viewOnce: DeletedMessageRecord[];
};

const fallbackPath = path.join(config.SESSION_PATH, 'deleted-messages.json');
const dataPath = resolveDataPath(config.DELETED_MESSAGE_FILE, fallbackPath);
const fallbackMediaDir = path.resolve(process.cwd(), 'deleted-media');
export const mediaDir = resolveDataPath(config.DELETED_MESSAGE_MEDIA_DIR, fallbackMediaDir);
try {
  fs.mkdirSync(mediaDir, { recursive: true });
} catch {
  // Directory initialization
}
let stateCache: RecoveryState | null = null;

function resolveDataPath(value: string | undefined, fallback: string): string {
  const filePath = value?.trim() || fallback;
  return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
}

function boundedNumber(value: number, fallback: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;
}

function maxMessages(): number {
  return boundedNumber(config.DELETED_MESSAGE_MAX_MESSAGES, 500, 10, 10000);
}

function maxDeleted(): number {
  return boundedNumber(config.DELETED_MESSAGE_MAX_DELETED, 100, 5, 5000);
}

function maxTextChars(): number {
  return boundedNumber(config.DELETED_MESSAGE_MAX_TEXT_CHARS, 4000, 50, 20000);
}

function maxMediaBytes(): number {
  return boundedNumber(config.DELETED_MESSAGE_MEDIA_MAX_MB, 25, 1, 200) * 1024 * 1024;
}

function maxMediaTotalBytes(): number {
  const value = boundedNumber(config.DELETED_MESSAGE_MEDIA_MAX_TOTAL_MB, 1024, 0, 102400);
  return value > 0 ? value * 1024 * 1024 : 0;
}

function emptyState(): RecoveryState {
  return { messages: [], deleted: [], viewOnce: [] };
}

function mediaStorage(media: RecoverableMediaRecord): 'local' | 'mega' {
  return media.storage || 'local';
}

function mediaKey(media: RecoverableMediaRecord): string | null {
  if (mediaStorage(media) === 'mega' && media.megaNodeId) return `mega:${media.megaNodeId}`;
  if (media.path) return `local:${path.resolve(media.path)}`;
  return null;
}

function sameMedia(left: RecoverableMediaRecord, right: RecoverableMediaRecord): boolean {
  const leftKey = mediaKey(left);
  const rightKey = mediaKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

function mediaRecords(state: RecoveryState): RecoverableMediaRecord[] {
  return [...state.messages, ...state.deleted, ...(state.viewOnce || [])]
    .map((item) => item.media)
    .filter((item): item is RecoverableMediaRecord => Boolean(item));
}

function uniqueMediaRecords(state: RecoveryState): RecoverableMediaRecord[] {
  const seen = new Set<string>();
  const records: RecoverableMediaRecord[] = [];

  for (const media of mediaRecords(state)) {
    const key = mediaKey(media);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    records.push(media);
  }

  return records;
}

function totalStoredMediaBytes(state: RecoveryState): number {
  return uniqueMediaRecords(state).reduce((total, media) => total + (media.size || 0), 0);
}

function sortedMediaRecords(state: RecoveryState): RecoverableMediaRecord[] {
  const seen = new Set<string>();
  const records = [...state.messages, ...state.deleted, ...(state.viewOnce || [])]
    .filter((item) => item.media)
    .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());

  const result: RecoverableMediaRecord[] = [];
  for (const record of records) {
    const media = record.media!;
    const key = mediaKey(media);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(media);
  }

  return result;
}

async function deleteStoredMedia(media: RecoverableMediaRecord): Promise<void> {
  if (mediaStorage(media) === 'mega') {
    if (media.megaNodeId) await deleteMegaFile(media.megaNodeId);
    return;
  }

  if (!media.path) return;
  const mediaRoot = path.resolve(mediaDir);
  const resolved = path.resolve(media.path);
  if (resolved !== mediaRoot && !resolved.startsWith(`${mediaRoot}${path.sep}`)) return;
  await fs.promises.unlink(resolved).catch(() => undefined);
}

function deleteStoredMediaSoon(media: RecoverableMediaRecord): void {
  void deleteStoredMedia(media).catch((err) => {
    logger.warn({ err, mediaStorage: mediaStorage(media), fileName: media.fileName }, 'Could not delete stale deleted-message media');
  });
}

function removeMediaFromState(state: RecoveryState, media: RecoverableMediaRecord): void {
  for (const item of [...state.messages, ...state.deleted, ...(state.viewOnce || [])]) {
    if (item.media && sameMedia(item.media, media)) delete item.media;
  }
}

async function pruneMediaForIncoming(state: RecoveryState, incomingBytes: number): Promise<boolean> {
  const maxTotal = maxMediaTotalBytes();
  if (!maxTotal) return true;

  if (incomingBytes > maxTotal) {
    logger.warn(
      { incomingMb: (incomingBytes / 1024 / 1024).toFixed(1), maxTotalMb: config.DELETED_MESSAGE_MEDIA_MAX_TOTAL_MB },
      'Skipping deleted-message media cache because it is larger than the total media limit'
    );
    return false;
  }

  let total = totalStoredMediaBytes(state);
  for (const media of sortedMediaRecords(state)) {
    if (total + incomingBytes <= maxTotal) return true;
    await deleteStoredMedia(media);
    total -= media.size || 0;
    removeMediaFromState(state, media);
  }

  return total + incomingBytes <= maxTotal;
}

function removeStaleMediaFiles(previous: RecoveryState, next: RecoveryState): void {
  const retained = new Set(uniqueMediaRecords(next).map((item) => mediaKey(item)).filter(Boolean));

  for (const media of uniqueMediaRecords(previous)) {
    const key = mediaKey(media);
    if (!key || retained.has(key)) continue;
    deleteStoredMediaSoon(media);
  }
}

function loadState(): RecoveryState {
  if (stateCache) return stateCache;

  try {
    const parsed = JSON.parse(fs.readFileSync(dataPath, 'utf8')) as Partial<RecoveryState>;
    stateCache = {
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      deleted: Array.isArray(parsed.deleted) ? parsed.deleted : [],
      viewOnce: Array.isArray(parsed.viewOnce) ? parsed.viewOnce : [],
    };
    return stateCache;
  } catch {
    stateCache = emptyState();
    return stateCache;
  }
}

function saveState(state: RecoveryState): void {
  const nextState = {
    messages: state.messages.slice(-maxMessages()),
    deleted: state.deleted.slice(-maxDeleted()),
    viewOnce: (state.viewOnce || []).slice(-maxDeleted()),
  };
  removeStaleMediaFiles(state, nextState);
  stateCache = nextState;

  try {
    fs.mkdirSync(path.dirname(dataPath), { recursive: true });
    fs.writeFileSync(
      dataPath,
      JSON.stringify(stateCache, null, 2)
    );
  } catch (err) {
    logger.warn({ err }, 'Could not save deleted message recovery cache');
  }
}

function messageIdFromKey(key: proto.IMessageKey | null | undefined): string | null {
  return key?.remoteJid && key.id ? `${key.remoteJid}:${key.id}` : null;
}

function messageId(message: WAMessage): string | null {
  return messageIdFromKey(message.key);
}

export function unwrapMessageInfo(message: proto.IMessage | null | undefined, depth = 0): { message: proto.IMessage | null; viewOnce: boolean } {
  if (!message) return { message: null, viewOnce: false };
  if (depth > 10) return { message, viewOnce: false };

  if (message.deviceSentMessage?.message) {
    const inner = unwrapMessageInfo(message.deviceSentMessage.message, depth + 1);
    return inner;
  }

  const viewOnceMessage =
    message.viewOnceMessage?.message ||
    message.viewOnceMessageV2?.message ||
    message.viewOnceMessageV2Extension?.message;
  if (viewOnceMessage) {
    const inner = unwrapMessageInfo(viewOnceMessage, depth + 1);
    return { message: inner.message, viewOnce: true };
  }

  const wrappedMessage =
    message.ephemeralMessage?.message ||
    message.documentWithCaptionMessage?.message ||
    message.editedMessage?.message;
  if (wrappedMessage) {
    const inner = unwrapMessageInfo(wrappedMessage, depth + 1);
    return inner;
  }

  const hasDirectViewOnce = Boolean(
    (message.imageMessage as any)?.viewOnce ||
    (message.videoMessage as any)?.viewOnce ||
    (message.audioMessage as any)?.viewOnce ||
    (message.documentMessage as any)?.viewOnce
  );

  // If the message has no recognizable media fields but does have a
  // placeholderMessage at the top level, treat it as a view-once stub.
  const hasPlaceholder = Boolean((message as any).placeholderMessage);

  return { message, viewOnce: hasDirectViewOnce || hasPlaceholder };
}

export function unwrapMessage(message: proto.IMessage | null | undefined): proto.IMessage | null {
  return unwrapMessageInfo(message).message;
}

function displayType(type: string): string {
  return type
    .replace(/^viewOnce:/, 'view once ')
    .replace(/Message$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
}

function messageType(message: proto.IMessage | null | undefined): string {
  const unwrapped = unwrapMessageInfo(message);
  const type = unwrapped.message ? Object.keys(unwrapped.message)[0] || 'unknown' : 'unknown';
  return unwrapped.viewOnce ? `viewOnce:${type}` : type;
}

function messageText(message: proto.IMessage | null | undefined, fallback = ''): string {
  const unwrapped = unwrapMessage(message);
  if (!unwrapped) return fallback;

  return (
    unwrapped.conversation ||
    unwrapped.extendedTextMessage?.text ||
    unwrapped.imageMessage?.caption ||
    unwrapped.videoMessage?.caption ||
    unwrapped.documentMessage?.caption ||
    fallback
  );
}

function recoverableMedia(message: proto.IMessage | null | undefined): {
  kind: 'audio' | 'video' | 'image' | 'sticker';
  media: proto.Message.IAudioMessage | proto.Message.IVideoMessage | proto.Message.IImageMessage | proto.Message.IStickerMessage;
  viewOnce: boolean;
} | null {
  const unwrapped = unwrapMessageInfo(message);
  if (!unwrapped.message) return null;
  const isVo =
    unwrapped.viewOnce ||
    Boolean((unwrapped.message.imageMessage as any)?.viewOnce) ||
    Boolean((unwrapped.message.videoMessage as any)?.viewOnce) ||
    Boolean((unwrapped.message.audioMessage as any)?.viewOnce) ||
    Boolean((unwrapped.message.documentMessage as any)?.viewOnce);

  if (unwrapped.message.audioMessage) return { kind: 'audio', media: unwrapped.message.audioMessage, viewOnce: isVo };
  if (unwrapped.message.videoMessage) return { kind: 'video', media: unwrapped.message.videoMessage, viewOnce: isVo };
  if (unwrapped.message.imageMessage) return { kind: 'image', media: unwrapped.message.imageMessage, viewOnce: isVo };
  if (unwrapped.message.stickerMessage) return { kind: 'sticker', media: unwrapped.message.stickerMessage, viewOnce: false };
  return null;
}

function extensionFromMedia(kind: 'audio' | 'video' | 'image' | 'sticker', mimetype: string): string {
  const extension = mimetype.split('/')[1]?.split(';')[0]?.toLowerCase();
  if (extension) return extension === 'mpeg' ? 'mp3' : extension === 'quicktime' ? 'mov' : extension;
  if (kind === 'sticker') return 'webp';
  if (kind === 'image') return 'jpg';
  return kind === 'audio' ? 'ogg' : 'mp4';
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'message';
}

async function storeMediaBuffer(
  base: Omit<RecoverableMediaRecord, 'path' | 'megaNodeId' | 'storage'>,
  buffer: Buffer
): Promise<RecoverableMediaRecord> {
  // Always persist file directly to local deleted-media folder
  const filePath = path.join(mediaDir, base.fileName);
  fs.mkdirSync(mediaDir, { recursive: true });
  fs.writeFileSync(filePath, buffer);

  let megaNodeId: string | undefined;
  let storageType: 'local' | 'mega' = 'local';

  // If MEGA storage configured, also upload to MEGA as cloud backup
  if (config.DELETED_MESSAGE_MEDIA_STORAGE === 'mega') {
    try {
      const uploaded = await uploadMegaFile(base.fileName, buffer);
      megaNodeId = uploaded.id;
      storageType = 'mega';
    } catch (err) {
      logger.warn({ err, fileName: base.fileName }, 'Could not upload deleted-message media to MEGA; local copy preserved in deleted-media');
    }
  }

  return {
    ...base,
    storage: storageType,
    megaNodeId,
    path: filePath,
    size: buffer.length,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

// A view-once (or any) media message can arrive as a "stub": it carries the
// mediaKey but no directPath/url, so downloadContentFromMessage throws
// "No valid media URL or directPath present in message". Detect that state.
export function isMediaStub(media: { mediaKey?: Uint8Array | null; directPath?: string | null; url?: string | null }): boolean {
  const hasKey = Boolean(media.mediaKey && media.mediaKey.length > 0);
  const hasPath = Boolean(media.directPath || media.url);
  return hasKey && !hasPath;
}

// Baileys v6 has no fetchMessage. The way to recover a stubbed media payload is
// the media-retry protocol: socket.updateMediaMessage() asks the server to
// re-upload the media and patches directPath/url onto the message in place.
// It waits on a messages.media-update event with no internal timeout, so we
// guard it with our own timeout to avoid hanging the message pipeline.
export async function triggerMediaRetry(socket: WASocket, message: WAMessage, timeoutMs = 15000): Promise<boolean> {
  if (!message.key.remoteJid || !message.key.id) return false;

  try {
    await withTimeout(socket.updateMediaMessage(message as any), timeoutMs, 'media retry');
    if (config.DELETED_MESSAGE_DEBUG) {
      logger.info(
        { messageId: message.key.id, chatJid: message.key.remoteJid },
        'Media retry succeeded, directPath/url patched onto message'
      );
    }
    return true;
  } catch (err) {
    if (config.DELETED_MESSAGE_DEBUG) {
      logger.debug({ err: (err as Error)?.message, messageId: message.key.id }, 'Media retry did not complete');
    }
    return false;
  }
}

async function downloadRecoverableMedia(message: WAMessage, state: RecoveryState, socket?: WASocket): Promise<RecoverableMediaRecord | undefined> {
  if (!config.DELETED_MESSAGE_MEDIA_ENABLED && !config.VIEW_ONCE_SAVER_ENABLED) return undefined;

  const found = recoverableMedia(message.message);
  if (!found) return undefined;

  const isViewOnceMedia = Boolean(found.viewOnce);
  const maxDownloadAttempts = isViewOnceMedia && socket ? 3 : 1;

  // View-once media frequently arrives as a stub: the mediaKey is present but
  // there is no directPath/url, so the download throws. The media-retry
  // protocol (socket.updateMediaMessage) asks the server to re-upload the
  // media and patches directPath/url onto the message in place.
  let retryArmed = true;
  const tryMediaRetry = async (): Promise<void> => {
    if (!retryArmed || !socket || !isMediaStub(found.media as any)) return;
    retryArmed = false;
    if (config.DELETED_MESSAGE_DEBUG) {
      logger.info(
        { messageId: message.key.id, chatJid: message.key.remoteJid },
        'View-once media arrived as stub, triggering media retry'
      );
    }
    await triggerMediaRetry(socket, message);
  };

  await tryMediaRetry();

  let buffer: Buffer | undefined;

  for (let attempt = 1; attempt <= maxDownloadAttempts; attempt += 1) {
    try {
      const stream = await downloadContentFromMessage(found.media as any, found.kind as MediaType);
      const chunks: Buffer[] = [];
      let size = 0;
      const maxBytes = maxMediaBytes();

      for await (const chunk of stream) {
        const chunkBuf = Buffer.from(chunk);
        size += chunkBuf.length;
        if (size > maxBytes) {
          logger.warn(
            { messageId: message.key.id, mediaKind: found.kind, maxMb: config.DELETED_MESSAGE_MEDIA_MAX_MB },
            'Skipping deleted-message media cache because file is too large'
          );
          return undefined;
        }
        chunks.push(chunkBuf);
      }
      buffer = Buffer.concat(chunks);
    } catch (downloadErr: any) {
      logger.warn(
        { err: downloadErr?.message, messageId: message.key.id, mediaKind: found.kind, attempt },
        'Primary stream download failed, attempting downloadMediaMessage fallback...'
      );
      try {
        const normalizedMsg: WAMessage = {
          ...message,
          message: unwrapMessage(message.message) || message.message,
        };
        buffer = (await downloadMediaMessage(normalizedMsg, 'buffer', {})) as Buffer;
      } catch (fallbackErr: any) {
        logger.warn({ err: fallbackErr?.message, messageId: message.key.id, attempt }, 'Media download attempt failed');
      }
    }

    if (buffer && buffer.length > 0) break;

    // The download failed and the payload is still a stub (the server may have
    // just finished re-uploading). Arm the media retry once more and retry.
    if (attempt < maxDownloadAttempts && socket && isMediaStub(found.media as any)) {
      if (config.DELETED_MESSAGE_DEBUG) {
        logger.info(
          { messageId: message.key.id, chatJid: message.key.remoteJid, attempt },
          'View-once media still stubbed after download attempt, retrying media retry'
        );
      }
      retryArmed = true;
      await tryMediaRetry();
      await sleep(1000);
    }
  }

  if (!buffer || buffer.length === 0) {
    if (isViewOnceMedia) {
      logger.warn(
        { messageId: message.key.id, chatJid: message.key.remoteJid },
        'View-once media could not be downloaded after all attempts'
      );
    }
    return undefined;
  }

  const mimetype = found.media.mimetype || '';
  const extension = extensionFromMedia(found.kind, mimetype);
  const suffix = require('crypto').randomBytes(4).toString('hex');
  const fileName = `${safeFilePart(message.key.remoteJid || 'chat')}-${safeFilePart(message.key.id || Date.now().toString())}-${suffix}.${extension}`;
  const canStore = await pruneMediaForIncoming(state, buffer.length);
  if (!canStore) return undefined;

  const defaultMimetype =
    found.kind === 'audio'
      ? 'audio/ogg'
      : found.kind === 'video'
      ? 'video/mp4'
      : found.kind === 'sticker'
      ? 'image/webp'
      : 'image/jpeg';

  return storeMediaBuffer({
    kind: found.kind,
    mimetype: mimetype || defaultMimetype,
    extension,
    fileName,
    size: buffer.length,
    ptt: found.kind === 'audio' ? Boolean((found.media as proto.Message.IAudioMessage).ptt) : undefined,
    viewOnce: found.viewOnce || undefined,
  }, buffer);
}

function displayText(text: string, type: string): string {
  const trimmed = text.trim();
  if (trimmed) return trimmed.slice(0, maxTextChars());
  return `[${displayType(type)} message]`;
}

function timestampIso(timestampSeconds: number): string {
  const ms = timestampSeconds > 0 ? timestampSeconds * 1000 : Date.now();
  const d = new Date(ms);
  // UTC+8 offset
  const utc8 = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${utc8.getUTCFullYear()}-${pad(utc8.getUTCMonth() + 1)}-${pad(utc8.getUTCDate())}T${pad(utc8.getUTCHours())}:${pad(utc8.getUTCMinutes())}:${pad(utc8.getUTCSeconds())}+08:00`;
}

export const IGNORED_MESSAGE_TYPES = new Set([
  'senderKeyDistributionMessage',
  'protocolMessage',
  'reactionMessage',
  'pollUpdateMessage',
  'messageContextInfo',
  'keepInChatMessage',
  'pinInChatMessage',
  'keyExchangeMessage',
  'bcallMessage',
  'requestPhoneNumberMessage',
  'none',
  'unknown',
]);

export function baseMessageId(id?: string | null): string {
  return (id || '').replace(/-\d+$/, '');
}

function sameStoredMessage(message: RecoverableMessage, keyId: string): boolean {
  return `${message.chatJid}:${message.messageId}` === keyId;
}

function findStoredMessage(state: RecoveryState, key: proto.IMessageKey): RecoverableMessage | null {
  const keyId = messageIdFromKey(key);
  if (!keyId) return null;

  const baseId = baseMessageId(key.id);

  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const item = state.messages[index];
    if (sameStoredMessage(item, keyId)) return item;
    if (baseId && item.chatJid === key.remoteJid && baseMessageId(item.messageId) === baseId) {
      return item;
    }
  }

  return null;
}

function alreadyDeleted(state: RecoveryState, stored: RecoverableMessage): boolean {
  const baseId = baseMessageId(stored.messageId);
  return state.deleted.some(
    (item) => item.chatJid === stored.chatJid && (item.messageId === stored.messageId || (baseId && baseMessageId(item.messageId) === baseId))
  );
}

export async function recordRecoverableMessage(
  message: WAMessage,
  sender: SenderIdentity,
  text: string,
  timestampSeconds: number,
  socket?: WASocket
): Promise<DeletedMessageRecord | undefined> {
  if (!config.DELETED_MESSAGE_RECOVERY_ENABLED && !config.VIEW_ONCE_SAVER_ENABLED) return undefined;
  if (message.message?.protocolMessage) return undefined;

  const key = messageId(message);
  const chatJid = message.key.remoteJid;
  const id = message.key.id;
  if (!key || !chatJid || !id) return undefined;

  const isKeyViewOnce = Boolean((message.key as any)?.isViewOnce || (message as any)?.isViewOnce);
  const rawType = messageType(message.message);

  // Skip protocol / internal handshake messages
  if (IGNORED_MESSAGE_TYPES.has(rawType)) {
    return undefined;
  }

  const type = rawType.startsWith('viewOnce:') ? rawType : (isKeyViewOnce ? 'viewOnce:media' : rawType);
  const state = loadState();
  let media: RecoverableMediaRecord | undefined;
  try {
    media = await downloadRecoverableMedia(message, state, socket);
  } catch (err) {
    logger.warn({ err, messageId: id, chatJid }, 'Could not cache recoverable media');
  }

  // If this message arrived without media, check if a sibling part (e.g. ID-1) already has media
  if (!media && id) {
    const baseId = baseMessageId(id);
    const existing = [...(state.viewOnce || []), ...state.messages].find(
      (m) => m.chatJid === chatJid && baseMessageId(m.messageId) === baseId && m.media
    );
    if (existing?.media) {
      media = existing.media;
    }
  }

  const isViewOnce = Boolean(type.startsWith('viewOnce:') || media?.viewOnce || isKeyViewOnce);

  if (config.DELETED_MESSAGE_DEBUG || (isViewOnce && config.VIEW_ONCE_SAVER_ENABLED)) {
    logger.info(
      {
        chatJid,
        messageId: id,
        messageType: type,
        viewOnce: isViewOnce || undefined,
        mediaKind: media?.kind,
        mediaStorage: media?.storage,
        mediaSize: media?.size,
        mediaPath: media?.path || undefined,
      },
      isViewOnce
        ? (media?.path ? 'Captured view-once media for deleted-media recovery' : 'View-once captured as metadata only (no media bytes)')
        : media?.path
        ? 'Cached recoverable message media'
        : 'Cached recoverable message metadata'
    );
  }

  const defaultText = isKeyViewOnce && !message.message ? '[View-Once media withheld by WhatsApp server for companion devices]' : '';
  const next: RecoverableMessage = {
    chatJid,
    messageId: id,
    senderJid: sender.jid,
    senderName: sender.displayName,
    senderNumber: sender.phoneNumber,
    fromMe: sender.fromMe,
    messageType: type,
    text: displayText(text || messageText(message.message) || defaultText, type),
    media,
    viewOnce: isViewOnce || undefined,
    timestamp: timestampIso(timestampSeconds),
  };

  state.messages = state.messages.filter((item) => !sameStoredMessage(item, key));
  state.messages.push(next);

  let savedViewOnceRecord: DeletedMessageRecord | undefined;

  // View-once messages disappear upon viewing; save them to dedicated viewOnce records
  if (config.VIEW_ONCE_SAVER_ENABLED && isViewOnce) {
    savedViewOnceRecord = {
      ...next,
      deletedAt: timestampIso(timestampSeconds),
      deletedByJid: sender.jid,
      deletedByName: sender.displayName,
      deletedByNumber: sender.phoneNumber,
      viewOnce: true,
    };

    if (!state.viewOnce) state.viewOnce = [];
    const baseId = baseMessageId(id);
    const existingIndex = state.viewOnce.findIndex(
      (item) => item.chatJid === chatJid && (item.messageId === id || baseMessageId(item.messageId) === baseId)
    );
    if (existingIndex >= 0) {
      state.viewOnce[existingIndex] = {
        ...state.viewOnce[existingIndex],
        ...savedViewOnceRecord,
        media: savedViewOnceRecord.media || state.viewOnce[existingIndex].media,
      };
    } else {
      state.viewOnce.push(savedViewOnceRecord);
    }
  }

  saveState(state);
  return savedViewOnceRecord;
}

export function recordDeletedMessageByKey(
  key: proto.IMessageKey | null | undefined,
  deletedBy: SenderIdentity,
  timestampSeconds: number
): DeletedMessageRecord | null {
  if (!config.DELETED_MESSAGE_RECOVERY_ENABLED || !key?.remoteJid || !key.id) return null;

  const state = loadState();
  const stored =
    findStoredMessage(state, key) ||
    (state.viewOnce || []).find((item) => item.chatJid === key.remoteJid && item.messageId === key.id);

  if (!stored) return null;
  if (alreadyDeleted(state, stored)) return null;

  const record: DeletedMessageRecord = {
    ...stored,
    deletedAt: timestampIso(timestampSeconds),
    deletedByJid: deletedBy.jid,
    deletedByName: deletedBy.displayName,
    deletedByNumber: deletedBy.phoneNumber,
  };

  state.deleted.push(record);
  saveState(state);
  return record;
}

export function recordDeletedMessageFromProtocol(
  message: WAMessage,
  deletedBy: SenderIdentity,
  timestampSeconds: number
): DeletedMessageRecord | null {
  const protocolMessage = message.message?.protocolMessage;
  if (protocolMessage?.type !== proto.Message.ProtocolMessage.Type.REVOKE) return null;

  return recordDeletedMessageByKey(protocolMessage.key, deletedBy, timestampSeconds);
}

export function recordDeletedMessageFromUpdate(
  update: WAMessageUpdate,
  deletedBy: SenderIdentity,
  timestampSeconds: number
): DeletedMessageRecord | null {
  const protocolMessage = update.update.message?.protocolMessage;
  if (protocolMessage?.type === proto.Message.ProtocolMessage.Type.REVOKE) {
    return recordDeletedMessageByKey(protocolMessage.key, deletedBy, timestampSeconds);
  }

  const isRevoke =
    (update.update.message === null && Boolean(update.update.key)) ||
    update.update.messageStubType === proto.WebMessageInfo.StubType.REVOKE;

  if (!isRevoke) return null;
  return recordDeletedMessageByKey(update.key, deletedBy, timestampSeconds);
}

export async function readDeletedMessageMedia(record: {
  media?: RecoverableMediaRecord;
  messageId?: string;
  chatJid?: string;
}): Promise<Buffer | null> {
  const media = record.media;

  // 1. Check direct local file path first
  if (media?.path && fs.existsSync(media.path)) {
    try {
      return fs.readFileSync(media.path);
    } catch (err) {
      logger.warn({ err, path: media.path }, 'Error reading local media path');
    }
  }

  // 2. Check mediaDir with fileName
  if (media?.fileName) {
    const directPath = path.join(mediaDir, media.fileName);
    if (fs.existsSync(directPath)) {
      try {
        return fs.readFileSync(directPath);
      } catch (err) {
        logger.warn({ err, path: directPath }, 'Error reading mediaDir file');
      }
    }

    const sessionFallback = path.join(config.SESSION_PATH, 'deleted-media', media.fileName);
    if (fs.existsSync(sessionFallback)) {
      try {
        return fs.readFileSync(sessionFallback);
      } catch (err) {
        logger.warn({ err, path: sessionFallback }, 'Error reading sessionFallback file');
      }
    }
  }

  // 3. Fallback to MEGA cloud download if file has megaNodeId
  if (media?.megaNodeId) {
    try {
      const buffer = await downloadMegaFile(media.megaNodeId);
      if (buffer && media.fileName) {
        // Cache to local deleted-media so future reads are instantaneous
        const directPath = path.join(mediaDir, media.fileName);
        fs.mkdirSync(mediaDir, { recursive: true });
        fs.writeFileSync(directPath, buffer);
      }
      return buffer;
    } catch (err) {
      logger.warn({ err, megaNodeId: media.megaNodeId }, 'Failed to download media from MEGA');
    }
  }

  // 4. If media buffer is still not resolved, attempt deep search by messageId
  if (record.messageId) {
    const cleanId = safeFilePart(record.messageId);
    const baseId = safeFilePart(baseMessageId(record.messageId));

    // 4a. Check other recorded messages (messages, deleted, viewOnce) for a matching media record
    const state = loadState();
    const sibling = [...(state.viewOnce || []), ...state.deleted, ...state.messages].find(
      (m) =>
        (m.messageId === record.messageId ||
          (baseId && baseMessageId(m.messageId) === baseId) ||
          (baseId && m.messageId.includes(baseId))) &&
        m.media &&
        m !== record
    );
    if (sibling?.media) {
      const siblingBuf = await readDeletedMessageMedia({ media: sibling.media });
      if (siblingBuf) {
        record.media = sibling.media;
        return siblingBuf;
      }
    }

    // 4b. Check local mediaDir for any file matching cleanId or baseId
    try {
      if (fs.existsSync(mediaDir)) {
        const files = fs.readdirSync(mediaDir);
        const match = files.find((f) => f.includes(cleanId) || (baseId && f.includes(baseId)));
        if (match) {
          const directPath = path.join(mediaDir, match);
          const buf = fs.readFileSync(directPath);
          const ext = path.extname(match).slice(1).toLowerCase();
          const kind: 'audio' | 'video' | 'image' | 'sticker' = ext === 'webp'
            ? 'sticker'
            : ['jpg', 'jpeg', 'png'].includes(ext)
            ? 'image'
            : ['mp3', 'ogg', 'opus', 'm4a', 'aac', 'wav'].includes(ext)
            ? 'audio'
            : 'video';
          const mimetype =
            kind === 'sticker'
              ? 'image/webp'
              : kind === 'image'
              ? `image/${ext === 'jpg' ? 'jpeg' : ext}`
              : kind === 'audio'
              ? `audio/${ext}`
              : 'video/mp4';
          record.media = {
            kind,
            mimetype,
            extension: ext,
            fileName: match,
            path: directPath,
            size: buf.length,
          };
          return buf;
        }
      }
    } catch (err) {
      logger.warn({ err, messageId: record.messageId }, 'Error scanning local mediaDir for messageId');
    }

    // 4c. Check MEGA cloud storage by searching for cleanId or baseId pattern
    if (config.DELETED_MESSAGE_MEDIA_STORAGE === 'mega') {
      try {
        const megaMatch =
          (await findMegaFileByNamePattern(cleanId)) ||
          (baseId ? await findMegaFileByNamePattern(baseId) : null);
        if (megaMatch) {
          const buf = await downloadMegaFile(megaMatch.nodeId);
          const ext = path.extname(megaMatch.name).slice(1).toLowerCase();
          const kind: 'audio' | 'video' | 'image' | 'sticker' = ext === 'webp'
            ? 'sticker'
            : ['jpg', 'jpeg', 'png'].includes(ext)
            ? 'image'
            : ['mp3', 'ogg', 'opus', 'm4a', 'aac', 'wav'].includes(ext)
            ? 'audio'
            : 'video';
          const mimetype =
            kind === 'sticker'
              ? 'image/webp'
              : kind === 'image'
              ? `image/${ext === 'jpg' ? 'jpeg' : ext}`
              : kind === 'audio'
              ? `audio/${ext}`
              : 'video/mp4';
          const localPath = path.join(mediaDir, megaMatch.name);
          fs.mkdirSync(mediaDir, { recursive: true });
          fs.writeFileSync(localPath, buf);

          record.media = {
            kind,
            mimetype,
            extension: ext,
            fileName: megaMatch.name,
            path: localPath,
            megaNodeId: megaMatch.nodeId,
            storage: 'mega',
            size: buf.length,
          };
          return buf;
        }
      } catch (err) {
        logger.warn({ err, messageId: record.messageId }, 'Error searching MEGA cloud storage for messageId');
      }
    }
  }

  return null;
}

export function unwrapQuotedMessage(message?: proto.IMessage | null, depth = 0): { message: proto.IMessage | null; viewOnce: boolean } {
  if (!message || depth > 10) return { message: message || null, viewOnce: false };

  if (message.deviceSentMessage?.message) {
    return unwrapQuotedMessage(message.deviceSentMessage.message, depth + 1);
  }

  const viewOnceMessage =
    message.viewOnceMessage?.message ||
    message.viewOnceMessageV2?.message ||
    message.viewOnceMessageV2Extension?.message;
  if (viewOnceMessage) {
    const inner = unwrapQuotedMessage(viewOnceMessage, depth + 1);
    return { message: inner.message, viewOnce: true };
  }

  const wrappedMessage =
    message.ephemeralMessage?.message ||
    message.documentWithCaptionMessage?.message ||
    message.editedMessage?.message;
  if (wrappedMessage) {
    const inner = unwrapQuotedMessage(wrappedMessage, depth + 1);
    return inner;
  }

  const hasDirectViewOnce = Boolean(
    (message.imageMessage as any)?.viewOnce ||
    (message.videoMessage as any)?.viewOnce ||
    (message.audioMessage as any)?.viewOnce ||
    (message.documentMessage as any)?.viewOnce
  );

  return { message, viewOnce: hasDirectViewOnce };
}

export function extractMediaFromQuoted(quoted: proto.IMessage): {
  media: proto.Message.IImageMessage | proto.Message.IVideoMessage | proto.Message.IAudioMessage | proto.Message.IStickerMessage;
  kind: 'image' | 'video' | 'audio' | 'sticker';
  viewOnce: boolean;
  caption?: string;
  mimetype: string;
} | null {
  const { message, viewOnce } = unwrapQuotedMessage(quoted);
  if (!message) return null;

  if (message.imageMessage) {
    return {
      media: message.imageMessage,
      kind: 'image',
      viewOnce: viewOnce || Boolean((message.imageMessage as any).viewOnce),
      caption: message.imageMessage.caption || '',
      mimetype: message.imageMessage.mimetype || 'image/jpeg',
    };
  }

  if (message.videoMessage) {
    return {
      media: message.videoMessage,
      kind: 'video',
      viewOnce: viewOnce || Boolean((message.videoMessage as any).viewOnce),
      caption: message.videoMessage.caption || '',
      mimetype: message.videoMessage.mimetype || 'video/mp4',
    };
  }

  if (message.audioMessage) {
    return {
      media: message.audioMessage,
      kind: 'audio',
      viewOnce: viewOnce || Boolean((message.audioMessage as any).viewOnce),
      caption: '',
      mimetype: message.audioMessage.mimetype || 'audio/ogg',
    };
  }

  if (message.stickerMessage) {
    return {
      media: message.stickerMessage,
      kind: 'sticker',
      viewOnce: false,
      caption: '',
      mimetype: message.stickerMessage.mimetype || 'image/webp',
    };
  }

  return null;
}

export function getQuotedContextInfo(message: proto.IMessage | null | undefined): proto.IContextInfo | null | undefined {
  if (!message) return null;
  const unwrapped = unwrapMessage(message) || message;
  return (
    unwrapped?.extendedTextMessage?.contextInfo ||
    (unwrapped as any)?.imageMessage?.contextInfo ||
    (unwrapped as any)?.videoMessage?.contextInfo ||
    (unwrapped as any)?.audioMessage?.contextInfo ||
    (unwrapped as any)?.documentMessage?.contextInfo ||
    (unwrapped as any)?.stickerMessage?.contextInfo ||
    message?.extendedTextMessage?.contextInfo
  );
}

export async function downloadAndCacheQuotedMedia(
  socket: WASocket | undefined,
  contextInfo: proto.IContextInfo,
  currentChatJid: string,
  fallbackSender?: SenderIdentity
): Promise<DeletedMessageRecord | null> {
  const quotedMessage = contextInfo.quotedMessage;
  const quotedStanzaId = contextInfo.stanzaId;
  const quotedParticipant = contextInfo.participant;

  if (quotedStanzaId) {
    const stored = findStoredMessageById(currentChatJid, quotedStanzaId);
    if (stored) {
      const buffer = await readDeletedMessageMedia(stored);
      if (buffer && stored.media) {
        return stored as DeletedMessageRecord;
      }
    }
  }

  if (!quotedMessage) return null;
  const extracted = extractMediaFromQuoted(quotedMessage);
  if (!extracted) return null;

  let buffer: Buffer | undefined;

  try {
    const stream = await downloadContentFromMessage(extracted.media as any, extracted.kind as MediaType);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    buffer = Buffer.concat(chunks);
  } catch (downloadErr: any) {
    logger.warn({ err: downloadErr?.message, stanzaId: quotedStanzaId }, 'Stream download from quoted message failed, attempting fallback...');
    try {
      const fakeMsg: any = {
        key: { remoteJid: currentChatJid, id: quotedStanzaId, participant: quotedParticipant },
        message: quotedMessage,
      };
      buffer = (await downloadMediaMessage(fakeMsg, 'buffer', {})) as Buffer | undefined;
    } catch (fallbackErr: any) {
      logger.warn({ err: fallbackErr?.message, stanzaId: quotedStanzaId }, 'downloadMediaMessage fallback from quoted message failed');
    }
  }

  if ((!buffer || buffer.length === 0) && quotedStanzaId && socket) {
    try {
      const fakeMsg: any = {
        key: { remoteJid: currentChatJid, id: quotedStanzaId, participant: quotedParticipant },
        message: quotedMessage,
      };
      const retried = await triggerMediaRetry(socket, fakeMsg);
      if (retried) {
        const stream = await downloadContentFromMessage(extracted.media as any, extracted.kind as MediaType);
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(Buffer.from(chunk));
        buffer = Buffer.concat(chunks);
      }
    } catch (retryErr) {
      logger.warn({ err: retryErr, stanzaId: quotedStanzaId }, 'Media retry for quoted message failed');
    }
  }

  if (!buffer || buffer.length === 0) return null;

  const senderIdentity: SenderIdentity = {
    jid: quotedParticipant || fallbackSender?.jid || currentChatJid,
    displayName: fallbackSender?.displayName || 'Sender',
    phoneNumber: quotedParticipant?.replace(/\D/g, '') || fallbackSender?.phoneNumber || '',
    chatJid: currentChatJid,
    fromMe: Boolean(contextInfo?.participant ? false : fallbackSender?.fromMe),
  };

  const isVo = Boolean(extracted.viewOnce);
  const savedRecord = await cacheAndStoreMedia(
    currentChatJid,
    quotedStanzaId || `vo-${Date.now()}`,
    senderIdentity,
    buffer,
    extracted.kind,
    extracted.mimetype,
    extracted.caption || '',
    isVo,
    extracted.kind === 'audio' ? Boolean((extracted.media as proto.Message.IAudioMessage).ptt) : false
  );

  return savedRecord;
}

export function findStoredMessageById(chatJid: string, messageId: string): RecoverableMessage | DeletedMessageRecord | null {
  const state = loadState();
  const baseId = baseMessageId(messageId);
  const all = [...(state.viewOnce || []), ...state.deleted, ...state.messages];

  // 1. Exact match with chatJid
  let found = all.find((m) => (m.chatJid === chatJid || !chatJid) && m.messageId === messageId);
  if (found) return found;

  // 2. Base ID match with chatJid
  if (baseId) {
    found = all.find((m) => (m.chatJid === chatJid || !chatJid) && baseMessageId(m.messageId) === baseId);
    if (found) return found;
  }

  // 3. Global exact match across all chats
  found = all.find((m) => m.messageId === messageId);
  if (found) return found;

  // 4. Global base ID match across all chats
  if (baseId) {
    found = all.find((m) => baseMessageId(m.messageId) === baseId);
    if (found) return found;
  }

  return null;
}

export async function cacheAndStoreMedia(
  chatJid: string,
  id: string,
  sender: SenderIdentity,
  buffer: Buffer,
  kind: 'image' | 'video' | 'audio' | 'sticker',
  mimetype: string,
  caption = '',
  viewOnce = true,
  ptt = false
): Promise<DeletedMessageRecord> {
  const state = loadState();
  const extension = extensionFromMedia(kind, mimetype);
  const fileName = `${safeFilePart(chatJid)}-${safeFilePart(id)}.${extension}`;

  const media = await storeMediaBuffer({
    kind,
    mimetype,
    extension,
    fileName,
    size: buffer.length,
    ptt: ptt || undefined,
    viewOnce,
  }, buffer);

  const timestampIsoNow = new Date().toISOString();
  const record: DeletedMessageRecord = {
    chatJid,
    messageId: id,
    senderJid: sender.jid,
    senderName: sender.displayName,
    senderNumber: sender.phoneNumber,
    fromMe: sender.fromMe,
    messageType: viewOnce ? `viewOnce:${kind}Message` : `${kind}Message`,
    text: displayText(caption, `${kind}Message`),
    media,
    viewOnce,
    timestamp: timestampIsoNow,
    deletedAt: timestampIsoNow,
    deletedByJid: sender.jid,
    deletedByName: sender.displayName,
    deletedByNumber: sender.phoneNumber,
  };

  const baseId = baseMessageId(id);

  if (viewOnce) {
    if (!state.viewOnce) state.viewOnce = [];
    const existingIndex = state.viewOnce.findIndex(
      (item) => item.chatJid === chatJid && (item.messageId === id || baseMessageId(item.messageId) === baseId)
    );
    if (existingIndex >= 0) {
      state.viewOnce[existingIndex] = record;
    } else {
      state.viewOnce.push(record);
    }
  } else {
    const existingIndex = state.deleted.findIndex(
      (item) => item.chatJid === chatJid && (item.messageId === id || baseMessageId(item.messageId) === baseId)
    );
    if (existingIndex >= 0) {
      state.deleted[existingIndex] = record;
    } else {
      state.deleted.push(record);
    }
  }

  const msgIndex = state.messages.findIndex(
    (item) => item.chatJid === chatJid && (item.messageId === id || baseMessageId(item.messageId) === baseId)
  );
  if (msgIndex >= 0) {
    state.messages[msgIndex] = { ...state.messages[msgIndex], media, viewOnce };
  } else {
    state.messages.push(record);
  }

  saveState(state);
  return record;
}

export type DeletedChatSummary = {
  chatJid: string;
  count: number;
  lastDeletedAt: string;
  lastSenderName: string;
};

export function getAllDeletedMessages(includeViewOnce = true): DeletedMessageRecord[] {
  if (!config.DELETED_MESSAGE_RECOVERY_ENABLED && !config.VIEW_ONCE_SAVER_ENABLED) return [];

  const state = loadState();
  const deleted = config.DELETED_MESSAGE_RECOVERY_ENABLED ? state.deleted : [];
  const vo = (config.VIEW_ONCE_SAVER_ENABLED && includeViewOnce) ? (state.viewOnce || []) : [];

  const seen = new Set<string>();
  const combined: DeletedMessageRecord[] = [];

  for (const item of deleted) {
    if (IGNORED_MESSAGE_TYPES.has(item.messageType)) continue;
    if (!item.text && !item.media) continue;

    const baseKey = `${item.chatJid}:${baseMessageId(item.messageId)}`;
    seen.add(baseKey);
    combined.push(item);
  }

  for (const item of vo) {
    if (IGNORED_MESSAGE_TYPES.has(item.messageType)) continue;

    const baseKey = `${item.chatJid}:${baseMessageId(item.messageId)}`;
    if (!seen.has(baseKey)) {
      seen.add(baseKey);
      combined.push(item);
    }
  }

  return combined.sort(
    (a, b) => new Date(b.deletedAt || b.timestamp).getTime() - new Date(a.deletedAt || a.timestamp).getTime()
  );
}

export function listAllDeletedMessages(limit?: number, includeViewOnce = true): DeletedMessageRecord[] {
  if (!config.DELETED_MESSAGE_RECOVERY_ENABLED && !config.VIEW_ONCE_SAVER_ENABLED) return [];

  const all = getAllDeletedMessages(includeViewOnce);
  return typeof limit === 'number' && limit > 0 ? all.slice(0, limit) : all;
}

export function listDeletedMessages(chatJid?: string, limit = 30, includeViewOnce = false): DeletedMessageRecord[] {
  if (!config.DELETED_MESSAGE_RECOVERY_ENABLED && !config.VIEW_ONCE_SAVER_ENABLED) return [];
  if (!chatJid || chatJid === 'all' || chatJid === 'global') {
    return listAllDeletedMessages(limit, includeViewOnce);
  }

  return getAllDeletedMessages(includeViewOnce)
    .filter((item) => item.chatJid === chatJid)
    .slice(0, boundedNumber(limit, 30, 1, 500));
}

export function listViewOnceMessages(chatJid?: string, limit = 30): DeletedMessageRecord[] {
  if (!config.VIEW_ONCE_SAVER_ENABLED) return [];
  const state = loadState();
  const isAll = !chatJid || chatJid === 'all' || chatJid === 'global';
  const seen = new Set<string>();
  const list = (state.viewOnce || []).filter((item) => {
    if (IGNORED_MESSAGE_TYPES.has(item.messageType)) return false;
    if (!isAll && item.chatJid !== chatJid) return false;
    const baseKey = `${item.chatJid}:${baseMessageId(item.messageId)}`;
    if (seen.has(baseKey)) return false;
    seen.add(baseKey);
    return true;
  });
  return list.slice(-boundedNumber(limit, 30, 1, 500)).reverse();
}

export function getAllViewOnceMessages(): DeletedMessageRecord[] {
  return listViewOnceMessages('all', maxDeleted());
}

export function listDeletedChats(): DeletedChatSummary[] {
  if (!config.DELETED_MESSAGE_RECOVERY_ENABLED && !config.VIEW_ONCE_SAVER_ENABLED) return [];

  const state = loadState();
  const map = new Map<string, { count: number; lastDeletedAt: string; lastSenderName: string }>();

  for (const item of [...state.deleted, ...(state.viewOnce || [])]) {
    const existing = map.get(item.chatJid);
    if (existing) {
      existing.count += 1;
      if (new Date(item.deletedAt).getTime() > new Date(existing.lastDeletedAt).getTime()) {
        existing.lastDeletedAt = item.deletedAt;
        existing.lastSenderName = item.senderName;
      }
    } else {
      map.set(item.chatJid, {
        count: 1,
        lastDeletedAt: item.deletedAt,
        lastSenderName: item.senderName,
      });
    }
  }

  return Array.from(map.entries())
    .map(([chatJid, data]) => ({
      chatJid,
      count: data.count,
      lastDeletedAt: data.lastDeletedAt,
      lastSenderName: data.lastSenderName,
    }))
    .sort((a, b) => new Date(b.lastDeletedAt).getTime() - new Date(a.lastDeletedAt).getTime());
}
