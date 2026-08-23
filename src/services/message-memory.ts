import type { WAMessage, WASocket } from '@whiskeysockets/baileys';
import * as fs from 'fs';
import * as path from 'path';
import config from '../config';
import logger from '../core/logger';
import type { SenderIdentity } from '../types';

type StoredContact = {
  jid: string;
  phoneNumber: string;
  profileName?: string;
  displayName: string;
  updatedAt: string;
};

type AiMemoryEntry = {
  ts: string;
  chatJid: string;
  messageId?: string;
  senderJid: string;
  senderName: string;
  senderNumber: string;
  fromMe: boolean;
  messageType: string;
  text: string;
};

const contactsPath = path.join(config.SESSION_PATH, 'contacts.json');
const aiMemoryPath = resolveDataPath(config.AI_MEMORY_FILE, path.join(config.SESSION_PATH, 'ai-memory.jsonl'));
let contacts: Record<string, StoredContact> | null = null;

function resolveDataPath(value: string | undefined, fallback: string): string {
  const filePath = value?.trim() || fallback;
  return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
}

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readContacts(): Record<string, StoredContact> {
  if (contacts) return contacts;

  try {
    contacts = JSON.parse(fs.readFileSync(contactsPath, 'utf8')) as Record<string, StoredContact>;
  } catch {
    contacts = {};
  }

  return contacts;
}

function saveContacts(): void {
  try {
    ensureDir(contactsPath);
    fs.writeFileSync(contactsPath, JSON.stringify(readContacts(), null, 2));
  } catch (err) {
    logger.warn({ err }, 'Could not save contact identity cache');
  }
}

function cleanName(value: unknown): string | undefined {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  return name || undefined;
}

function jidNumber(jid: string): string {
  return jid.split('@')[0].split(':')[0].replace(/\D/g, '');
}

function senderJid(message: WAMessage, socket: WASocket): string {
  const remoteJid = message.key.remoteJid || '';
  const userJid = socket.user?.id || '';

  if (remoteJid.endsWith('@g.us')) {
    return message.key.participant || (message.key.fromMe ? userJid : remoteJid);
  }

  return message.key.fromMe ? userJid || remoteJid : remoteJid;
}

export function getSenderIdentity(message: WAMessage, socket: WASocket): SenderIdentity {
  const jid = senderJid(message, socket);
  const stored = readContacts()[jid];
  const profileName = cleanName(message.pushName) || (message.key.fromMe ? cleanName(socket.user?.name) || config.OWNER_NAME : stored?.profileName);
  const phoneNumber = jidNumber(jid) || stored?.phoneNumber || jid;
  const displayName = profileName || phoneNumber || jid;
  const identity: SenderIdentity = {
    jid,
    phoneNumber,
    profileName,
    displayName,
    chatJid: message.key.remoteJid || '',
    fromMe: Boolean(message.key.fromMe),
  };

  if (
    !stored ||
    stored.phoneNumber !== phoneNumber ||
    stored.profileName !== profileName ||
    stored.displayName !== displayName
  ) {
    readContacts()[jid] = {
      jid,
      phoneNumber,
      profileName,
      displayName,
      updatedAt: new Date().toISOString(),
    };
    saveContacts();
  }

  return identity;
}

function boundedNumber(value: number, fallback: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;
}

function memoryLimit(): number {
  return boundedNumber(config.AI_MEMORY_MAX_MESSAGES, 80, 1, 5000);
}

function maxTextChars(): number {
  return boundedNumber(config.AI_MEMORY_MAX_TEXT_CHARS, 1000, 50, 10000);
}

function maxMemoryBytes(): number {
  return Math.max(1, Number.isFinite(config.AI_MEMORY_MAX_MB) ? config.AI_MEMORY_MAX_MB : 5) * 1024 * 1024;
}

function safeJsonParse(line: string): AiMemoryEntry | null {
  try {
    return JSON.parse(line) as AiMemoryEntry;
  } catch {
    return null;
  }
}

function readMemoryEntries(): AiMemoryEntry[] {
  try {
    return fs
      .readFileSync(aiMemoryPath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(safeJsonParse)
      .filter((entry): entry is AiMemoryEntry => Boolean(entry));
  } catch {
    return [];
  }
}

function compactMemoryIfNeeded(): void {
  try {
    if (!fs.existsSync(aiMemoryPath) || fs.statSync(aiMemoryPath).size < maxMemoryBytes()) return;

    if (config.AI_MEMORY_OVERFLOW_MODE === 'overwrite') {
      fs.writeFileSync(aiMemoryPath, '');
      return;
    }

    const kept = readMemoryEntries().slice(-memoryLimit());
    fs.writeFileSync(aiMemoryPath, kept.map((entry) => JSON.stringify(entry)).join('\n') + (kept.length ? '\n' : ''));
  } catch (err) {
    logger.warn({ err }, 'Could not compact AI memory file');
  }
}

export function recordAiMemoryMessage(
  message: WAMessage,
  sender: SenderIdentity,
  text: string,
  messageType: string,
  timestampSeconds: number
): void {
  if (!config.AI_MEMORY_ENABLED) return;

  try {
    ensureDir(aiMemoryPath);
    const ts = timestampSeconds > 0 ? new Date(timestampSeconds * 1000).toISOString() : new Date().toISOString();
    const safeText = (text.trim() || `[${messageType}]`).slice(0, maxTextChars());
    const messageId = message.key.id || undefined;
    if (
      messageId &&
      readMemoryEntries()
        .slice(-5000)
        .some((entry) => entry.chatJid === (message.key.remoteJid || sender.chatJid) && entry.messageId === messageId)
    ) {
      return;
    }

    const entry: AiMemoryEntry = {
      ts,
      chatJid: message.key.remoteJid || sender.chatJid,
      messageId,
      senderJid: sender.jid,
      senderName: sender.displayName,
      senderNumber: sender.phoneNumber,
      fromMe: sender.fromMe,
      messageType,
      text: safeText,
    };

    fs.appendFileSync(aiMemoryPath, `${JSON.stringify(entry)}\n`);
    compactMemoryIfNeeded();
  } catch (err) {
    logger.warn({ err }, 'Could not write AI memory message');
  }
}

export function readAiMemoryContext(chatJid: string, maxChars = 30000): string {
  if (!config.AI_MEMORY_ENABLED || !chatJid) return '';

  const entries = readMemoryEntries().filter((entry) => entry.chatJid === chatJid).slice(-memoryLimit());
  if (!entries.length) return '';
  const limit = boundedNumber(maxChars, 30000, 500, 100000);

  const people = new Map<string, AiMemoryEntry>();
  for (const entry of entries) {
    people.set(entry.senderJid, entry);
  }

  const peopleLines = Array.from(people.values())
    .slice(-30)
    .map((entry) => `- ${entry.senderName}${entry.senderNumber ? ` (${entry.senderNumber})` : ''}`);
  const peopleBlock = `Known people in this chat:\n${peopleLines.join('\n')}`;
  const messageLines: string[] = [];
  let used = peopleBlock.length + '\n\nRecent messages in this chat:\n'.length;

  for (const entry of entries.slice().reverse()) {
    const line = `[${entry.ts}] ${entry.senderName}: ${entry.text}`;
    if (used + line.length + 1 > limit) break;
    messageLines.unshift(line);
    used += line.length + 1;
  }

  return `${peopleBlock}\n\nRecent messages in this chat:\n${messageLines.join('\n')}`;
}
