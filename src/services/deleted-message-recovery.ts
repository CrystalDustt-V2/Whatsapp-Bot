import { downloadContentFromMessage, downloadMediaMessage, proto, type MediaType, type WAMessage, type WAMessageUpdate } from '@whiskeysockets/baileys';
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

function unwrapMessageInfo(message: proto.IMessage | null | undefined, depth = 0): { message: proto.IMessage | null; viewOnce: boolean } {
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

  return { message, viewOnce: hasDirectViewOnce };
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
  const isVo =
    unwrapped.viewOnce ||
    Boolean((unwrapped.message.imageMessage as any)?.viewOnce) ||
    Boolean((unwrapped.message.videoMessage as any)?.viewOnce) ||
    Boolean((unwrapped.message.audioMessage as any)?.viewOnce) ||
    Boolean((unwrapped.message.documentMessage as any)?.viewOnce);

  if (unwrapped.message.audioMessage) return { kind: 'audio', media: unwrapped.message.audioMessage, viewOnce: isVo };
  if (unwrapped.message.videoMessage) return { kind: 'video', media: unwrapped.message.videoMessage, viewOnce: isVo };
  if (unwrapped.message.imageMessage) return { kind: 'image', media: unwrapped.message.imageMessage, viewOnce: isVo };
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

async function downloadRecoverableMedia(message: WAMessage, state: RecoveryState): Promise<RecoverableMediaRecord | undefined> {
  if (!config.DELETED_MESSAGE_MEDIA_ENABLED && !config.VIEW_ONCE_SAVER_ENABLED) return undefined;

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

  let buffer: Buffer | undefined;

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
      { err: downloadErr?.message, messageId: message.key.id, mediaKind: found.kind },
      'Primary stream download failed, attempting downloadMediaMessage fallback...'
    );
    try {
      const normalizedMsg: WAMessage = {
        ...message,
        message: unwrapMessage(message.message) || message.message,
      };
      buffer = (await downloadMediaMessage(normalizedMsg, 'buffer', {})) as Buffer;
    } catch (fallbackErr: any) {
      logger.warn({ err: fallbackErr?.message, messageId: message.key.id }, 'All media download attempts failed');
      return undefined;
    }
  }

  if (!buffer || buffer.length === 0) return undefined;

  const mimetype = found.media.mimetype || '';
  const extension = extensionFromMedia(found.kind, mimetype);
  const fileName = `${safeFilePart(message.key.remoteJid || 'chat')}-${safeFilePart(message.key.id || Date.now().toString())}.${extension}`;
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
): Promise<DeletedMessageRecord | undefined> {
  if (!config.DELETED_MESSAGE_RECOVERY_ENABLED && !config.VIEW_ONCE_SAVER_ENABLED) return undefined;
  if (message.message?.protocolMessage) return undefined;

  const key = messageId(message);
  const chatJid = message.key.remoteJid;
  const id = message.key.id;
  if (!key || !chatJid || !id) return undefined;

  const isKeyViewOnce = Boolean((message.key as any)?.isViewOnce || (message as any)?.isViewOnce);
  const rawType = messageType(message.message);
  const type = rawType.startsWith('viewOnce:') ? rawType : (isKeyViewOnce ? 'viewOnce:media' : rawType);
  const state = loadState();
  let media: RecoverableMediaRecord | undefined;
  try {
    media = await downloadRecoverableMedia(message, state);
  } catch (err) {
    logger.warn({ err, messageId: id, chatJid }, 'Could not cache recoverable media');
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
      },
      isViewOnce
        ? 'Captured view-once media for deleted-media recovery'
        : media
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

  // View-once messages disappear upon viewing; save them to dedicated viewOnce records (and deleted-media storage)
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
    const existingIndex = state.viewOnce.findIndex(
      (item) => item.chatJid === savedViewOnceRecord!.chatJid && item.messageId === savedViewOnceRecord!.messageId
    );
    if (existingIndex >= 0) {
      state.viewOnce[existingIndex] = { ...state.viewOnce[existingIndex], ...savedViewOnceRecord };
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

    // 4a. Check other recorded messages (messages, deleted, viewOnce) for a matching media record
    const state = loadState();
    const sibling = [...(state.viewOnce || []), ...state.deleted, ...state.messages].find(
      (m) => m.messageId === record.messageId && m.media && m !== record
    );
    if (sibling?.media) {
      const siblingBuf = await readDeletedMessageMedia({ media: sibling.media });
      if (siblingBuf) {
        record.media = sibling.media;
        return siblingBuf;
      }
    }

    // 4b. Check local mediaDir for any file matching cleanId
    try {
      if (fs.existsSync(mediaDir)) {
        const files = fs.readdirSync(mediaDir);
        const match = files.find((f) => f.includes(cleanId));
        if (match) {
          const directPath = path.join(mediaDir, match);
          const buf = fs.readFileSync(directPath);
          const ext = path.extname(match).slice(1).toLowerCase();
          const kind: 'audio' | 'video' | 'image' = ['jpg', 'jpeg', 'png', 'webp'].includes(ext)
            ? 'image'
            : ['mp3', 'ogg', 'opus', 'm4a', 'aac', 'wav'].includes(ext)
            ? 'audio'
            : 'video';
          const mimetype =
            kind === 'image'
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

    // 4c. Check MEGA cloud storage by searching for cleanId pattern
    if (config.DELETED_MESSAGE_MEDIA_STORAGE === 'mega') {
      try {
        const megaMatch = await findMegaFileByNamePattern(cleanId);
        if (megaMatch) {
          const buf = await downloadMegaFile(megaMatch.nodeId);
          const ext = path.extname(megaMatch.name).slice(1).toLowerCase();
          const kind: 'audio' | 'video' | 'image' = ['jpg', 'jpeg', 'png', 'webp'].includes(ext)
            ? 'image'
            : ['mp3', 'ogg', 'opus', 'm4a', 'aac', 'wav'].includes(ext)
            ? 'audio'
            : 'video';
          const mimetype =
            kind === 'image'
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

export function findStoredMessageById(chatJid: string, messageId: string): RecoverableMessage | DeletedMessageRecord | null {
  const state = loadState();
  let found: RecoverableMessage | DeletedMessageRecord | undefined;

  // 1. Exact match with chatJid
  found = (state.viewOnce || []).find((m) => (m.chatJid === chatJid || !chatJid) && m.messageId === messageId);
  if (found) return found;
  found = state.deleted.find((m) => (m.chatJid === chatJid || !chatJid) && m.messageId === messageId);
  if (found) return found;
  found = state.messages.find((m) => (m.chatJid === chatJid || !chatJid) && m.messageId === messageId);
  if (found) return found;

  // 2. Global match by messageId across all chats
  found = (state.viewOnce || []).find((m) => m.messageId === messageId);
  if (found) return found;
  found = state.deleted.find((m) => m.messageId === messageId);
  if (found) return found;
  found = state.messages.find((m) => m.messageId === messageId);
  return found || null;
}

export async function cacheAndStoreMedia(
  chatJid: string,
  id: string,
  sender: SenderIdentity,
  buffer: Buffer,
  kind: 'image' | 'video' | 'audio',
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

  if (viewOnce) {
    if (!state.viewOnce) state.viewOnce = [];
    const existingIndex = state.viewOnce.findIndex((item) => item.chatJid === chatJid && item.messageId === id);
    if (existingIndex >= 0) {
      state.viewOnce[existingIndex] = record;
    } else {
      state.viewOnce.push(record);
    }
  } else {
    const existingIndex = state.deleted.findIndex((item) => item.chatJid === chatJid && item.messageId === id);
    if (existingIndex >= 0) {
      state.deleted[existingIndex] = record;
    } else {
      state.deleted.push(record);
    }
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

export function getAllDeletedMessages(): DeletedMessageRecord[] {
  if (!config.DELETED_MESSAGE_RECOVERY_ENABLED) return [];

  return loadState()
    .deleted
    .slice()
    .reverse();
}

export function listAllDeletedMessages(limit?: number): DeletedMessageRecord[] {
  if (!config.DELETED_MESSAGE_RECOVERY_ENABLED) return [];

  const all = getAllDeletedMessages();
  return typeof limit === 'number' && limit > 0 ? all.slice(0, limit) : all;
}

export function listDeletedMessages(chatJid?: string, limit = 30): DeletedMessageRecord[] {
  if (!config.DELETED_MESSAGE_RECOVERY_ENABLED) return [];
  if (!chatJid || chatJid === 'all' || chatJid === 'global') {
    return listAllDeletedMessages(limit);
  }

  return loadState()
    .deleted
    .filter((item) => item.chatJid === chatJid)
    .slice(-boundedNumber(limit, 30, 1, 500))
    .reverse();
}

export function listViewOnceMessages(chatJid?: string, limit = 30): DeletedMessageRecord[] {
  if (!config.VIEW_ONCE_SAVER_ENABLED) return [];
  const state = loadState();
  const isAll = !chatJid || chatJid === 'all' || chatJid === 'global';
  const list = (state.viewOnce || []).filter((item) => {
    return isAll || item.chatJid === chatJid;
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

  for (const item of state.deleted) {
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
