import type { WAMessage, WASocket } from '@whiskeysockets/baileys';
import * as fs from 'fs';
import * as path from 'path';
import config from '../config';
import logger from '../core/logger';
import type { SenderIdentity } from '../types';

type StoredContact = {
  jid: string;
  phoneNumber: string;
  savedName?: string;
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

export function readContacts(): Record<string, StoredContact> {
  try {
    if (fs.existsSync(contactsPath)) {
      contacts = JSON.parse(fs.readFileSync(contactsPath, 'utf8')) as Record<string, StoredContact>;
      return contacts;
    }
  } catch {}
  if (!contacts) contacts = {};
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

  if (remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') {
    return message.key.participant || (message.key.fromMe ? userJid : remoteJid);
  }

  return message.key.fromMe ? userJid || remoteJid : remoteJid;
}

export function syncContacts(newContacts: Array<{ id?: string; name?: string; notify?: string; verifiedName?: string; lid?: string; jid?: string }>): void {
  if (!Array.isArray(newContacts) || !newContacts.length) return;
  const stored = readContacts();
  let changed = false;

  for (const c of newContacts) {
    if (!c) continue;
    let rawJid = c.jid || c.id || '';
    if (!rawJid || rawJid.endsWith('@g.us') || rawJid.endsWith('@newsletter') || rawJid === 'status@broadcast') continue;

    let jid = '';
    if (rawJid.endsWith('@s.whatsapp.net')) {
      jid = rawJid.split('@')[0].split(':')[0] + '@s.whatsapp.net';
    } else if (rawJid.endsWith('@lid')) {
      if (c.jid && c.jid.endsWith('@s.whatsapp.net')) {
        jid = c.jid.split('@')[0].split(':')[0] + '@s.whatsapp.net';
      } else {
        jid = rawJid;
      }
    } else if (/^\d+$/.test(rawJid)) {
      jid = `${rawJid}@s.whatsapp.net`;
    } else {
      jid = rawJid;
    }

    const phone = jidNumber(jid);
    const savedName = cleanName(c.name);
    const pushName = cleanName(c.notify);
    const verified = cleanName(c.verifiedName);
    const existing = stored[jid];

    const chosenName = savedName || existing?.savedName || verified || pushName || existing?.profileName || phone || jid;

    if (
      !existing ||
      (savedName && existing.savedName !== savedName) ||
      (pushName && existing.profileName !== pushName) ||
      existing.displayName !== chosenName
    ) {
      stored[jid] = {
        jid,
        phoneNumber: phone,
        savedName: savedName || existing?.savedName,
        profileName: pushName || existing?.profileName,
        displayName: chosenName,
        updatedAt: new Date().toISOString(),
      };
      changed = true;
    }
  }

  if (changed) {
    saveContacts();
    logger.info({ count: Object.keys(stored).length }, 'Updated primary phone contacts in contact store');
  }
}

export async function triggerFullContactSync(socket: WASocket): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    const collections: string[] = ['critical_unblock_low', 'regular_low', 'regular_high', 'regular', 'critical_block'];

    // Reset versions to 0 in auth state files so Baileys requests full snapshot from WhatsApp servers
    for (const name of collections) {
      const vFile = path.join(config.SESSION_PATH, `app-state-sync-version-${name}.json`);
      if (fs.existsSync(vFile)) {
        try {
          const content = JSON.parse(fs.readFileSync(vFile, 'utf8'));
          content.version = 0;
          fs.writeFileSync(vFile, JSON.stringify(content));
        } catch {}
      }
    }

    logger.info('Requesting full app-state contact snapshot from primary phone...');
    if (typeof (socket as any).resyncAppState === 'function') {
      await (socket as any).resyncAppState(['critical_unblock_low', 'regular_low', 'regular_high', 'regular'], true);
    }

    // Also resync any contacts from all participating groups
    try {
      const groupsMap = await socket.groupFetchAllParticipating();
      const groupContacts: any[] = [];
      for (const meta of Object.values(groupsMap)) {
        for (const p of meta.participants || []) {
          if (p.id && !p.id.endsWith('@g.us')) {
            groupContacts.push({ id: p.id });
          }
        }
      }
      if (groupContacts.length) {
        syncContacts(groupContacts);
      }
    } catch {}

    const count = Object.keys(readContacts()).length;
    logger.info({ count }, 'Full contact synchronization completed');
    return { success: true, count };
  } catch (err: any) {
    logger.warn({ err }, 'Error during triggerFullContactSync');
    return { success: false, count: Object.keys(readContacts()).length, error: err?.message };
  }
}

export function getSenderIdentity(message: WAMessage, socket: WASocket): SenderIdentity {
  const jid = senderJid(message, socket);
  const stored = readContacts()[jid];
  const profileName = cleanName(message.pushName) || (message.key.fromMe ? cleanName(socket.user?.name) || config.OWNER_NAME : stored?.profileName);
  const phoneNumber = jidNumber(jid) || stored?.phoneNumber || jid;
  const displayName = stored?.savedName || stored?.displayName || profileName || phoneNumber || jid;
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
      savedName: stored?.savedName,
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
