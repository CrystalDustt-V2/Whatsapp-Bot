import { downloadContentFromMessage, proto, type MediaType, type WAMessage, type WAMessageUpdate } from '@whiskeysockets/baileys';
import * as fs from 'fs';
import * as path from 'path';
import config from '../config';
import logger from '../core/logger';
import type { SenderIdentity } from '../types';
import { deleteMegaFile, downloadMegaFile, uploadMegaFile } from './mega-storage';

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
  kind: 'audio' | 'video' | 'image';
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
};

const fallbackPath = path.join(config.SESSION_PATH, 'deleted-messages.json');
const dataPath = resolveDataPath(config.DELETED_MESSAGE_FILE, fallbackPath);
const fallbackMediaDir = path.join(config.SESSION_PATH, 'deleted-media');
const mediaDir = resolveDataPath(config.DELETED_MESSAGE_MEDIA_DIR, fallbackMediaDir);
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
  return { messages: [], deleted: [] };
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
  return [...state.messages, ...state.deleted]
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
  const records = [...state.messages, ...state.deleted]
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
  for (const item of [...state.messages, ...state.deleted]) {
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

function unwrapMessageInfo(message: proto.IMessage | null | undefined, depth = 0): { message: proto.IMessage | null; viewOnce: boolean } {
  if (!message) return { message: null, viewOnce: false };
  if (depth > 8) return { message, viewOnce: false };

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
  if (wrappedMessage) return unwrapMessageInfo(wrappedMessage, depth + 1);

  return { message, viewOnce: false };
}

function unwrapMessage(message: proto.IMessage | null | undefined): proto.IMessage | null {
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
  kind: 'audio' | 'video' | 'image';
  media: proto.Message.IAudioMessage | proto.Message.IVideoMessage | proto.Message.IImageMessage;
  viewOnce: boolean;
} | null {
  const unwrapped = unwrapMessageInfo(message);
  if (!unwrapped.message) return null;
  if (unwrapped.message.audioMessage) return { kind: 'audio', media: unwrapped.message.audioMessage, viewOnce: unwrapped.viewOnce };
  if (unwrapped.message.videoMessage) return { kind: 'video', media: unwrapped.message.videoMessage, viewOnce: unwrapped.viewOnce };
  if (unwrapped.message.imageMessage) return { kind: 'image', media: unwrapped.message.imageMessage, viewOnce: unwrapped.viewOnce };
  return null;
}

function extensionFromMedia(kind: 'audio' | 'video' | 'image', mimetype: string): string {
  const extension = mimetype.split('/')[1]?.split(';')[0]?.toLowerCase();
  if (extension) return extension === 'mpeg' ? 'mp3' : extension === 'quicktime' ? 'mov' : extension;
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
  if (config.DELETED_MESSAGE_MEDIA_STORAGE === 'mega') {
    try {
      const uploaded = await uploadMegaFile(base.fileName, buffer);
      return {
        ...base,
        storage: 'mega',
        megaNodeId: uploaded.id,
        size: uploaded.size || base.size,
      };
    } catch (err) {
      logger.warn({ err, fileName: base.fileName }, 'Could not upload deleted-message media to MEGA; storing locally instead');
    }
  }

  const filePath = path.join(mediaDir, base.fileName);
  fs.mkdirSync(mediaDir, { recursive: true });
  fs.writeFileSync(filePath, buffer);
  return {
    ...base,
    storage: 'local',
    path: filePath,
  };
}

async function downloadRecoverableMedia(message: WAMessage, state: RecoveryState): Promise<RecoverableMediaRecord | undefined> {
  if (!config.DELETED_MESSAGE_MEDIA_ENABLED) return undefined;

  const found = recoverableMedia(message.message);
  if (!found) {
    const unwrapped = unwrapMessageInfo(message.message);
    if (config.DELETED_MESSAGE_DEBUG && unwrapped.viewOnce) {
      logger.info(
        {
          messageId: message.key.id,
          chatJid: message.key.remoteJid,
          innerTypes: unwrapped.message ? Object.keys(unwrapped.message) : [],
        },
        'View-once message had no recoverable media payload'
      );
    }
    return undefined;
  }

  const stream = await downloadContentFromMessage(found.media as any, found.kind as MediaType);
  const chunks: Buffer[] = [];
  let size = 0;
  const maxBytes = maxMediaBytes();

  for await (const chunk of stream) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      logger.warn(
        { messageId: message.key.id, mediaKind: found.kind, maxMb: config.DELETED_MESSAGE_MEDIA_MAX_MB },
        'Skipping deleted-message media cache because file is too large'
      );
      return undefined;
    }
    chunks.push(buffer);
  }

  const mimetype = found.media.mimetype || '';
  const extension = extensionFromMedia(found.kind, mimetype);
  const fileName = `${safeFilePart(message.key.remoteJid || 'chat')}-${safeFilePart(message.key.id || Date.now().toString())}.${extension}`;
  const buffer = Buffer.concat(chunks);
  const canStore = await pruneMediaForIncoming(state, buffer.length);
  if (!canStore) return undefined;

  return storeMediaBuffer({
    kind: found.kind,
    mimetype: mimetype || (found.kind === 'audio' ? 'audio/ogg' : found.kind === 'video' ? 'video/mp4' : 'image/jpeg'),
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
  return timestampSeconds > 0 ? new Date(timestampSeconds * 1000).toISOString() : new Date().toISOString();
}

function sameStoredMessage(message: RecoverableMessage, keyId: string): boolean {
  return `${message.chatJid}:${message.messageId}` === keyId;
}

function findStoredMessage(state: RecoveryState, key: proto.IMessageKey): RecoverableMessage | null {
  const keyId = messageIdFromKey(key);
  if (!keyId) return null;

  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const item = state.messages[index];
    if (sameStoredMessage(item, keyId)) return item;
  }

  return null;
}

function alreadyDeleted(state: RecoveryState, stored: RecoverableMessage): boolean {
  return state.deleted.some(
    (item) => item.chatJid === stored.chatJid && item.messageId === stored.messageId
  );
}

export async function recordRecoverableMessage(
  message: WAMessage,
  sender: SenderIdentity,
  text: string,
  timestampSeconds: number
): Promise<void> {
  if (!config.DELETED_MESSAGE_RECOVERY_ENABLED) return;
  if (message.message?.protocolMessage) return;

  const key = messageId(message);
  const chatJid = message.key.remoteJid;
  const id = message.key.id;
  if (!key || !chatJid || !id) return;

  const type = messageType(message.message);
  const state = loadState();
  let media: RecoverableMediaRecord | undefined;
  try {
    media = await downloadRecoverableMedia(message, state);
  } catch (err) {
    logger.warn({ err, messageId: id, chatJid }, 'Could not cache deleted-message media');
  }

  if (config.DELETED_MESSAGE_DEBUG) {
    logger.info(
      {
        chatJid,
        messageId: id,
        messageType: type,
        viewOnce: type.startsWith('viewOnce:') || undefined,
        mediaKind: media?.kind,
        mediaStorage: media?.storage,
        mediaSize: media?.size,
      },
      media ? 'Cached recoverable message media' : 'Cached recoverable message metadata'
    );
  }

  const next: RecoverableMessage = {
    chatJid,
    messageId: id,
    senderJid: sender.jid,
    senderName: sender.displayName,
    senderNumber: sender.phoneNumber,
    fromMe: sender.fromMe,
    messageType: type,
    text: displayText(text || messageText(message.message), type),
    media,
    viewOnce: type.startsWith('viewOnce:') || undefined,
    timestamp: timestampIso(timestampSeconds),
  };

  state.messages = state.messages.filter((item) => !sameStoredMessage(item, key));
  state.messages.push(next);
  saveState(state);
}

export function recordDeletedMessageByKey(
  key: proto.IMessageKey | null | undefined,
  deletedBy: SenderIdentity,
  timestampSeconds: number
): DeletedMessageRecord | null {
  if (!config.DELETED_MESSAGE_RECOVERY_ENABLED || !key?.remoteJid || !key.id) return null;

  const state = loadState();
  const stored = findStoredMessage(state, key);
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

export async function readDeletedMessageMedia(record: DeletedMessageRecord): Promise<Buffer | null> {
  const media = record.media;
  if (!media) return null;

  if (mediaStorage(media) === 'mega') {
    return media.megaNodeId ? downloadMegaFile(media.megaNodeId) : null;
  }

  if (!media.path || !fs.existsSync(media.path)) return null;
  return fs.readFileSync(media.path);
}

export function listDeletedMessages(chatJid: string, limit = 10): DeletedMessageRecord[] {
  if (!config.DELETED_MESSAGE_RECOVERY_ENABLED || !chatJid) return [];

  return loadState()
    .deleted
    .filter((item) => item.chatJid === chatJid)
    .slice(-boundedNumber(limit, 10, 1, 50))
    .reverse();
}
