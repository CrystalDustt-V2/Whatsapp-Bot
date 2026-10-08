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
  editedAt?: string;
};

const contactsPath = path.join(config.SESSION_PATH, 'contacts.json');
const lidMappingPath = path.join(config.SESSION_PATH, 'lid-mapping.json');
const aiMemoryPath = resolveDataPath(config.AI_MEMORY_FILE, path.join(config.SESSION_PATH, 'ai-memory.jsonl'));
let contacts: Record<string, StoredContact> | null = null;

type LidMappingStore = {
  lidToPn: Record<string, string>;
  pnToLid: Record<string, string>;
};

let lidMappingCache: LidMappingStore | null = null;

function resolveDataPath(value: string | undefined, fallback: string): string {
  const filePath = value?.trim() || fallback;
  return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
}

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function readLidMapping(): LidMappingStore {
  if (lidMappingCache) return lidMappingCache;
  try {
    if (fs.existsSync(lidMappingPath)) {
      lidMappingCache = JSON.parse(fs.readFileSync(lidMappingPath, 'utf8')) as LidMappingStore;
      if (!lidMappingCache.lidToPn) lidMappingCache.lidToPn = {};
      if (!lidMappingCache.pnToLid) lidMappingCache.pnToLid = {};
      return lidMappingCache;
    }
  } catch {}
  lidMappingCache = { lidToPn: {}, pnToLid: {} };
  return lidMappingCache;
}

function saveLidMapping(): void {
  try {
    ensureDir(lidMappingPath);
    fs.writeFileSync(lidMappingPath, JSON.stringify(readLidMapping(), null, 2));
  } catch (err) {
    logger.warn({ err }, 'Could not save LID mapping cache');
  }
}

export function registerLidMapping(lidRaw?: string, pnRaw?: string): void {
  if (!lidRaw || !pnRaw) return;
  const store = readLidMapping();
  const cleanLid = lidRaw.split(':')[0].trim();
  const cleanPn = pnRaw.split(':')[0].trim();

  const lidKey = cleanLid.endsWith('@lid') ? cleanLid : `${cleanLid}@lid`;
  const pnKey = cleanPn.endsWith('@s.whatsapp.net') ? cleanPn : `${cleanPn.replace(/\D/g, '')}@s.whatsapp.net`;

  if (lidKey === pnKey) return;

  let changed = false;
  if (store.lidToPn[lidKey] !== pnKey) {
    store.lidToPn[lidKey] = pnKey;
    changed = true;
  }
  if (store.pnToLid[pnKey] !== lidKey) {
    store.pnToLid[pnKey] = lidKey;
    changed = true;
  }

  if (changed) {
    saveLidMapping();

    // Cross-propagate saved names between LID entry and Phone entry in contacts cache
    const storedContacts = readContacts();
    const lidEntry = storedContacts[lidKey];
    const pnEntry = storedContacts[pnKey];

    if (lidEntry?.savedName && (!pnEntry || !pnEntry.savedName)) {
      storedContacts[pnKey] = {
        jid: pnKey,
        phoneNumber: jidNumber(pnKey),
        savedName: lidEntry.savedName,
        profileName: pnEntry?.profileName || lidEntry.profileName,
        displayName: lidEntry.savedName,
        updatedAt: new Date().toISOString(),
      };
      saveContacts();
    } else if (pnEntry?.savedName && (!lidEntry || !lidEntry.savedName)) {
      storedContacts[lidKey] = {
        jid: lidKey,
        phoneNumber: jidNumber(pnKey),
        savedName: pnEntry.savedName,
        profileName: lidEntry?.profileName || pnEntry.profileName,
        displayName: pnEntry.savedName,
        updatedAt: new Date().toISOString(),
      };
      saveContacts();
    }
  }
}

export function getPhoneFromLid(lid: string): string | undefined {
  if (!lid) return undefined;
  const store = readLidMapping();
  const clean = lid.split(':')[0].trim();
  const key = clean.endsWith('@lid') ? clean : `${clean}@lid`;
  return store.lidToPn[key];
}

export function getLidFromPhone(pn: string): string | undefined {
  if (!pn) return undefined;
  const store = readLidMapping();
  const clean = pn.split(':')[0].trim();
  const key = clean.endsWith('@s.whatsapp.net') ? clean : `${clean.replace(/\D/g, '')}@s.whatsapp.net`;
  return store.pnToLid[key];
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

export function syncContacts(newContacts: Array<{ id?: string; name?: string; notify?: string; verifiedName?: string; lid?: string; jid?: string; fullName?: string; firstName?: string; displayName?: string }>): void {
  if (!Array.isArray(newContacts) || !newContacts.length) return;
  const stored = readContacts();
  let changed = false;

  for (const c of newContacts) {
    if (!c) continue;
    let rawJid = c.jid || c.id || '';
    if (!rawJid || rawJid.endsWith('@g.us') || rawJid.endsWith('@newsletter') || rawJid === 'status@broadcast') continue;

    const lidCandidate = c.lid || (rawJid.endsWith('@lid') ? rawJid : undefined);
    const pnCandidate = (c.jid && c.jid.endsWith('@s.whatsapp.net')) ? c.jid : (rawJid.endsWith('@s.whatsapp.net') ? rawJid : undefined);
    if (lidCandidate && pnCandidate) {
      registerLidMapping(lidCandidate, pnCandidate);
    }

    let primaryJid = '';
    let phoneNumber = '';

    if (rawJid.endsWith('@s.whatsapp.net')) {
      primaryJid = rawJid.split('@')[0].split(':')[0] + '@s.whatsapp.net';
      phoneNumber = jidNumber(primaryJid);
    } else if (rawJid.endsWith('@lid')) {
      const cleanLid = rawJid.split('@')[0].split(':')[0] + '@lid';
      const mappedPn = getPhoneFromLid(cleanLid);
      if (mappedPn) {
        primaryJid = mappedPn;
        phoneNumber = jidNumber(mappedPn);
      } else if (c.jid && c.jid.endsWith('@s.whatsapp.net')) {
        primaryJid = c.jid.split('@')[0].split(':')[0] + '@s.whatsapp.net';
        phoneNumber = jidNumber(primaryJid);
        registerLidMapping(cleanLid, primaryJid);
      } else {
        primaryJid = cleanLid;
        phoneNumber = '';
      }
    } else if (/^\d+$/.test(rawJid)) {
      primaryJid = `${rawJid}@s.whatsapp.net`;
      phoneNumber = rawJid;
    } else {
      primaryJid = rawJid;
    }

    const savedName = cleanName(c.fullName || c.firstName || c.name || c.displayName || (c as any).shortName);
    const pushName = cleanName(c.notify || (c as any).profileName);
    const verified = cleanName(c.verifiedName);

    let existing = stored[primaryJid];
    if (!existing && primaryJid.endsWith('@s.whatsapp.net')) {
      const mappedLid = getLidFromPhone(primaryJid);
      if (mappedLid && stored[mappedLid]) existing = stored[mappedLid];
    } else if (!existing && primaryJid.endsWith('@lid')) {
      const mappedPn = getPhoneFromLid(primaryJid);
      if (mappedPn && stored[mappedPn]) existing = stored[mappedPn];
    }

    const currentSavedName = savedName || existing?.savedName;
    const currentProfileName = pushName || existing?.profileName;
    const chosenName = currentSavedName || verified || currentProfileName || phoneNumber || primaryJid;

    const contactObj: StoredContact = {
      jid: primaryJid,
      phoneNumber: phoneNumber || existing?.phoneNumber || (primaryJid.endsWith('@s.whatsapp.net') ? jidNumber(primaryJid) : ''),
      savedName: currentSavedName,
      profileName: currentProfileName,
      displayName: chosenName,
      updatedAt: new Date().toISOString(),
    };

    if (
      !existing ||
      (currentSavedName && existing.savedName !== currentSavedName) ||
      (currentProfileName && existing.profileName !== currentProfileName) ||
      existing.displayName !== chosenName ||
      (!existing.phoneNumber && phoneNumber)
    ) {
      stored[primaryJid] = contactObj;

      if (primaryJid.endsWith('@s.whatsapp.net')) {
        const mappedLid = lidCandidate || getLidFromPhone(primaryJid);
        if (mappedLid) {
          stored[mappedLid] = { ...contactObj, jid: mappedLid };
        }
      } else if (primaryJid.endsWith('@lid')) {
        const mappedPn = getPhoneFromLid(primaryJid);
        if (mappedPn) {
          stored[mappedPn] = { ...contactObj, jid: mappedPn, phoneNumber: jidNumber(mappedPn) };
        }
      }
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

    // 1. Unlink version files from session folder to discard old hashes
    for (const name of collections) {
      const vFile = path.join(config.SESSION_PATH, `app-state-sync-version-${name}.json`);
      if (fs.existsSync(vFile)) {
        try {
          fs.unlinkSync(vFile);
        } catch {}
      }
    }

    // 2. Unset in Baileys auth keys so it initializes clean newLTHashState and sends return_snapshot = true
    try {
      if ((socket as any).authState?.keys?.set) {
        const nullEntries: Record<string, null> = {};
        for (const name of collections) {
          nullEntries[name] = null;
        }
        await (socket as any).authState.keys.set({ 'app-state-sync-version': nullEntries });
      }
    } catch (authKeyErr) {
      logger.debug({ authKeyErr }, 'Could not reset authState app-state-sync-version keys');
    }

    logger.info('Requesting full app-state contact snapshot from primary phone...');
    if (typeof (socket as any).resyncAppState === 'function') {
      await (socket as any).resyncAppState(['critical_unblock_low', 'regular_low', 'regular_high', 'regular'], true);
    }

    // 3. Harvest contacts from all participating groups and discover LIDs
    const phoneNumbersToQuery: string[] = [];
    try {
      const groupsMap = await socket.groupFetchAllParticipating();
      const groupContacts: any[] = [];
      for (const meta of Object.values(groupsMap)) {
        for (const p of meta.participants || []) {
          if (p.id && !p.id.endsWith('@g.us')) {
            groupContacts.push({ id: p.id });
            if (p.id.endsWith('@s.whatsapp.net')) {
              phoneNumbersToQuery.push(p.id);
            }
          }
        }
      }
      if (groupContacts.length) {
        syncContacts(groupContacts);
      }
    } catch {}

    // 4. Proactively query onWhatsApp to map phone numbers to LIDs
    if (typeof socket.onWhatsApp === 'function' && phoneNumbersToQuery.length) {
      const unique = Array.from(new Set(phoneNumbersToQuery)).slice(0, 50);
      try {
        const onWaResults = await socket.onWhatsApp(...unique);
        for (const res of onWaResults || []) {
          if (res.exists && res.jid && (res as any).lid) {
            registerLidMapping((res as any).lid, res.jid);
          }
        }
      } catch {}
    }

    // 5. Harvest historical numbers from processed messages if any
    const procPath = path.join(config.SESSION_PATH, 'processed-messages.json');
    if (fs.existsSync(procPath)) {
      try {
        const procData = JSON.parse(fs.readFileSync(procPath, 'utf8'));
        const harvested: Array<{ id: string }> = [];
        const procKeys = Array.isArray(procData) ? procData : Object.values(procData);
        for (const val of procKeys) {
          if (typeof val === 'string' && val.includes('@s.whatsapp.net')) {
            const raw = val.split(':')[0];
            if (raw.endsWith('@s.whatsapp.net')) {
              harvested.push({ id: raw });
            }
          }
        }
        if (harvested.length) {
          syncContacts(harvested);
        }
      } catch {}
    }

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
  const storedContacts = readContacts();

  // Proactively register LID mapping if remote and participant have different formats
  if (message.key.remoteJid && message.key.participant) {
    if (message.key.remoteJid.endsWith('@s.whatsapp.net') && message.key.participant.endsWith('@lid')) {
      registerLidMapping(message.key.participant, message.key.remoteJid);
    } else if (message.key.remoteJid.endsWith('@lid') && message.key.participant.endsWith('@s.whatsapp.net')) {
      registerLidMapping(message.key.remoteJid, message.key.participant);
    }
  }

  let stored = storedContacts[jid];
  if (!stored && jid.endsWith('@s.whatsapp.net')) {
    const mappedLid = getLidFromPhone(jid);
    if (mappedLid && storedContacts[mappedLid]) stored = storedContacts[mappedLid];
  } else if (!stored && jid.endsWith('@lid')) {
    const mappedPn = getPhoneFromLid(jid);
    if (mappedPn && storedContacts[mappedPn]) stored = storedContacts[mappedPn];
  }

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
    storedContacts[jid] = {
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
  const content = message.message?.ephemeralMessage?.message || message.message;
  // Edit events update the original entry rather than adding protocol placeholders.
  if (content?.editedMessage || content?.protocolMessage?.type === 14) return;

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

export function editAiMemoryMessage(chatJids: string[], messageId: string, text: string, messageType: string, editedAt: string): void {
  if (!fs.existsSync(aiMemoryPath)) return;
  let changed = false;
  const lines = fs.readFileSync(aiMemoryPath, 'utf8').split(/\r?\n/);
  const updated = lines.map((line) => {
    const entry = safeJsonParse(line);
    if (!entry || !chatJids.includes(entry.chatJid) || entry.messageId !== messageId || (entry.editedAt && entry.editedAt >= editedAt)) return line;
    changed = true;
    return JSON.stringify({ ...entry, text: text.slice(0, maxTextChars()), messageType, editedAt });
  });
  if (!changed) return;
  fs.writeFileSync(`${aiMemoryPath}.tmp`, updated.join('\n'), 'utf8');
  fs.renameSync(`${aiMemoryPath}.tmp`, aiMemoryPath);
}

export function findAiMemoryMessage(chatJids: string[], messageId: string): AiMemoryEntry | undefined {
  return readMemoryEntries().find((entry) => chatJids.includes(entry.chatJid) && entry.messageId === messageId);
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
