import { proto, type WAMessage, type WAMessageUpdate } from '@whiskeysockets/baileys';
import * as fs from 'fs';
import * as path from 'path';
import config from '../config';
import logger from '../core/logger';
import type { SenderIdentity } from '../types';

type RecoverableMessage = {
  chatJid: string;
  messageId: string;
  senderJid: string;
  senderName: string;
  senderNumber: string;
  fromMe: boolean;
  messageType: string;
  text: string;
  timestamp: string;
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

function emptyState(): RecoveryState {
  return { messages: [], deleted: [] };
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
  stateCache = {
    messages: state.messages.slice(-maxMessages()),
    deleted: state.deleted.slice(-maxDeleted()),
  };

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

function unwrapMessage(message: proto.IMessage | null | undefined): proto.IMessage | null {
  if (!message) return null;

  return (
    message.viewOnceMessage?.message ||
    message.viewOnceMessageV2?.message ||
    message.viewOnceMessageV2Extension?.message ||
    message.ephemeralMessage?.message ||
    message.documentWithCaptionMessage?.message ||
    message.editedMessage?.message ||
    message
  );
}

function messageType(message: proto.IMessage | null | undefined): string {
  const unwrapped = unwrapMessage(message);
  return unwrapped ? Object.keys(unwrapped)[0] || 'unknown' : 'unknown';
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

function displayText(text: string, type: string): string {
  const trimmed = text.trim();
  if (trimmed) return trimmed.slice(0, maxTextChars());
  return `[${type.replace(/Message$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()} message]`;
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

export function recordRecoverableMessage(
  message: WAMessage,
  sender: SenderIdentity,
  text: string,
  timestampSeconds: number
): void {
  if (!config.DELETED_MESSAGE_RECOVERY_ENABLED) return;
  if (message.message?.protocolMessage) return;

  const key = messageId(message);
  const chatJid = message.key.remoteJid;
  const id = message.key.id;
  if (!key || !chatJid || !id) return;

  const type = messageType(message.message);
  const state = loadState();
  const next: RecoverableMessage = {
    chatJid,
    messageId: id,
    senderJid: sender.jid,
    senderName: sender.displayName,
    senderNumber: sender.phoneNumber,
    fromMe: sender.fromMe,
    messageType: type,
    text: displayText(text || messageText(message.message), type),
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
  const isRevoke =
    (update.update.message === null && Boolean(update.update.key)) ||
    update.update.messageStubType === proto.WebMessageInfo.StubType.REVOKE;

  if (!isRevoke) return null;
  return recordDeletedMessageByKey(update.key, deletedBy, timestampSeconds);
}

export function listDeletedMessages(chatJid: string, limit = 10): DeletedMessageRecord[] {
  if (!config.DELETED_MESSAGE_RECOVERY_ENABLED || !chatJid) return [];

  return loadState()
    .deleted
    .filter((item) => item.chatJid === chatJid)
    .slice(-boundedNumber(limit, 10, 1, 50))
    .reverse();
}
