import type { BaileysEventMap, GroupMetadata, MessageUserReceiptUpdate, WAMessage, WAMessageUpdate, WASocket } from '@whiskeysockets/baileys';
import cors from 'cors';
import crypto from 'crypto';
import express from 'express';
import http from 'http';
import path from 'path';
import * as fs from 'fs';
import qrcode from 'qrcode';
import sharp from 'sharp';
import { Server as SocketIOServer } from 'socket.io';
import { commandRegistry } from './command-registry';
import logger from './logger';
import config from '../config';
import type { BotContext, SenderIdentity } from '../types';
import {
  getAllViewOnceMessages,
  listAllDeletedMessages,
  readDeletedMessageMedia,
  findStoredMessageById,
  listDeletedChats,
  loadState,
  unwrapMessageInfo,
  type DeletedMessageRecord,
} from '../services/deleted-message-recovery';
import {
  getSenderIdentity,
  triggerFullContactSync,
  readContacts,
  getPhoneFromLid,
  getLidFromPhone,
  registerLidMapping,
  editAiMemoryMessage,
  findAiMemoryMessage,
} from '../services/message-memory';
import { sendRecoveredMedia, formatRecord } from '../commands/utility/deleted';
import { messageInfo, mergeMessageInfo, receiptInfo, whatsappTimestamp, type DashboardMessageInfo } from '../services/dashboard-message-info';
import { DashboardState } from '../services/dashboard-state';
import { OutboundQueue, UnrecoverableError, type OutboundMessage } from './outbound-queue';

interface ApiServerOptions {
  port?: number;
}

export interface DashboardChatMessage extends DashboardMessageInfo {
  id: string;
  chatJid: string;
  senderJid: string;
  senderName: string;
  senderNumber: string;
  fromMe: boolean;
  timestamp: string;
  text: string;
  type: string;
  media?: {
    kind: string;
    mimetype: string;
    fileName?: string;
    size?: number;
    url?: string;
  };
  location?: {
    degreesLatitude: number;
    degreesLongitude: number;
    name?: string;
    address?: string;
  };
  contact?: {
    displayName: string;
    vcard: string;
  };
  reactions?: Record<string, number>;
  isViewOnce?: boolean;
  isDeleted?: boolean;
  isEdited?: boolean;
  editedAt?: string;
  starred?: boolean;
  quoted?: {
    id: string;
    senderJid?: string;
    senderName?: string;
    text?: string;
    mediaKind?: string;
  };
  poll?: {
    name: string;
    options: string[];
    selectableCount: number;
  };
}

export interface ScheduledMessage {
  id: string;
  chatJid: string;
  text: string;
  sendAt: string;
  mentionAll?: boolean;
  quotedMessageId?: string;
  createdAt: string;
}

let botSocket: WASocket | null = null;

export class ApiServer {
  private app: express.Application;
  private server: http.Server;
  private io: SocketIOServer;
  private port: number;
  private authQR: string | null = null;
  private pairingCode: string | null = null;

  // Live in-memory chat message buffer: chatJid -> DashboardChatMessage[] (latest 100)
  private liveMessageStore = new Map<string, DashboardChatMessage[]>();

  // Retain early ACKs and metadata for history-only messages without creating bubbles.
  private messageInfoStore = new Map<string, DashboardMessageInfo>();

  private reactionStore = new Map<string, Map<string, { emoji: string; timestamp: number }>>();

  // Queue on mute: groupJid -> queued messages waiting for announce: false
  private dashboardState = new DashboardState(config.SESSION_PATH);
  private outboundQueue = new OutboundQueue((message) => this.deliverQueuedMessage(message));

  // Raw WAMessage cache for authentic quoted replies
  private rawMessageMap = new Map<string, WAMessage>();

  // Scheduled messages queue
  private scheduledMessages: ScheduledMessage[] = [];
  private scheduledTimer: NodeJS.Timeout | null = null;

  // Group metadata cache for resilience against WhatsApp IQ rate-limits and timeouts
  private groupMetadataCache = new Map<string, { data: any; cachedAt: number }>();

  // Chat latest activity tracking: chatJid -> { timestamp: string, lastText?: string }
  private chatLastActiveMap = new Map<string, { timestamp: string; lastText?: string }>();

  private connectionManager: any = null;

  constructor(options: ApiServerOptions = {}) {
    this.port = options.port || 3001;
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = new SocketIOServer(this.server, {
      cors: {
        origin: '*',
      },
      maxHttpBufferSize: 1e8, // 100MB for media uploads
    });

    this.setupMiddleware();
    this.setupRoutes();
    this.setupSocketIO();
    this.initializeLastActiveMap();
    this.scheduledTimer = setInterval(() => this.processScheduledMessages(), 5000);
  }

  private initializeLastActiveMap(): void {
    const aiMemoryPath = path.join(config.SESSION_PATH, 'ai-memory.jsonl');
    if (fs.existsSync(aiMemoryPath)) {
      try {
        const lines = fs.readFileSync(aiMemoryPath, 'utf8').split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            if (entry.chatJid && entry.ts) {
              const existing = this.chatLastActiveMap.get(entry.chatJid);
              if (!existing || new Date(entry.ts).getTime() > new Date(existing.timestamp).getTime()) {
                this.chatLastActiveMap.set(entry.chatJid, {
                  timestamp: entry.ts,
                  lastText: entry.text || '',
                });
              }
            }
          } catch {}
        }
      } catch {}
    }

    try {
      const state = loadState();
      const all = [...(state.messages || []), ...(state.deleted || []), ...(state.viewOnce || [])];
      for (const m of all) {
        if (m.chatJid && m.timestamp) {
          const existing = this.chatLastActiveMap.get(m.chatJid);
          if (!existing || new Date(m.timestamp).getTime() > new Date(existing.timestamp).getTime()) {
            this.chatLastActiveMap.set(m.chatJid, {
              timestamp: m.timestamp,
              lastText: m.text || '',
            });
          }
        }
      }
    } catch {}

    logger.info({ trackedChats: this.chatLastActiveMap.size }, 'Preloaded last active timestamps for chats');
  }

  // ---------------------------------------------------------------------------
  // LIVE MESSAGE INGESTION FROM BAILEYS
  // ---------------------------------------------------------------------------
  handleIncomingMessage(msg: WAMessage): void {
    const chatJid = msg.key.remoteJid;
    if (!chatJid || !botSocket) return;
    if (msg.message?.editedMessage?.message) {
      this.applyMessageEdit(msg.key, msg.message.editedMessage.message, whatsappTimestamp(msg.messageTimestamp) || new Date().toISOString());
      return;
    }

    if (msg.key.id) {
      this.rawMessageMap.set(msg.key.id, msg);
      if (this.rawMessageMap.size > 500) {
        const first = this.rawMessageMap.keys().next().value;
        if (first) this.rawMessageMap.delete(first);
      }
    }

    try {
      const parsed = this.parseWAMessage(msg, botSocket);
      if (!parsed) return;

      this.addMessageToStore(parsed);
      this.io.to('auth').emit('chat:message', parsed);
    } catch (err) {
      logger.debug({ err, id: msg.key.id }, 'Error parsing incoming message for dashboard');
    }
  }

  handleContactsSync(contacts: any[]): void {
    this.io.to('auth').emit('contacts:updated', { count: Array.isArray(contacts) ? contacts.length : 0 });
  }

  private messageInfoKeys(chatJid: string, id: string): string[] {
    const jid = chatJid.replace(/:\d+(?=@)/, '');
    const alias = jid.endsWith('@lid') ? getPhoneFromLid(jid) : jid.endsWith('@s.whatsapp.net') ? getLidFromPhone(jid) : undefined;
    return [...new Set([jid, alias].filter((value): value is string => Boolean(value)))].map((value) => `${value}\0${id}`);
  }

  private getMessageInfo(chatJid: string, id: string): DashboardMessageInfo {
    return this.messageInfoKeys(chatJid, id).reduce(
      (info, key) => {
        const live = this.liveMessageStore.get(key.split('\0')[0])?.find((message) => message.id === id);
        const stored = mergeMessageInfo(live || {}, this.messageInfoStore.get(key) || {});
        return mergeMessageInfo(info, this.normalizeReceiptJids(stored));
      },
      {} as DashboardMessageInfo
    );
  }

  private normalizeReceiptJids(info: DashboardMessageInfo): DashboardMessageInfo {
    if (!info.receipts) return info;
    return { ...info, receipts: info.receipts.map((receipt) => ({
      ...receipt,
      userJid: receipt.userJid.endsWith('@lid') ? getPhoneFromLid(receipt.userJid) || receipt.userJid : receipt.userJid,
    })) };
  }

  private storeMessageInfo(chatJid: string, id: string, info: DashboardMessageInfo): void {
    const keys = this.messageInfoKeys(chatJid, id);
    for (const key of keys) this.messageInfoStore.delete(key);
    this.messageInfoStore.set(keys[0], info);
    if (this.messageInfoStore.size > 1000) {
      this.messageInfoStore.delete(this.messageInfoStore.keys().next().value!);
    }
  }

  private updateMessageInfo(key: WAMessageUpdate['key'], incoming: DashboardMessageInfo): void {
    if (!key.remoteJid || !key.id || !Object.keys(incoming).length) return;
    const info = mergeMessageInfo(this.getMessageInfo(key.remoteJid, key.id), this.normalizeReceiptJids(incoming),
      Boolean(key.fromMe && /@(s\.whatsapp\.net|lid)$/.test(key.remoteJid)));
    this.storeMessageInfo(key.remoteJid, key.id, info);
    const chatJids = this.messageInfoKeys(key.remoteJid, key.id).map((value) => value.split('\0')[0]);
    for (const chatJid of chatJids) {
      const target = this.liveMessageStore.get(chatJid)?.find((m) => m.id === key.id);
      if (target) Object.assign(target, info);
      this.io.to('auth').emit('chat:message-info', { chatJid, messageId: key.id, ...info });
    }
  }

  handleMessageUpdates(updates: WAMessageUpdate[]): void {
    for (const { key, update } of updates) {
      const edited = update.message?.editedMessage?.message;
      if (edited) this.applyMessageEdit(key, edited, whatsappTimestamp(update.messageTimestamp) || new Date().toISOString());
      this.updateMessageInfo(key, messageInfo(edited ? { ...update, messageTimestamp: undefined } : update));
      if (typeof update.starred === 'boolean') {
        const snapshot = update.starred && update.message && botSocket ? this.parseWAMessage({ ...update, key }, botSocket) || undefined : undefined;
        this.applyStar(key, update.starred, snapshot);
      }
    }
  }

  private applyMessageEdit(key: WAMessageUpdate['key'], message: NonNullable<WAMessage['message']>, editedAt: string): void {
    if (!key.remoteJid || !key.id) return;
    const inner = unwrapMessageInfo(message).message;
    if (!inner) return;
    const text = inner.conversation ?? inner.extendedTextMessage?.text ?? inner.imageMessage?.caption ?? inner.videoMessage?.caption ?? inner.documentMessage?.caption;
    if (text == null) return;
    const type = Object.keys(inner).find((name) => name !== 'messageContextInfo') || 'conversation';
    const jids = this.messageInfoKeys(key.remoteJid, key.id).map((value) => value.split('\0')[0]);
    for (const chatJid of jids) {
      const previous = this.dashboardState.getEdit(chatJid, key.id);
      if (previous && previous.editedAt > editedAt) continue;
      editAiMemoryMessage(jids, key.id, text, type, editedAt);
      if (!this.dashboardState.edit({ chatJid, messageId: key.id, text, type, editedAt })) continue;
      const target = this.liveMessageStore.get(chatJid)?.find((entry) => entry.id === key.id);
      if (target) Object.assign(target, { text, type, isEdited: true, editedAt });
      const raw = this.rawMessageMap.get(key.id);
      if (raw && jids.includes(raw.key.remoteJid || '')) raw.message = message;
      const latest = this.chatLastActiveMap.get(chatJid);
      if (target && latest?.timestamp === target.timestamp) latest.lastText = text;
      this.io.to('auth').emit('chat:message-edited', { chatJid, messageId: key.id, text, type, isEdited: true, editedAt });
    }
  }

  private applyStar(key: WAMessageUpdate['key'], starred: boolean, snapshot?: DashboardChatMessage): void {
    if (!key.remoteJid || !key.id) return;
    const jids = this.messageInfoKeys(key.remoteJid, key.id).map((value) => value.split('\0')[0]);
    const chatJid = jids.find((jid) => jid.endsWith('@s.whatsapp.net')) || key.remoteJid;
    const message = starred ? snapshot || this.findDashboardMessage(chatJid, key.id) : undefined;
    this.dashboardState.star({ chatJid, messageId: key.id, fromMe: Boolean(key.fromMe), starredAt: new Date().toISOString(),
      ...(message ? { message: { ...message, starred } } : {}) }, starred);
    for (const chatJid of jids) {
      const target = this.liveMessageStore.get(chatJid)?.find((message) => message.id === key.id);
      if (target) target.starred = starred;
      this.io.to('auth').emit('chat:message-starred', { chatJid, messageId: key.id, starred });
    }
  }

  handleChatsUpdate(updates: Array<{ id?: string | null; ephemeralExpiration?: number | null }>): void {
    for (const update of updates) {
      if (!update.id || update.ephemeralExpiration === undefined) continue;
      const duration = update.ephemeralExpiration || 0;
      this.dashboardState.setTimer(update.id, duration);
      this.io.to('auth').emit('chat:ephemeral', { chatJid: update.id, duration });
    }
  }

  private applyDashboardState(message: DashboardChatMessage): DashboardChatMessage {
    const edit = this.messageInfoKeys(message.chatJid, message.id).map((key) => {
      const jid = key.split('\0')[0];
      return this.dashboardState.getEdit(jid, message.id);
    }).filter((value) => Boolean(value)).sort((a, b) => b!.editedAt.localeCompare(a!.editedAt))[0];
    if (edit) Object.assign(message, { text: edit.text, type: edit.type, isEdited: true, editedAt: edit.editedAt });
    message.starred = this.messageInfoKeys(message.chatJid, message.id).some((key) => this.dashboardState.isStarred(key.split('\0')[0], message.id));
    return message;
  }

  private findDashboardMessage(chatJid: string, id: string): DashboardChatMessage | undefined {
    const jids = this.messageInfoKeys(chatJid, id).map((value) => value.split('\0')[0]);
    for (const jid of jids) {
      const live = this.liveMessageStore.get(jid)?.find((message) => message.id === id);
      if (live) return this.applyDashboardState({ ...live });
    }
    const entry = findAiMemoryMessage(jids, id);
    if (entry) return this.applyDashboardState({ ...entry, id, timestamp: entry.ts, type: entry.messageType });
    for (const jid of jids) {
      const recovered = findStoredMessageById(jid, id);
      if (recovered) return this.applyDashboardState({ ...recovered, id, type: recovered.messageType });
    }
    return undefined;
  }

  private accountJid(): string {
    let jid = botSocket?.user?.id || '';
    if (!jid) {
      try { jid = JSON.parse(fs.readFileSync(path.join(config.SESSION_PATH, 'creds.json'), 'utf8')).me?.id || ''; } catch {}
    }
    return jid.replace(/:\d+(?=@)/, '');
  }

  private async enqueueChat(jid: string, text: string, mentionAll: boolean, quotedMessageId?: string, requestId?: string): Promise<string> {
    const raw = quotedMessageId ? this.rawMessageMap.get(quotedMessageId) : undefined;
    if (quotedMessageId && (!raw || !this.messageInfoKeys(jid, quotedMessageId).some((key) => key.split('\0')[0] === raw.key.remoteJid))) {
      throw new Error('Quoted message is unavailable for queueing.');
    }
    const quoted = raw ? { key: raw.key, messageTimestamp: Number(raw.messageTimestamp) || 0,
      message: { conversation: this.findDashboardMessage(jid, quotedMessageId!)?.text || '[Quoted message]' } } : undefined;
    return this.outboundQueue.enqueue({ chatJid: jid, accountJid: this.accountJid(), text: text.trim(), mentionAll, quoted }, requestId);
  }

  private async deliverQueuedMessage(message: OutboundMessage): Promise<boolean> {
    const socket = botSocket;
    if (!socket) return false;
    if (socket.user?.id?.replace(/:\d+(?=@)/, '') !== message.accountJid) {
      throw new UnrecoverableError('Queued message belongs to another WhatsApp account.');
    }
    let mentions: string[] | undefined;
    let duration = this.dashboardState.timer(message.chatJid);
    if (message.chatJid.endsWith('@g.us')) {
      const metadata = await socket.groupMetadata(message.chatJid);
      const me = metadata.participants.find((participant) => [socket.user?.id, socket.user?.lid].some((jid) => jid && this.reactionSenderJid(jid) === this.reactionSenderJid(participant.id)));
      if (!me) throw new UnrecoverableError('Bot is no longer a member of this group.');
      if (metadata.announce && !me.admin) return false;
      if (message.mentionAll || /(?:^|\s)@(everyone|all)\b/i.test(message.text)) mentions = metadata.participants.map((participant) => participant.id);
      duration = metadata.ephemeralDuration;
    }
    const sent = await socket.sendMessage(message.chatJid, { text: message.text, mentions }, {
      messageId: message.messageId, quoted: message.quoted, ephemeralExpiration: duration,
    });
    if (!sent?.key.id) throw new Error('WhatsApp did not return a queued message ID.');
    if (botSocket === socket) this.handleIncomingMessage(sent);
    this.io.to('auth').emit('bot:activity', { type: 'queue:sent', groupJid: message.chatJid, messageId: sent.key.id, timestamp: new Date().toISOString() });
    return true;
  }

  private chatSendOptions(chatJid: string, quoted?: WAMessage) {
    return { quoted, ephemeralExpiration: this.dashboardState.timer(chatJid) };
  }

  handleMessageReceipts(updates: MessageUserReceiptUpdate[]): void {
    for (const { key, receipt } of updates) {
      const parsed = receiptInfo(receipt);
      if (!parsed) continue;
      this.updateMessageInfo(key, { receipts: [parsed] });
    }
  }

  private reactionSenderJid(jid: string): string {
    const normalized = jid.replace(/:\d+(?=@)/, '');
    return normalized.endsWith('@lid') ? getPhoneFromLid(normalized) || normalized : normalized;
  }

  private getReactionState(chatJid: string, messageId: string): Map<string, { emoji: string; timestamp: number }> {
    const state = new Map<string, { emoji: string; timestamp: number }>();
    for (const key of this.messageInfoKeys(chatJid, messageId)) {
      for (const [sender, reaction] of this.reactionStore.get(key) || []) {
        const jid = this.reactionSenderJid(sender);
        if (!state.has(jid) || state.get(jid)!.timestamp <= reaction.timestamp) state.set(jid, reaction);
      }
    }
    return state;
  }

  private reactionCounts(state: Map<string, { emoji: string; timestamp: number }>): Record<string, number> {
    const counts: Record<string, number> = Object.create(null);
    for (const { emoji } of state.values()) {
      if (emoji) counts[emoji] = (counts[emoji] || 0) + 1;
    }
    return counts;
  }

  private applyReaction(chatJid: string, messageId: string, senderJid: string, emoji: string, timestamp: number): void {
    if (!chatJid || !messageId || !senderJid) return;
    const sender = this.reactionSenderJid(senderJid);
    const keys = this.messageInfoKeys(chatJid, messageId);
    const state = this.getReactionState(chatJid, messageId);
    const previous = state.get(sender);
    // Keep removal tombstones so a delayed add cannot resurrect an old reaction.
    if (timestamp && previous && timestamp < previous.timestamp) return;
    state.set(sender, { emoji, timestamp: timestamp || previous?.timestamp || 0 });
    for (const key of keys) this.reactionStore.delete(key);
    this.reactionStore.set(keys[0], state);
    if (this.reactionStore.size > 1000) this.reactionStore.delete(this.reactionStore.keys().next().value!);
    const reactions = this.reactionCounts(state);
    for (const key of keys) {
      const jid = key.split('\0')[0];
      const target = this.liveMessageStore.get(jid)?.find((message) => message.id === messageId);
      if (target) target.reactions = reactions;
      if (previous?.emoji !== emoji) {
        this.io.to('auth').emit('chat:reaction', { chatJid: jid, messageId, senderJid: sender, emoji, reactions });
      }
    }
  }

  handleMessageReactions(updates: BaileysEventMap['messages.reaction']): void {
    for (const { key, reaction } of updates) {
      const actor = reaction.key;
      const sender = actor?.fromMe ? botSocket?.user?.id : actor?.participant || actor?.remoteJid;
      if (key.remoteJid && key.id && sender) {
        this.applyReaction(key.remoteJid, key.id, sender, reaction.text || '', Number(reaction.senderTimestampMs) || 0);
      }
    }
  }

  handleGroupsUpdate(updates: Partial<GroupMetadata>[]): void {
    for (const update of updates) {
      if (update.id) {
        this.groupMetadataCache.delete(update.id);
        if (update.ephemeralDuration != null) this.handleChatsUpdate([{ id: update.id, ephemeralExpiration: update.ephemeralDuration }]);
      }
      if (update.id && update.announce === false) {
        // Group was unmuted / opened to all members! Drain queue if any
        // BullMQ retries delayed messages against fresh group permissions.
        this.io.to('auth').emit('bot:activity', { type: 'queue:unlocked', groupJid: update.id, timestamp: new Date().toISOString() });
      }
    }
  }

  private addMessageToStore(chatMsg: DashboardChatMessage, source?: WAMessage): void {
    const raw = source || this.rawMessageMap.get(chatMsg.id);
    const rawInfo = raw?.key.remoteJid === chatMsg.chatJid ? this.normalizeReceiptJids(messageInfo(raw)) : {};
    let info = mergeMessageInfo(rawInfo, this.getMessageInfo(chatMsg.chatJid, chatMsg.id));
    const senderJid = chatMsg.senderJid.replace(/:\d+(?=@)/, '');
    info.senderLid = info.senderLid || (senderJid.endsWith('@lid') ? senderJid : getLidFromPhone(senderJid));
    if (!info.senderLid) delete info.senderLid;
    info = mergeMessageInfo(info, {}, chatMsg.fromMe && /@(s\.whatsapp\.net|lid)$/.test(chatMsg.chatJid));
    Object.assign(chatMsg, info);
    this.storeMessageInfo(chatMsg.chatJid, chatMsg.id, info);
    if (raw?.reactions?.length) {
      this.handleMessageReactions(raw.reactions.map((reaction) => ({ key: raw.key, reaction })));
    }
    const reactionState = this.getReactionState(chatMsg.chatJid, chatMsg.id);
    if (reactionState.size) chatMsg.reactions = this.reactionCounts(reactionState);
    this.applyDashboardState(chatMsg);
    const list = this.liveMessageStore.get(chatMsg.chatJid) || [];
    const existingIndex = list.findIndex((m) => m.id === chatMsg.id);
    if (existingIndex >= 0) {
      list[existingIndex] = { ...list[existingIndex], ...chatMsg };
    } else {
      list.push(chatMsg);
      if (list.length > 100) list.shift();
    }
    this.liveMessageStore.set(chatMsg.chatJid, list);
    if (typeof raw?.starred === 'boolean') this.applyStar(raw.key, raw.starred);

    this.chatLastActiveMap.set(chatMsg.chatJid, {
      timestamp: chatMsg.timestamp,
      lastText:
        chatMsg.text ||
        (chatMsg.media ? `[${chatMsg.media.kind}]` : '') ||
        (chatMsg.poll ? `[Poll: ${chatMsg.poll.name}]` : '') ||
        (chatMsg.location ? '[Location]' : '') ||
        (chatMsg.contact ? `[Contact: ${chatMsg.contact.displayName}]` : ''),
    });
  }

  private parseWAMessage(msg: WAMessage, socket: WASocket): DashboardChatMessage | null {
    const chatJid = msg.key.remoteJid;
    if (!chatJid) return null;

    const sender = getSenderIdentity(msg, socket);
    const unwrapped = unwrapMessageInfo(msg.message);
    const innerMsg = unwrapped.message;

    // 1. Intercept incoming reaction: update target message reactions directly (NEVER add as message bubble!)
    if (innerMsg?.reactionMessage) {
      const react = innerMsg.reactionMessage;
      if (react.key?.id) {
        this.applyReaction(react.key.remoteJid || chatJid, react.key.id,
          msg.key.fromMe ? socket.user?.id || sender.jid : sender.jid,
          react.text || '', Number(react.senderTimestampMs) || 0);
      }
      return null;
    }

    // 2. Intercept incoming protocolMessage: revocations or internal stanzas (NEVER add as message bubble!)
    if (innerMsg?.protocolMessage) {
      const proto = innerMsg.protocolMessage;
      // WhatsApp ProtocolMessage.Type.MESSAGE_EDIT = 14.
      if (proto.type === 14 && proto.key?.id && proto.editedMessage) {
        this.applyMessageEdit({ ...proto.key, remoteJid: proto.key.remoteJid || chatJid }, proto.editedMessage,
          proto.timestampMs ? new Date(Number(proto.timestampMs)).toISOString() : new Date().toISOString());
      }
      if (proto.type === 0 && proto.key?.id) {
        const targetId = proto.key.id;
        const targetChatJid = proto.key.remoteJid || chatJid;
        const targetList = this.liveMessageStore.get(targetChatJid);
        const targetMsg = targetList?.find((m) => m.id === targetId);
        if (targetMsg) {
          targetMsg.isDeleted = true;
        }
        this.io.to('auth').emit('chat:message-deleted', {
          chatJid: targetChatJid,
          messageId: targetId,
        });
      }
      return null;
    }

    // 3. Drop non-messaging action stanzas: senderKeyDistributionMessage, peerDataOperation, keepAlive, etc.
    const anyInner = innerMsg as any;
    if (
      innerMsg?.senderKeyDistributionMessage ||
      anyInner?.peerDataOperationRequestMessage ||
      anyInner?.keepAlive ||
      anyInner?.deviceSentMessage
    ) {
      const realKeys = innerMsg
        ? Object.keys(innerMsg).filter(
            (k) =>
              ![
                'senderKeyDistributionMessage',
                'messageContextInfo',
                'peerDataOperationRequestMessage',
                'keepAlive',
                'deviceSentMessage',
              ].includes(k)
          )
        : [];
      if (!realKeys.length) return null;
    }

    const text =
      msg.message?.conversation ||
      innerMsg?.conversation ||
      innerMsg?.extendedTextMessage?.text ||
      innerMsg?.imageMessage?.caption ||
      innerMsg?.videoMessage?.caption ||
      innerMsg?.documentMessage?.caption ||
      '';

    const type = innerMsg ? Object.keys(innerMsg)[0] || 'conversation' : 'unknown';

    let media: DashboardChatMessage['media'] = undefined;
    if (innerMsg?.imageMessage) {
      media = {
        kind: 'image',
        mimetype: innerMsg.imageMessage.mimetype || 'image/jpeg',
        size: Number(innerMsg.imageMessage.fileLength) || 0,
      };
    } else if (innerMsg?.videoMessage) {
      media = {
        kind: 'video',
        mimetype: innerMsg.videoMessage.mimetype || 'video/mp4',
        size: Number(innerMsg.videoMessage.fileLength) || 0,
      };
    } else if (innerMsg?.audioMessage) {
      media = {
        kind: 'audio',
        mimetype: innerMsg.audioMessage.mimetype || 'audio/ogg',
        size: Number(innerMsg.audioMessage.fileLength) || 0,
      };
    } else if (innerMsg?.documentMessage) {
      media = {
        kind: 'document',
        mimetype: innerMsg.documentMessage.mimetype || 'application/octet-stream',
        fileName: innerMsg.documentMessage.fileName || 'file',
        size: Number(innerMsg.documentMessage.fileLength) || 0,
      };
    } else if (innerMsg?.stickerMessage) {
      media = {
        kind: 'sticker',
        mimetype: innerMsg.stickerMessage.mimetype || 'image/webp',
        size: Number(innerMsg.stickerMessage.fileLength) || 0,
      };
    }

    let location: DashboardChatMessage['location'] = undefined;
    if (innerMsg?.locationMessage) {
      location = {
        degreesLatitude: innerMsg.locationMessage.degreesLatitude || 0,
        degreesLongitude: innerMsg.locationMessage.degreesLongitude || 0,
        name: innerMsg.locationMessage.name || undefined,
        address: innerMsg.locationMessage.address || undefined,
      };
    }

    let contact: DashboardChatMessage['contact'] = undefined;
    if (innerMsg?.contactMessage) {
      contact = {
        displayName: innerMsg.contactMessage.displayName || 'Contact',
        vcard: innerMsg.contactMessage.vcard || '',
      };
    }

    // Extract Poll
    let poll: DashboardChatMessage['poll'] = undefined;
    const pollMsg = innerMsg?.pollCreationMessage || innerMsg?.pollCreationMessageV2 || innerMsg?.pollCreationMessageV3;
    if (pollMsg) {
      poll = {
        name: pollMsg.name || 'Poll',
        options: (pollMsg.options || []).map((o) => o.optionName || '').filter(Boolean),
        selectableCount: pollMsg.selectableOptionsCount || 1,
      };
    }

    // Extract Quoted Message Context
    let quoted: DashboardChatMessage['quoted'] = undefined;
    const contextInfo =
      innerMsg?.extendedTextMessage?.contextInfo ||
      innerMsg?.imageMessage?.contextInfo ||
      innerMsg?.videoMessage?.contextInfo ||
      innerMsg?.audioMessage?.contextInfo ||
      innerMsg?.documentMessage?.contextInfo ||
      innerMsg?.stickerMessage?.contextInfo;

    if (contextInfo?.quotedMessage) {
      const qUnwrapped = unwrapMessageInfo(contextInfo.quotedMessage).message;
      const qText =
        contextInfo.quotedMessage.conversation ||
        qUnwrapped?.conversation ||
        qUnwrapped?.extendedTextMessage?.text ||
        qUnwrapped?.imageMessage?.caption ||
        qUnwrapped?.videoMessage?.caption ||
        qUnwrapped?.documentMessage?.caption ||
        '';

      let qMediaKind: string | undefined = undefined;
      if (qUnwrapped?.imageMessage) qMediaKind = 'image';
      else if (qUnwrapped?.videoMessage) qMediaKind = 'video';
      else if (qUnwrapped?.audioMessage) qMediaKind = 'audio';
      else if (qUnwrapped?.documentMessage) qMediaKind = 'document';
      else if (qUnwrapped?.stickerMessage) qMediaKind = 'sticker';

      quoted = {
        id: contextInfo.stanzaId || '',
        senderJid: contextInfo.participant || '',
        text: qText || (qMediaKind ? `[${qMediaKind.toUpperCase()}]` : ''),
        mediaKind: qMediaKind,
      };
    }

    const tsNum =
      typeof msg.messageTimestamp === 'number'
        ? msg.messageTimestamp
        : (msg.messageTimestamp as any)?.low || 0;
    const timestamp = tsNum ? new Date(tsNum * 1000).toISOString() : new Date().toISOString();

    // Drop empty stanzas that have no text, media, location, contact, or poll
    if (!text && !media && !location && !contact && !poll) {
      return null;
    }

    return {
      id: msg.key.id || `msg-${Date.now()}`,
      chatJid,
      senderJid: sender.jid,
      senderName: sender.displayName,
      senderNumber: sender.phoneNumber,
      fromMe: Boolean(msg.key.fromMe),
      timestamp,
      text: poll ? `📊 Poll: ${poll.name}` : text,
      type: poll ? 'poll' : type,
      media,
      location,
      contact,
      poll,
      quoted,
      isViewOnce: Boolean(unwrapped.viewOnce || (msg.key as any)?.isViewOnce),
    };
  }

  // ---------------------------------------------------------------------------
  // AUTHENTICATION & STATUS
  // ---------------------------------------------------------------------------
  private getStatusPayload(isAuthed = false) {
    const mem = process.memoryUsage();
    const botUser = botSocket?.user;
    return {
      status: botSocket ? 'connected' : 'disconnected',
      uptime: process.uptime(),
      commands: commandRegistry.getVisibleAll().length,
      authenticated: isAuthed,
      bot: botUser
        ? {
            id: botUser.id,
            phoneNumber: botUser.id?.split(':')[0]?.replace(/\D/g, '') || '',
            name: botUser.name || 'Bot',
            lid: botUser.lid || '',
          }
        : null,
      memory: isAuthed
        ? {
            rss: mem.rss,
            heapTotal: mem.heapTotal,
            heapUsed: mem.heapUsed,
            rssMb: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
            heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
          }
        : undefined,
      system: isAuthed
        ? {
            nodeVersion: process.version,
            platform: process.platform,
            pid: process.pid,
          }
        : undefined,
    };
  }

  private getPublicConfigPayload() {
    return {
      botName: 'CrystalDust V0 Bot',
      ownerName: config.OWNER_NAME,
      prefix: config.BOT_PREFIX,
      scriptUrl: config.SCRIPT_URL || '',
      donateText: config.DONATE_TEXT || '',
      rulesText: config.RULES_TEXT || '',
    };
  }

  private async getAuthQRDataUrl(): Promise<string> {
    if (!this.authQR) return '';
    return qrcode.toDataURL(this.authQR);
  }

  private cookieValue(header: string | undefined, name: string): string | undefined {
    const value = header
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name}=`))
      ?.slice(name.length + 1);
    return value ? decodeURIComponent(value) : undefined;
  }

  private tokenMatches(value: unknown): boolean {
    const token = config.DASHBOARD_AUTH_TOKEN || '';
    if (!token || typeof value !== 'string') return false;
    const left = Buffer.from(value);
    const right = Buffer.from(token);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  }

  private isDashboardAuthorized(req: express.Request): boolean {
    return (
      this.tokenMatches(req.query.token) ||
      this.tokenMatches(req.header('x-dashboard-token')) ||
      this.tokenMatches(this.cookieValue(req.header('cookie'), 'dashboard_auth'))
    );
  }

  private requireDashboardAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (!config.DASHBOARD_AUTH_TOKEN) {
      res.status(403).json({ success: false, error: 'DASHBOARD_AUTH_TOKEN is not configured.' });
      return;
    }

    if (this.isDashboardAuthorized(req)) {
      next();
      return;
    }

    res.status(401).json({ success: false, error: 'Unauthorized access. Provide valid dashboard token.' });
  }

  setBotSocket(socket: WASocket) {
    botSocket = socket;
    this.outboundQueue.start();
    this.authQR = null;
    this.pairingCode = null;
    this.io.emit('bot:connected', this.getStatusPayload(true));
    this.io.emit('status', this.getStatusPayload(true));
  }

  clearBotSocket() {
    botSocket = null;
    this.io.emit('bot:disconnected', this.getStatusPayload(false));
    this.io.emit('status', this.getStatusPayload(false));
  }

  async setAuthQR(qr: string) {
    this.authQR = qr;
    const qrDataUrl = await this.getAuthQRDataUrl();
    this.io.to('auth').emit('auth:qr', { qr: qrDataUrl });
  }

  setPairingCode(code: string) {
    this.pairingCode = code;
    this.io.to('auth').emit('auth:pairing-code', { code });
  }

  setConnectionManager(cm: any) {
    this.connectionManager = cm;
  }

  private setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json({ limit: '100mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '100mb' }));
  }

  // ---------------------------------------------------------------------------
  // ROUTES SETUP
  // ---------------------------------------------------------------------------
  private setupRoutes() {
    // Landing page
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
    });

    // Admin dashboard page
    this.app.get(['/auth', '/auth.html', '/admin'], (req, res) => {
      if (this.tokenMatches(req.query.token)) {
        res.setHeader(
          'Set-Cookie',
          `dashboard_auth=${encodeURIComponent(String(req.query.token))}; HttpOnly; SameSite=Lax; Path=/`
        );
      }
      res.sendFile(path.join(process.cwd(), 'public', 'auth.html'));
    });

    // Logout
    this.app.get('/auth/logout', (req, res) => {
      res.setHeader('Set-Cookie', 'dashboard_auth=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
      res.redirect('/auth');
    });

    // Login API
    this.app.post('/api/auth/login', (req, res) => {
      const token = req.body?.token;
      if (!this.tokenMatches(token)) {
        res.status(401).json({ success: false, error: 'Invalid access token.' });
        return;
      }

      res.setHeader(
        'Set-Cookie',
        `dashboard_auth=${encodeURIComponent(String(token))}; HttpOnly; SameSite=Lax; Path=/`
      );
      res.json({ success: true, message: 'Authenticated successfully.' });
    });

    this.app.post('/api/auth/logout', (req, res) => {
      res.setHeader('Set-Cookie', 'dashboard_auth=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
      res.json({ success: true, message: 'Logged out.' });
    });

    // Status and health
    this.app.get('/api/status', (req, res) => {
      const isAuthed = this.isDashboardAuthorized(req);
      res.json(this.getStatusPayload(isAuthed));
    });

    this.app.get('/api/public-config', (req, res) => {
      res.json(this.getPublicConfigPayload());
    });

    this.app.get('/healthz', (req, res) => {
      res.json({
        ok: true,
        ...this.getStatusPayload(false),
      });
    });

    this.app.get('/api/commands', (req, res) => {
      res.json({
        commands: commandRegistry.getVisibleAll().map((cmd) => ({
          name: cmd.name,
          category: cmd.category,
          description: cmd.description,
          usage: cmd.usage,
          examples: cmd.examples,
        })),
      });
    });

    this.app.get('/api/auth/qr', this.requireDashboardAuth.bind(this), async (req, res) => {
      if (!this.authQR) {
        return res.status(404).json({ error: 'QR not available' });
      }

      const qrDataUrl = await this.getAuthQRDataUrl();
      res.json({ qr: qrDataUrl });
    });

    this.app.get('/api/auth/pairing-code', this.requireDashboardAuth.bind(this), (req, res) => {
      if (!this.pairingCode) {
        return res.status(404).json({ error: 'Pairing code not available' });
      }

      res.json({ code: this.pairingCode });
    });

    this.app.post('/api/whatsapp/reset-session', this.requireDashboardAuth.bind(this), async (req, res) => {
      try {
        if (this.connectionManager && typeof this.connectionManager.resetSession === 'function') {
          await this.connectionManager.resetSession();
          res.json({ success: true, message: 'Session credentials purged. Fresh QR / pairing code initiated.' });
        } else {
          res.status(500).json({ success: false, error: 'ConnectionManager is not available.' });
        }
      } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message || 'Failed to reset session' });
      }
    });

    // -------------------------------------------------------------------------
    // CHATS & GROUPS LIST API
    // -------------------------------------------------------------------------
    this.app.get('/api/chats', this.requireDashboardAuth.bind(this), async (req, res) => {
      if (!botSocket) {
        res.status(503).json({ success: false, error: 'Bot is not connected to WhatsApp.' });
        return;
      }

      try {
        const groups: any[] = [];
        try {
          const groupsMap = await botSocket.groupFetchAllParticipating();
          const myPn = botSocket.user?.id?.split(':')[0]?.replace(/\D/g, '');
          const myLid = botSocket.user?.lid?.split(':')[0]?.replace(/\D/g, '');

          for (const [id, meta] of Object.entries(groupsMap)) {
            this.groupMetadataCache.set(id, { data: meta, cachedAt: Date.now() });
            const me = meta.participants?.find((p) => {
              const pNum = p.id?.replace(/\D/g, '');
              return (myPn && pNum?.includes(myPn)) || (myLid && pNum?.includes(myLid));
            });
            const isBotAdmin = Boolean(me?.admin);

            const live = this.liveMessageStore.get(id) || [];
            const lastLive = live[live.length - 1];
            const cachedActive = this.chatLastActiveMap.get(id);
            const lastActive =
              cachedActive?.timestamp ||
              lastLive?.timestamp ||
              (meta.creation ? new Date(meta.creation * 1000).toISOString() : '');
            const lastMessage =
              cachedActive?.lastText ||
              lastLive?.text ||
              (lastLive?.media ? `[${lastLive.media.kind}]` : '') ||
              '';

            groups.push({
              id,
              name: meta.subject || 'Untitled Group',
              desc: meta.desc?.slice(0, 180) || '',
              participantsCount: meta.participants?.length || 0,
              isGroup: true,
              isAnnounce: Boolean(meta.announce),
              isRestrict: Boolean(meta.restrict),
              isBotAdmin,
              owner: meta.owner || '',
              creation: meta.creation || 0,
              lastActive,
              lastMessage,
            });
          }
        } catch (groupErr: any) {
          logger.warn({ groupErr }, 'Could not fetch all participating groups');
        }

        const directChatsMap = new Map<string, any>();
        const allContacts = readContacts();

        // 1. Ingest saved contacts into direct chats map, mapping LIDs to standard phone JIDs
        for (const [rawKey, contact] of Object.entries(allContacts)) {
          if (rawKey.endsWith('@g.us') || rawKey.endsWith('@newsletter') || rawKey === 'status@broadcast') continue;

          let primaryJid = rawKey;
          if (rawKey.endsWith('@lid')) {
            const mappedPn = getPhoneFromLid(rawKey);
            if (mappedPn) {
              primaryJid = mappedPn;
            }
          }

          const live = this.liveMessageStore.get(primaryJid) || [];
          const lastLive = live[live.length - 1];
          const cachedActive = this.chatLastActiveMap.get(primaryJid);

          // IMPORTANT: Only assign lastActive if there is genuine message activity, NEVER fallback to contact.updatedAt
          const lastActive = cachedActive?.timestamp || lastLive?.timestamp || '';
          const lastMessage =
            cachedActive?.lastText ||
            lastLive?.text ||
            (lastLive?.media ? `[${lastLive.media.kind}]` : '') ||
            '';

          const existing = directChatsMap.get(primaryJid);
          const savedName = contact.savedName || existing?.savedName || undefined;
          const chosenName = savedName || contact.displayName || existing?.name || contact.profileName || contact.phoneNumber || primaryJid;
          const phoneNum = contact.phoneNumber || (primaryJid.endsWith('@s.whatsapp.net') ? primaryJid.replace(/\D/g, '') : existing?.phoneNumber || '');

          if (existing) {
            existing.savedName = savedName;
            existing.name = chosenName;
            if (phoneNum && !existing.phoneNumber) existing.phoneNumber = phoneNum;
            if (lastActive && (!existing.lastActive || new Date(lastActive).getTime() > new Date(existing.lastActive).getTime())) {
              existing.lastActive = lastActive;
              existing.lastMessage = lastMessage;
            }
          } else {
            directChatsMap.set(primaryJid, {
              id: primaryJid,
              name: chosenName,
              savedName,
              phoneNumber: phoneNum,
              isGroup: false,
              lastActive,
              lastMessage,
            });
          }
        }

        // 2. Include any active conversations from chatLastActiveMap or live store
        for (const k of this.chatLastActiveMap.keys()) {
          if (k.endsWith('@g.us') || k.endsWith('@newsletter') || k.endsWith('@broadcast') || k === 'status@broadcast') continue;
          if (!directChatsMap.has(k)) {
            const contact = allContacts[k] || (getLidFromPhone(k) ? allContacts[getLidFromPhone(k)!] : undefined);
            const live = this.liveMessageStore.get(k) || [];
            const lastLive = live[live.length - 1];
            const cachedActive = this.chatLastActiveMap.get(k);

            directChatsMap.set(k, {
              id: k,
              name: contact?.savedName || contact?.displayName || contact?.profileName || contact?.phoneNumber || k.replace(/\D/g, ''),
              savedName: contact?.savedName || undefined,
              phoneNumber: contact?.phoneNumber || k.replace(/\D/g, ''),
              isGroup: false,
              lastActive: cachedActive?.timestamp || lastLive?.timestamp || '',
              lastMessage: cachedActive?.lastText || lastLive?.text || '',
            });
          }
        }

        // 3. Include any deleted chats
        const deletedChats = listDeletedChats();
        for (const item of deletedChats) {
          if (item.chatJid.endsWith('@g.us') || directChatsMap.has(item.chatJid)) continue;
          const cachedActive = this.chatLastActiveMap.get(item.chatJid);
          directChatsMap.set(item.chatJid, {
            id: item.chatJid,
            name: item.lastSenderName || item.chatJid,
            phoneNumber: item.chatJid.replace(/\D/g, ''),
            isGroup: false,
            lastActive: cachedActive?.timestamp || item.lastDeletedAt,
            lastMessage: cachedActive?.lastText || '[Deleted Message]',
          });
        }

        // 4. Collect broadcasts & channels
        const broadcastsMap = new Map<string, any>();
        const broadcastJids = new Set<string>();
        for (const k of this.chatLastActiveMap.keys()) {
          if (k.endsWith('@newsletter') || k.endsWith('@broadcast') || k === 'status@broadcast') {
            broadcastJids.add(k);
          }
        }
        for (const k of this.liveMessageStore.keys()) {
          if (k.endsWith('@newsletter') || k.endsWith('@broadcast') || k === 'status@broadcast') {
            broadcastJids.add(k);
          }
        }
        broadcastJids.add('status@broadcast');

        for (const bJid of broadcastJids) {
          const live = this.liveMessageStore.get(bJid) || [];
          const lastLive = live[live.length - 1];
          const cachedActive = this.chatLastActiveMap.get(bJid);
          const lastActive = cachedActive?.timestamp || lastLive?.timestamp || '';
          const lastMessage =
            cachedActive?.lastText ||
            lastLive?.text ||
            (lastLive?.media ? `[${lastLive.media.kind}]` : '') ||
            '';

          const isStatus = bJid === 'status@broadcast';
          const name = isStatus
            ? 'WhatsApp Status Broadcast'
            : (bJid.split('@')[0] || 'Channel Broadcast');

          broadcastsMap.set(bJid, {
            id: bJid,
            name,
            isGroup: false,
            isBroadcast: true,
            isChannel: bJid.endsWith('@newsletter'),
            lastActive,
            lastMessage,
          });
        }

        // Sort groups: most recent activity first
        groups.sort((a, b) => new Date(b.lastActive || 0).getTime() - new Date(a.lastActive || 0).getTime());

        // Sort DMs: active messaging chats by latest date first; contacts without messages alphabetically
        const directChats = Array.from(directChatsMap.values()).sort((a, b) => {
          const timeA = a.lastActive ? new Date(a.lastActive).getTime() : 0;
          const timeB = b.lastActive ? new Date(b.lastActive).getTime() : 0;
          if (timeB !== timeA) return timeB - timeA;
          return (a.name || '').localeCompare(b.name || '');
        });

        // Sort broadcasts: latest activity first
        const broadcasts = Array.from(broadcastsMap.values()).sort((a, b) =>
          new Date(b.lastActive || 0).getTime() - new Date(a.lastActive || 0).getTime()
        );

        res.json({
          success: true,
          groups,
          directChats,
          broadcasts,
          totalGroups: groups.length,
          totalDirect: directChats.length,
          totalBroadcasts: broadcasts.length,
        });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message || 'Failed to fetch chats' });
      }
    });

    this.app.get('/api/contacts', this.requireDashboardAuth.bind(this), (req, res) => {
      const all = readContacts();
      const uniqueContacts: any[] = [];
      const seenPn = new Set<string>();

      for (const [k, c] of Object.entries(all)) {
        if (k.endsWith('@g.us') || k.endsWith('@newsletter') || k === 'status@broadcast') continue;
        if (k.endsWith('@s.whatsapp.net')) {
          seenPn.add(k);
          uniqueContacts.push(c);
        }
      }

      for (const [k, c] of Object.entries(all)) {
        if (k.endsWith('@lid')) {
          const mappedPn = getPhoneFromLid(k);
          if (mappedPn && seenPn.has(mappedPn)) continue;
          uniqueContacts.push(c);
        }
      }

      uniqueContacts.sort((a, b) => (a.savedName || a.displayName || '').localeCompare(b.savedName || b.displayName || ''));
      res.json({ success: true, contacts: uniqueContacts });
    });

    this.app.post('/api/contacts/sync', this.requireDashboardAuth.bind(this), async (req, res) => {
      if (!botSocket) {
        res.status(503).json({ success: false, error: 'Bot is not connected to WhatsApp.' });
        return;
      }
      try {
        const result = await triggerFullContactSync(botSocket);
        const contacts = Object.values(readContacts());
        this.io.to('auth').emit('contacts:updated', { count: contacts.length });
        res.json({ success: true, count: contacts.length, error: result.error });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message || 'Contact sync failed' });
      }
    });

    // -------------------------------------------------------------------------
    // CHAT MESSAGE HISTORY API (READ REAL MESSAGES)
    // -------------------------------------------------------------------------
    this.app.get('/api/starred-messages', this.requireDashboardAuth.bind(this), (_req, res) => {
      const messages = this.dashboardState.listStars().map((record) => ({ ...record,
        message: this.findDashboardMessage(record.chatJid, record.messageId) || record.message,
      }));
      res.json({ success: true, messages });
    });

    this.app.post('/api/chats/:jid/star', this.requireDashboardAuth.bind(this), async (req, res) => {
      const jid = String(req.params.jid);
      const { messageId, starred } = req.body || {};
      if (typeof messageId !== 'string' || typeof starred !== 'boolean') {
        res.status(400).json({ success: false, error: 'Message ID and starred boolean are required.' }); return;
      }
      if (!botSocket) { res.status(503).json({ success: false, error: 'Bot is not connected.' }); return; }
      const message = this.findDashboardMessage(jid, messageId);
      const stored = this.dashboardState.listStars().find((record) => this.messageInfoKeys(jid, messageId).some((key) => key.split('\0')[0] === record.chatJid) && record.messageId === messageId);
      if (!message && !stored) { res.status(404).json({ success: false, error: 'Message not found.' }); return; }
      try {
        const key = { remoteJid: jid, id: messageId, fromMe: message?.fromMe ?? stored!.fromMe };
        await botSocket.chatModify({ star: { messages: [{ id: messageId, fromMe: key.fromMe }], star: starred } }, jid);
        this.applyStar(key, starred);
        res.json({ success: true, starred });
      } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
    });

    this.app.post('/api/chats/:jid/edit-message', this.requireDashboardAuth.bind(this), async (req, res) => {
      const jid = String(req.params.jid);
      const { messageId, text } = req.body || {};
      if (typeof messageId !== 'string' || typeof text !== 'string' || !text.trim() || text.length > 65000) {
        res.status(400).json({ success: false, error: 'Message ID and non-empty text are required.' }); return;
      }
      const message = this.findDashboardMessage(jid, messageId);
      if (!message) { res.status(404).json({ success: false, error: 'Message not found.' }); return; }
      if (!message.fromMe || message.media || message.poll || message.contact || message.location || message.isDeleted || Date.now() - new Date(message.timestamp).getTime() > 15 * 60_000) {
        res.status(403).json({ success: false, error: 'Only your text messages sent within 15 minutes can be edited.' }); return;
      }
      if (!botSocket) { res.status(503).json({ success: false, error: 'Bot is not connected.' }); return; }
      try {
        const raw = this.rawMessageMap.get(messageId);
        const key = raw?.key.remoteJid === jid ? raw.key : { remoteJid: jid, id: messageId, fromMe: true };
        await botSocket.sendMessage(jid, { text: text.trim(), edit: key });
        this.applyMessageEdit(key, { conversation: text.trim() }, new Date().toISOString());
        res.json({ success: true });
      } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
    });

    this.app.get('/api/chats/:jid/ephemeral', this.requireDashboardAuth.bind(this), async (req, res) => {
      const jid = String(req.params.jid);
      try {
        if (jid.endsWith('@g.us') && botSocket) {
          const metadata = await botSocket.groupMetadata(jid);
          this.dashboardState.setTimer(jid, metadata.ephemeralDuration || 0);
        }
        res.json({ success: true, duration: this.dashboardState.timer(jid) ?? null });
      } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
    });

    this.app.post('/api/chats/:jid/ephemeral', this.requireDashboardAuth.bind(this), async (req, res) => {
      const jid = String(req.params.jid);
      const { duration } = req.body || {};
      if (!/@(g\.us|s\.whatsapp\.net|lid)$/.test(jid) || ![0, 86400, 604800, 7776000].includes(duration)) {
        res.status(400).json({ success: false, error: 'Choose Off, 24 hours, 7 days, or 90 days for a direct chat or group.' }); return;
      }
      if (!botSocket) { res.status(503).json({ success: false, error: 'Bot is not connected.' }); return; }
      try {
        await botSocket.sendMessage(jid, { disappearingMessagesInChat: duration });
        this.handleChatsUpdate([{ id: jid, ephemeralExpiration: duration }]);
        res.json({ success: true, duration });
      } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
    });

    this.app.get('/api/outbound', this.requireDashboardAuth.bind(this), async (_req, res) => {
      try { res.json({ success: true, messages: await this.outboundQueue.list() }); }
      catch (err: any) { res.status(503).json({ success: false, error: err.message }); }
    });
    this.app.post('/api/outbound/:id/retry', this.requireDashboardAuth.bind(this), async (req, res) => {
      try { await this.outboundQueue.retry(String(req.params.id)); res.json({ success: true }); }
      catch (err: any) { res.status(400).json({ success: false, error: err.message }); }
    });
    this.app.delete('/api/outbound/:id', this.requireDashboardAuth.bind(this), async (req, res) => {
      try { await this.outboundQueue.cancel(String(req.params.id)); res.json({ success: true }); }
      catch (err: any) { res.status(400).json({ success: false, error: err.message }); }
    });

    this.app.get('/api/chats/:jid/messages', this.requireDashboardAuth.bind(this), async (req, res) => {
      const jid = String(req.params.jid || '');
      const limit = Math.min(200, Math.max(10, Number(req.query.limit) || 60));

      const messageMap = new Map<string, DashboardChatMessage>();

      // 1. In-memory live store messages
      const live = this.liveMessageStore.get(jid) || [];
      for (const m of live) {
        messageMap.set(m.id, m);
      }

      // 2. Read from AI memory (ai-memory.jsonl)
      const aiMemoryPath = path.join(config.SESSION_PATH, 'ai-memory.jsonl');
      if (fs.existsSync(aiMemoryPath)) {
        try {
          const lines = fs.readFileSync(aiMemoryPath, 'utf8').split(/\r?\n/).filter(Boolean);
          for (const line of lines.slice(-2000)) {
            try {
              const entry = JSON.parse(line);
              if (entry.chatJid === jid) {
                const id = entry.messageId || `ai-${entry.ts}-${entry.senderJid}`;
                if (!messageMap.has(id)) {
                  messageMap.set(id, {
                    id,
                    chatJid: entry.chatJid,
                    senderJid: entry.senderJid,
                    senderName: entry.senderName,
                    senderNumber: entry.senderNumber,
                    fromMe: Boolean(entry.fromMe),
                    timestamp: entry.ts,
                    text: entry.text,
                    type: entry.messageType || 'conversation',
                  });
                }
              }
            } catch {}
          }
        } catch {}
      }

      // 3. Read from recovery state (loadState().messages, deleted, viewOnce)
      try {
        const state = loadState();
        const allRecovered = [...state.messages, ...state.deleted, ...(state.viewOnce || [])];
        for (const item of allRecovered) {
          if (item.chatJid === jid) {
            const isDel = state.deleted.some((d: any) => d.messageId === item.messageId);
            const isVo = Boolean(item.viewOnce || (state.viewOnce || []).some((v: any) => v.messageId === item.messageId));
            const existing = messageMap.get(item.messageId);

            const mediaUrl = item.media ? `/api/vault/media/${encodeURIComponent(item.messageId)}?chatJid=${encodeURIComponent(jid)}` : undefined;

            messageMap.set(item.messageId, {
              ...existing,
              id: item.messageId,
              chatJid: item.chatJid,
              senderJid: item.senderJid,
              senderName: item.senderName,
              senderNumber: item.senderNumber,
              fromMe: item.fromMe,
              timestamp: item.timestamp,
              text: item.text,
              type: item.messageType,
              media: item.media ? { ...item.media, url: mediaUrl } : existing?.media,
              isDeleted: isDel,
              isViewOnce: isVo,
            });
          }
        }
      } catch {}

      const sorted = Array.from(messageMap.values())
        .map((message) => {
          const reactions = this.getReactionState(jid, message.id);
          return this.applyDashboardState({ ...message, ...this.getMessageInfo(jid, message.id),
            ...(reactions.size ? { reactions: this.reactionCounts(reactions) } : {}) });
        })
        .filter(
          (m) =>
            !['protocolMessage', 'reactionMessage', 'senderKeyDistributionMessage', 'peerDataOperationRequestMessage'].includes(m.type) &&
            Boolean(m.text || m.media || m.location || m.contact || m.poll || m.isDeleted)
        )
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        .slice(-limit);

      res.json({
        success: true,
        chatJid: jid,
        messages: sorted,
        count: sorted.length,
      });
    });

    this.app.get('/api/chats/:jid', this.requireDashboardAuth.bind(this), async (req, res) => {
      const jid = String(req.params.jid || '');
      if (!botSocket) {
        res.status(503).json({ success: false, error: 'Bot is not connected to WhatsApp.' });
        return;
      }

      try {
        if (jid.endsWith('@g.us')) {
          const meta = await this.fetchGroupMetadata(jid);
          const myPn = botSocket.user?.id?.split(':')[0]?.replace(/\D/g, '');
          const myLid = botSocket.user?.lid?.split(':')[0]?.replace(/\D/g, '');
          const me = meta.participants?.find((p: any) => {
            const pNum = p.id?.replace(/\D/g, '');
            return (myPn && pNum?.includes(myPn)) || (myLid && pNum?.includes(myLid));
          });

          res.json({
            success: true,
            chat: {
              id: meta.id,
              name: meta.subject,
              desc: meta.desc || '',
              isGroup: true,
              isAnnounce: Boolean(meta.announce),
              isRestrict: Boolean(meta.restrict),
              isBotAdmin: Boolean(me?.admin),
              participantsCount: meta.participants?.length || 0,
              participants: meta.participants?.map((p: any) => ({
                id: p.id,
                phoneNumber: p.id?.replace(/\D/g, '') || '',
                role: p.admin || 'member',
              })),
            },
          });
          return;
        }

        res.json({
          success: true,
          chat: {
            id: jid,
            name: jid,
            isGroup: false,
          },
        });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message || 'Failed to fetch chat details' });
      }
    });

    // -------------------------------------------------------------------------
    // SEND CHAT (TEXT, WITH ADMIN-ONLY BYPASS OR QUEUE ON MUTE)
    // -------------------------------------------------------------------------
    this.app.post('/api/chats/send', this.requireDashboardAuth.bind(this), async (req, res) => {
      const { jid, text, bypassAdminOnly, queueOnUnlock, queueOnMute, queueOnOffline, quotedMessageId, requestId } = req.body || {};
      if (typeof jid !== 'string' || typeof text !== 'string' || !text.trim() || (requestId !== undefined && (typeof requestId !== 'string' || requestId.length > 128))) {
        res.status(400).json({ success: false, error: 'JID and text are required.' });
        return;
      }

      if (!botSocket) {
        if (queueOnOffline || queueOnUnlock || queueOnMute) {
          try {
            const jobId = await this.enqueueChat(jid, text, Boolean(req.body.mentionAll), quotedMessageId, requestId);
            res.json({ success: true, queued: true, jobId, note: 'Message queued until WhatsApp reconnects and chat permissions allow sending.' });
          } catch (err: any) { res.status(503).json({ success: false, error: err.message }); }
          return;
        }
        res.status(503).json({ success: false, error: 'Bot is not connected to WhatsApp.' });
        return;
      }

      const shouldQueue = Boolean(queueOnUnlock || queueOnMute);
      const rawQuoted = quotedMessageId ? this.rawMessageMap.get(quotedMessageId) : undefined;
      const quotedContext = rawQuoted
        ? {
            id: quotedMessageId,
            senderJid: rawQuoted.key.participant || rawQuoted.key.remoteJid || undefined,
            text:
              rawQuoted.message?.conversation ||
              rawQuoted.message?.extendedTextMessage?.text ||
              rawQuoted.message?.imageMessage?.caption ||
              rawQuoted.message?.videoMessage?.caption ||
              '[Message]',
          }
        : undefined;

      try {
        const isGroup = jid.endsWith('@g.us');
        let note = '';
        let bypassed = false;

        let mentions: string[] | undefined = undefined;
        let meta: any = null;
        if (isGroup) {
          try {
            meta = await this.fetchGroupMetadata(jid);
          } catch (mErr) {
            logger.debug({ mErr, jid }, 'Failed to fetch group metadata in send route');
          }
        }

        if (isGroup && meta && (req.body?.mentionAll || /\b@(everyone|all)\b/i.test(text))) {
          mentions = meta.participants?.map((p: any) => p.id);
        }

        if (isGroup && meta) {
          const isAnnounce = Boolean(meta.announce);
          const myPn = botSocket.user?.id?.split(':')[0]?.replace(/\D/g, '');
          const myLid = botSocket.user?.lid?.split(':')[0]?.replace(/\D/g, '');
          const me = meta.participants?.find((p: any) => {
            const pNum = p.id?.replace(/\D/g, '');
            return (myPn && pNum?.includes(myPn)) || (myLid && pNum?.includes(myLid));
          });
          const isBotAdmin = Boolean(me?.admin);

          if (isAnnounce && !isBotAdmin) {
              if (shouldQueue) {
                const jobId = await this.enqueueChat(jid, text, Boolean(req.body.mentionAll), quotedMessageId, requestId);
                res.json({
                  success: true,
                  queued: true,
                  jobId,
                  note: 'Message queued! It will automatically dispatch as soon as the group is unmuted by admins.',
                });
                return;
              }

              try {
                const sent = await botSocket.sendMessage(
                  jid,
                  { text: text.trim(), mentions },
                  this.chatSendOptions(jid, rawQuoted)
                );
                if (sent?.key.id) this.rawMessageMap.set(sent.key.id, sent);
                this.recordOutgoingChatMessage(jid, sent?.key.id || undefined, text.trim(), 'conversation', quotedContext);
                res.json({ success: true, messageId: sent?.key.id, note: 'Sent as group member.' });
                return;
              } catch (sendErr: any) {
                res.status(403).json({
                  success: false,
                  error: 'This group is restricted to Admins only and this bot is not an admin. You can check "Queue on Mute" to auto-send when opened.',
                });
                return;
              }
            }

            if (isAnnounce && isBotAdmin) {
              if (bypassAdminOnly) {
                try {
                  await botSocket.groupSettingUpdate(jid, 'not_announcement');
                  const sent = await botSocket.sendMessage(
                    jid,
                    { text: text.trim(), mentions },
                    this.chatSendOptions(jid, rawQuoted)
                  );
                  await botSocket.groupSettingUpdate(jid, 'announcement');
                  if (sent?.key.id) this.rawMessageMap.set(sent.key.id, sent);
                  bypassed = true;
                  note = 'Bypassed admin-only mode (temporarily unlocked group, sent message, and re-locked).';
                  this.recordOutgoingChatMessage(jid, sent?.key.id || undefined, text.trim(), 'conversation', quotedContext);
                  res.json({ success: true, messageId: sent?.key.id, bypassed, note });
                  return;
                } catch (toggleErr) {
                  const sent = await botSocket.sendMessage(
                    jid,
                    { text: text.trim(), mentions },
                    this.chatSendOptions(jid, rawQuoted)
                  );
                  if (sent?.key.id) this.rawMessageMap.set(sent.key.id, sent);
                  this.recordOutgoingChatMessage(jid, sent?.key.id || undefined, text.trim(), 'conversation', quotedContext);
                  res.json({ success: true, messageId: sent?.key.id, note: 'Sent directly using bot Admin privileges.' });
                  return;
                }
              } else {
                const sent = await botSocket.sendMessage(
                  jid,
                  { text: text.trim(), mentions },
                  this.chatSendOptions(jid, rawQuoted)
                );
                if (sent?.key.id) this.rawMessageMap.set(sent.key.id, sent);
                this.recordOutgoingChatMessage(jid, sent?.key.id || undefined, text.trim(), 'conversation', quotedContext);
                res.json({ success: true, messageId: sent?.key.id, note: 'Sent directly using bot Admin privileges.' });
                return;
              }
            }
          }

        const sent = await botSocket.sendMessage(
          jid,
          { text: text.trim(), mentions },
          this.chatSendOptions(jid, rawQuoted)
        );
        if (sent?.key.id) this.rawMessageMap.set(sent.key.id, sent);
        this.recordOutgoingChatMessage(jid, sent?.key.id || undefined, text.trim(), 'conversation', quotedContext);

        res.json({ success: true, messageId: sent?.key.id, note });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message || 'Failed to send message.' });
      }
    });

    // -------------------------------------------------------------------------
    // SEND MEDIA & ATTACHMENTS (IMAGE, VIDEO, AUDIO/VOICE NOTE, DOCUMENT, STICKER)
    // -------------------------------------------------------------------------
    this.app.post('/api/chats/send-media', this.requireDashboardAuth.bind(this), async (req, res) => {
      const {
        jid,
        file,
        media,
        caption,
        mimetype,
        fileName,
        viewOnce,
        isVoiceNote,
        ptt,
        bypassAdminOnly,
        quotedMessageId,
      } = req.body || {};
      const fileData = file || media;
      if (!jid || !fileData) {
        res.status(400).json({ success: false, error: 'JID and file/media data are required.' });
        return;
      }

      if (!botSocket) {
        res.status(503).json({ success: false, error: 'Bot is not connected to WhatsApp.' });
        return;
      }

      try {
        const matches = fileData.match(/^data:([A-Za-z0-9-+/.]+);base64,(.+)$/);
        const buffer = matches ? Buffer.from(matches[2], 'base64') : Buffer.from(fileData, 'base64');
        const effectiveMime = (matches ? matches[1] : mimetype || 'application/octet-stream').toLowerCase();

        const rawQuoted = quotedMessageId ? this.rawMessageMap.get(quotedMessageId) : undefined;
        const quotedContext = rawQuoted
          ? {
              id: quotedMessageId,
              senderJid: rawQuoted.key.participant || rawQuoted.key.remoteJid || undefined,
              text:
                rawQuoted.message?.conversation ||
                rawQuoted.message?.extendedTextMessage?.text ||
                '[Message]',
            }
          : undefined;

        // Optional announce bypass if group
        if (jid.endsWith('@g.us') && bypassAdminOnly) {
          try {
            await botSocket.groupSettingUpdate(jid, 'not_announcement');
          } catch {}
        }

        let sent: any;
        let kind = 'document';

        const sendOpts = this.chatSendOptions(jid, rawQuoted);

        if (effectiveMime.startsWith('image/') && !effectiveMime.includes('webp')) {
          kind = 'image';
          sent = await botSocket.sendMessage(
            jid,
            {
              image: buffer,
              caption: caption || undefined,
              viewOnce: Boolean(viewOnce),
            },
            sendOpts
          );
        } else if (effectiveMime.startsWith('video/')) {
          kind = 'video';
          sent = await botSocket.sendMessage(
            jid,
            {
              video: buffer,
              caption: caption || undefined,
              viewOnce: Boolean(viewOnce),
            },
            sendOpts
          );
        } else if (effectiveMime.startsWith('audio/')) {
          kind = 'audio';
          sent = await botSocket.sendMessage(
            jid,
            {
              audio: buffer,
              mimetype: effectiveMime,
              ptt: Boolean(isVoiceNote || ptt),
            },
            sendOpts
          );
        } else if (effectiveMime.includes('webp')) {
          kind = 'sticker';
          sent = await botSocket.sendMessage(
            jid,
            {
              sticker: buffer,
            },
            sendOpts
          );
        } else {
          kind = 'document';
          sent = await botSocket.sendMessage(
            jid,
            {
              document: buffer,
              mimetype: effectiveMime,
              fileName: fileName || 'attachment',
              caption: caption || undefined,
            },
            sendOpts
          );
        }

        if (jid.endsWith('@g.us') && bypassAdminOnly) {
          try {
            await botSocket.groupSettingUpdate(jid, 'announcement');
          } catch {}
        }

        if (sent?.key.id) this.rawMessageMap.set(sent.key.id, sent);

        const msgObj: DashboardChatMessage = {
          id: sent?.key.id || `media-${Date.now()}`,
          chatJid: jid,
          senderJid: botSocket.user?.id || '',
          senderName: botSocket.user?.name || 'Bot',
          senderNumber: botSocket.user?.id?.split(':')[0]?.replace(/\D/g, '') || '',
          fromMe: true,
          timestamp: new Date().toISOString(),
          text: caption || `[${kind.toUpperCase()}]`,
          type: kind,
          media: {
            kind,
            mimetype: effectiveMime,
            fileName,
            size: buffer.length,
          },
          isViewOnce: Boolean(viewOnce),
          quoted: quotedContext,
        };
        this.addMessageToStore(msgObj, sent);
        this.io.to('auth').emit('chat:message', msgObj);

        res.json({ success: true, messageId: sent?.key.id, kind });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message || 'Failed to send media attachment.' });
      }
    });

    // -------------------------------------------------------------------------
    // SEND LOCATION
    // -------------------------------------------------------------------------
    this.app.post('/api/chats/send-location', this.requireDashboardAuth.bind(this), async (req, res) => {
      const { jid, latitude, longitude, name, address } = req.body || {};
      if (!jid || latitude === undefined || longitude === undefined) {
        res.status(400).json({ success: false, error: 'JID, latitude, and longitude are required.' });
        return;
      }

      if (!botSocket) {
        res.status(503).json({ success: false, error: 'Bot is not connected to WhatsApp.' });
        return;
      }

      try {
        const sent = await botSocket.sendMessage(jid, {
          location: {
            degreesLatitude: Number(latitude),
            degreesLongitude: Number(longitude),
            name: name || undefined,
            address: address || undefined,
          },
        }, this.chatSendOptions(jid));

        const msgObj: DashboardChatMessage = {
          id: sent?.key.id || `loc-${Date.now()}`,
          chatJid: jid,
          senderJid: botSocket.user?.id || '',
          senderName: botSocket.user?.name || 'Bot',
          senderNumber: botSocket.user?.id?.split(':')[0]?.replace(/\D/g, '') || '',
          fromMe: true,
          timestamp: new Date().toISOString(),
          text: `📍 Location: ${name || `${latitude}, ${longitude}`}`,
          type: 'location',
          location: {
            degreesLatitude: Number(latitude),
            degreesLongitude: Number(longitude),
            name: name || undefined,
            address: address || undefined,
          },
        };
        this.addMessageToStore(msgObj, sent);
        this.io.to('auth').emit('chat:message', msgObj);

        res.json({ success: true, messageId: sent?.key.id });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message || 'Failed to send location.' });
      }
    });

    // -------------------------------------------------------------------------
    // SEND CONTACT (VCARD)
    // -------------------------------------------------------------------------
    this.app.post('/api/chats/send-contact', this.requireDashboardAuth.bind(this), async (req, res) => {
      const { jid, displayName, phoneNumber, organization } = req.body || {};
      if (!jid || !displayName || !phoneNumber) {
        res.status(400).json({ success: false, error: 'JID, displayName, and phoneNumber are required.' });
        return;
      }

      if (!botSocket) {
        res.status(503).json({ success: false, error: 'Bot is not connected to WhatsApp.' });
        return;
      }

      try {
        const cleanPhone = String(phoneNumber).replace(/\D/g, '');
        const vcard =
          'BEGIN:VCARD\n' +
          'VERSION:3.0\n' +
          `FN:${displayName}\n` +
          `ORG:${organization || ''};\n` +
          `TEL;type=CELL;type=VOICE;waid=${cleanPhone}:${phoneNumber}\n` +
          'END:VCARD';

        const sent = await botSocket.sendMessage(jid, {
          contacts: {
            displayName,
            contacts: [{ vcard }],
          },
        }, this.chatSendOptions(jid));

        const msgObj: DashboardChatMessage = {
          id: sent?.key.id || `contact-${Date.now()}`,
          chatJid: jid,
          senderJid: botSocket.user?.id || '',
          senderName: botSocket.user?.name || 'Bot',
          senderNumber: botSocket.user?.id?.split(':')[0]?.replace(/\D/g, '') || '',
          fromMe: true,
          timestamp: new Date().toISOString(),
          text: `👤 Contact: ${displayName} (${phoneNumber})`,
          type: 'contact',
          contact: {
            displayName,
            vcard,
          },
        };
        this.addMessageToStore(msgObj, sent);
        this.io.to('auth').emit('chat:message', msgObj);

        res.json({ success: true, messageId: sent?.key.id });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message || 'Failed to send contact.' });
      }
    });

    // -------------------------------------------------------------------------
    // SEND STICKER (AUTO-CONVERTS IMAGE TO 512x512 WEBP VIA SHARP)
    // -------------------------------------------------------------------------
    this.app.post('/api/chats/send-sticker', this.requireDashboardAuth.bind(this), async (req, res) => {
      const { jid, image } = req.body || {};
      if (!jid || !image) {
        res.status(400).json({ success: false, error: 'JID and image are required.' });
        return;
      }

      if (!botSocket) {
        res.status(503).json({ success: false, error: 'Bot is not connected to WhatsApp.' });
        return;
      }

      try {
        const matches = image.match(/^data:([A-Za-z0-9-+/.]+);base64,(.+)$/);
        const buffer = matches ? Buffer.from(matches[2], 'base64') : Buffer.from(image, 'base64');

        // Convert to standard 512x512 WebP sticker format
        const webpBuffer = await sharp(buffer)
          .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .webp({ quality: 80 })
          .toBuffer();

        const sent = await botSocket.sendMessage(jid, {
          sticker: webpBuffer,
        }, this.chatSendOptions(jid));

        const msgObj: DashboardChatMessage = {
          id: sent?.key.id || `sticker-${Date.now()}`,
          chatJid: jid,
          senderJid: botSocket.user?.id || '',
          senderName: botSocket.user?.name || 'Bot',
          senderNumber: botSocket.user?.id?.split(':')[0]?.replace(/\D/g, '') || '',
          fromMe: true,
          timestamp: new Date().toISOString(),
          text: `[STICKER]`,
          type: 'sticker',
          media: {
            kind: 'sticker',
            mimetype: 'image/webp',
            size: webpBuffer.length,
          },
        };
        this.addMessageToStore(msgObj, sent);
        this.io.to('auth').emit('chat:message', msgObj);

        res.json({ success: true, messageId: sent?.key.id });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message || 'Failed to convert and send sticker.' });
      }
    });

    // -------------------------------------------------------------------------
    // SEND REACTION EMOJI
    // -------------------------------------------------------------------------
    this.app.post('/api/chats/send-reaction', this.requireDashboardAuth.bind(this), async (req, res) => {
      const { jid, messageId, emoji, participant, fromMe } = req.body || {};
      if (!jid || !messageId) {
        res.status(400).json({ success: false, error: 'JID and messageId are required.' });
        return;
      }

      if (!botSocket) {
        res.status(503).json({ success: false, error: 'Bot is not connected to WhatsApp.' });
        return;
      }

      try {
        const socket = botSocket;
        const sent = await socket.sendMessage(jid, {
          react: {
            text: emoji || '', // empty string removes reaction
            key: {
              remoteJid: jid,
              id: messageId,
              participant: participant || undefined,
              fromMe: Boolean(fromMe),
            },
          },
        });

        this.applyReaction(jid, messageId, socket.user?.id || socket.user?.lid || '', emoji || '',
          Number(sent?.message?.reactionMessage?.senderTimestampMs) || Date.now());

        res.json({ success: true });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message || 'Failed to send reaction.' });
      }
    });

    // -------------------------------------------------------------------------
    // DELETE / REVOKE MESSAGE ("DELETE FOR EVERYONE")
    // -------------------------------------------------------------------------
    this.app.post('/api/chats/delete-message', this.requireDashboardAuth.bind(this), async (req, res) => {
      const { jid, messageId, participant, fromMe } = req.body || {};
      if (!jid || !messageId) {
        res.status(400).json({ success: false, error: 'JID and messageId are required.' });
        return;
      }

      if (!botSocket) {
        res.status(503).json({ success: false, error: 'Bot is not connected to WhatsApp.' });
        return;
      }

      try {
        await botSocket.sendMessage(jid, {
          delete: {
            remoteJid: jid,
            id: messageId,
            participant: participant || undefined,
            fromMe: Boolean(fromMe),
          },
        });

        res.json({ success: true, message: 'Message revocation sent.' });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message || 'Failed to delete message.' });
      }
    });

    // -------------------------------------------------------------------------
    // SET PRESENCE (TYPING, RECORDING, AVAILABLE, PAUSED)
    // -------------------------------------------------------------------------
    this.app.post('/api/chats/presence', this.requireDashboardAuth.bind(this), async (req, res) => {
      const { jid, presence } = req.body || {};
      if (!jid || !presence) {
        res.status(400).json({ success: false, error: 'JID and presence are required.' });
        return;
      }

      if (!botSocket) {
        res.status(503).json({ success: false, error: 'Bot is not connected.' });
        return;
      }

      try {
        await botSocket.sendPresenceUpdate(presence, jid);
        res.json({ success: true, presence });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message });
      }
    });

    // -------------------------------------------------------------------------
    // GET CHAT / GROUP DETAILED METADATA & PARTICIPANTS
    // -------------------------------------------------------------------------
    this.app.get('/api/chats/:jid/metadata', this.requireDashboardAuth.bind(this), async (req, res) => {
      const jid = String(req.params.jid || '');
      if (!botSocket) {
        res.status(503).json({ success: false, error: 'Bot is not connected.' });
        return;
      }

      try {
        if (jid.endsWith('@g.us')) {
          const meta = await this.fetchGroupMetadata(jid);
          const myPn = botSocket.user?.id?.split(':')[0]?.replace(/\D/g, '');
          const myLid = botSocket.user?.lid?.split(':')[0]?.replace(/\D/g, '');
          const me = meta.participants?.find((p: any) => {
            const pNum = p.id?.replace(/\D/g, '');
            return (myPn && pNum?.includes(myPn)) || (myLid && pNum?.includes(myLid));
          });
          const isBotAdmin = Boolean(me?.admin);

          let inviteCode: string | null = meta.inviteCode || null;
          if (!inviteCode && isBotAdmin) {
            try {
              inviteCode = (await botSocket.groupInviteCode(jid)) || null;
            } catch {}
          }

          const participants = (meta.participants || []).map((p: any) => ({
            id: p.id,
            phoneNumber: p.id.split('@')[0].replace(/\D/g, ''),
            admin: p.admin || null,
            isSuperAdmin: p.admin === 'superadmin',
            isAdmin: Boolean(p.admin),
          }));

          const metadataPayload = {
            id: meta.id,
            subject: meta.subject || 'Untitled Group',
            owner: meta.owner || '',
            creation: meta.creation || 0,
            desc: meta.desc?.toString() || '',
            participantsCount: participants.length,
            announce: Boolean(meta.announce),
            restrict: Boolean(meta.restrict),
            isAnnounce: Boolean(meta.announce),
            isRestrict: Boolean(meta.restrict),
            isBotAdmin,
            botAdminRole: me?.admin || null,
            inviteCode,
            inviteLink: inviteCode ? `https://chat.whatsapp.com/${inviteCode}` : null,
            participants,
          };

          res.json({
            success: true,
            isGroup: true,
            metadata: metadataPayload,
            ...metadataPayload,
          });
        } else {
          res.json({
            success: true,
            isGroup: false,
            id: jid,
            phoneNumber: jid.split('@')[0].replace(/\D/g, ''),
            metadata: {
              id: jid,
              subject: jid.split('@')[0],
              participantsCount: 1,
              participants: [],
            },
          });
        }
      } catch (err: any) {
        logger.error({ err, jid }, 'Failed to fetch group metadata');
        res.status(500).json({ success: false, error: err?.message || 'Failed to fetch metadata.' });
      }
    });

    // -------------------------------------------------------------------------
    // GROUP PARTICIPANTS UPDATE (ADD / REMOVE / PROMOTE / DEMOTE)
    // -------------------------------------------------------------------------
    this.app.post('/api/chats/:jid/participants', this.requireDashboardAuth.bind(this), async (req, res) => {
      const jid = String(req.params.jid || '');
      const { action, participants } = req.body || {};
      if (!jid.endsWith('@g.us')) {
        res.status(400).json({ success: false, error: 'Only group chats support participant management.' });
        return;
      }
      if (!action || !Array.isArray(participants) || !participants.length) {
        res.status(400).json({ success: false, error: 'Action and participants array are required.' });
        return;
      }

      if (!botSocket) {
        res.status(503).json({ success: false, error: 'Bot is not connected.' });
        return;
      }

      try {
        const formatted = participants.map((p: string) =>
          p.includes('@') ? p : `${p.replace(/\D/g, '')}@s.whatsapp.net`
        );
        const result = await botSocket.groupParticipantsUpdate(jid, formatted, action);
        this.groupMetadataCache.delete(jid);
        res.json({ success: true, action, result });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message || 'Participant update failed.' });
      }
    });

    // -------------------------------------------------------------------------
    // GROUP SETTINGS UPDATE (ANNOUNCEMENT / LOCKED)
    // -------------------------------------------------------------------------
    this.app.post('/api/chats/:jid/settings', this.requireDashboardAuth.bind(this), async (req, res) => {
      const jid = String(req.params.jid || '');
      const { setting } = req.body || {};
      if (!jid.endsWith('@g.us')) {
        res.status(400).json({ success: false, error: 'Only group chats support settings update.' });
        return;
      }
      if (!setting || !['announcement', 'not_announcement', 'locked', 'unlocked'].includes(setting)) {
        res.status(400).json({ success: false, error: 'Valid setting is required.' });
        return;
      }

      if (!botSocket) {
        res.status(503).json({ success: false, error: 'Bot is not connected.' });
        return;
      }

      try {
        await botSocket.groupSettingUpdate(jid, setting);
        this.groupMetadataCache.delete(jid);
        res.json({ success: true, setting });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message || 'Group setting update failed.' });
      }
    });

    // -------------------------------------------------------------------------
    // UPDATE GROUP SUBJECT & DESCRIPTION
    // -------------------------------------------------------------------------
    this.app.post('/api/chats/:jid/subject-desc', this.requireDashboardAuth.bind(this), async (req, res) => {
      const jid = String(req.params.jid || '');
      const { subject, description } = req.body || {};
      if (!jid.endsWith('@g.us')) {
        res.status(400).json({ success: false, error: 'Only group chats support subject/description update.' });
        return;
      }

      if (!botSocket) {
        res.status(503).json({ success: false, error: 'Bot is not connected.' });
        return;
      }

      try {
        if (subject !== undefined) {
          await botSocket.groupUpdateSubject(jid, subject);
        }
        if (description !== undefined) {
          await botSocket.groupUpdateDescription(jid, description);
        }
        this.groupMetadataCache.delete(jid);
        res.json({ success: true, subject, description });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message || 'Failed to update subject or description.' });
      }
    });

    // -------------------------------------------------------------------------
    // GROUP INVITE CODE & REVOKE
    // -------------------------------------------------------------------------
    this.app.post('/api/chats/:jid/invite-code', this.requireDashboardAuth.bind(this), async (req, res) => {
      const jid = String(req.params.jid || '');
      const { action } = req.body || {};
      if (!jid.endsWith('@g.us')) {
        res.status(400).json({ success: false, error: 'Only group chats have invite links.' });
        return;
      }

      if (!botSocket) {
        res.status(503).json({ success: false, error: 'Bot is not connected.' });
        return;
      }

      try {
        let code: string | null | undefined = null;
        if (action === 'revoke') {
          code = await botSocket.groupRevokeInvite(jid);
          this.groupMetadataCache.delete(jid);
        } else {
          code = await botSocket.groupInviteCode(jid);
        }
        res.json({
          success: true,
          inviteCode: code,
          inviteLink: code ? `https://chat.whatsapp.com/${code}` : null,
        });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message || 'Failed to get/revoke invite code.' });
      }
    });

    // -------------------------------------------------------------------------
    // LEAVE GROUP
    // -------------------------------------------------------------------------
    this.app.post('/api/chats/:jid/leave', this.requireDashboardAuth.bind(this), async (req, res) => {
      const jid = String(req.params.jid || '');
      if (!jid.endsWith('@g.us')) {
        res.status(400).json({ success: false, error: 'Only groups can be left.' });
        return;
      }

      if (!botSocket) {
        res.status(503).json({ success: false, error: 'Bot is not connected.' });
        return;
      }

      try {
        await botSocket.groupLeave(jid);
        this.groupMetadataCache.delete(jid);
        res.json({ success: true, message: 'Left group successfully.' });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message || 'Failed to leave group.' });
      }
    });

    // -------------------------------------------------------------------------
    // SEND INTERACTIVE POLL
    // -------------------------------------------------------------------------
    this.app.post('/api/chats/send-poll', this.requireDashboardAuth.bind(this), async (req, res) => {
      const { jid, name, options, selectableCount, quotedMessageId } = req.body || {};
      if (!jid || !name || !Array.isArray(options) || options.length < 2) {
        res.status(400).json({ success: false, error: 'JID, poll question name, and at least 2 options are required.' });
        return;
      }

      if (!botSocket) {
        res.status(503).json({ success: false, error: 'Bot is not connected.' });
        return;
      }

      try {
        const rawQuoted = quotedMessageId ? this.rawMessageMap.get(quotedMessageId) : undefined;
        const quotedContext = rawQuoted
          ? {
              id: quotedMessageId,
              senderJid: rawQuoted.key.participant || rawQuoted.key.remoteJid || undefined,
              text:
                rawQuoted.message?.conversation ||
                rawQuoted.message?.extendedTextMessage?.text ||
                '[Message]',
            }
          : undefined;

        const sent = await botSocket.sendMessage(
          jid,
          {
            poll: {
              name: name.trim(),
              values: options.map((o: string) => o.trim()).filter(Boolean),
              selectableCount: Math.min(options.length, Math.max(1, Number(selectableCount) || 1)),
            },
          },
          this.chatSendOptions(jid, rawQuoted)
        );

        if (sent?.key.id) this.rawMessageMap.set(sent.key.id, sent);

        const msgObj: DashboardChatMessage = {
          id: sent?.key.id || `poll-${Date.now()}`,
          chatJid: jid,
          senderJid: botSocket.user?.id || '',
          senderName: botSocket.user?.name || 'Bot',
          senderNumber: botSocket.user?.id?.split(':')[0]?.replace(/\D/g, '') || '',
          fromMe: true,
          timestamp: new Date().toISOString(),
          text: `📊 Poll: ${name.trim()}`,
          type: 'poll',
          poll: {
            name: name.trim(),
            options: options.map((o: string) => o.trim()).filter(Boolean),
            selectableCount: Math.min(options.length, Math.max(1, Number(selectableCount) || 1)),
          },
          quoted: quotedContext,
        };
        this.addMessageToStore(msgObj, sent);
        this.io.to('auth').emit('chat:message', msgObj);

        res.json({ success: true, messageId: sent?.key.id });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message || 'Failed to send poll.' });
      }
    });

    // -------------------------------------------------------------------------
    // MARK CHAT MESSAGES AS READ
    // -------------------------------------------------------------------------
    this.app.post('/api/chats/:jid/mark-read', this.requireDashboardAuth.bind(this), async (req, res) => {
      const jid = String(req.params.jid || '');
      const { messageIds } = req.body || {};

      if (!botSocket) {
        res.status(503).json({ success: false, error: 'Bot is not connected.' });
        return;
      }

      try {
        const live = this.liveMessageStore.get(jid) || [];
        const targetIds: string[] = Array.isArray(messageIds) && messageIds.length
          ? messageIds
          : live.filter((m) => !m.fromMe).map((m) => m.id);

        const keys = targetIds.map((id) => ({
          remoteJid: jid,
          id,
        }));

        if (keys.length) {
          await botSocket.readMessages(keys);
        }

        res.json({ success: true, count: keys.length });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message || 'Failed to mark read.' });
      }
    });

    // -------------------------------------------------------------------------
    // CLEAR IN-MEMORY CHAT BUFFER
    // -------------------------------------------------------------------------
    this.app.post('/api/chats/:jid/clear-history', this.requireDashboardAuth.bind(this), (req, res) => {
      const jid = String(req.params.jid || '');
      this.liveMessageStore.delete(jid);
      res.json({ success: true, message: 'Chat history cleared in dashboard memory.' });
    });

    // -------------------------------------------------------------------------
    // CHAT ANALYTICS & LURKER DETECTOR
    // -------------------------------------------------------------------------
    this.app.get('/api/chats/:jid/analytics', this.requireDashboardAuth.bind(this), async (req, res) => {
      const jid = String(req.params.jid || '');
      if (!botSocket) {
        res.status(503).json({ success: false, error: 'Bot is not connected.' });
        return;
      }

      try {
        const live = this.liveMessageStore.get(jid) || [];
        const isGroup = jid.endsWith('@g.us');

        const typeBreakdown: Record<string, number> = {};
        const senderCounts = new Map<string, { count: number; name: string; number: string; lastSeen: string }>();
        const hourly = new Array(24).fill(0);

        for (const msg of live) {
          typeBreakdown[msg.type] = (typeBreakdown[msg.type] || 0) + 1;

          const senderId = msg.senderJid || msg.senderNumber || 'Unknown';
          const cur = senderCounts.get(senderId) || {
            count: 0,
            name: msg.senderName || msg.senderNumber || (msg.fromMe ? 'Bot' : 'User'),
            number: msg.senderNumber || senderId.split('@')[0],
            lastSeen: msg.timestamp,
          };
          cur.count++;
          if (new Date(msg.timestamp) > new Date(cur.lastSeen)) {
            cur.lastSeen = msg.timestamp;
          }
          senderCounts.set(senderId, cur);

          if (msg.timestamp) {
            const hour = new Date(msg.timestamp).getHours();
            if (hour >= 0 && hour < 24) {
              hourly[hour]++;
            }
          }
        }

        const sortedSenders = Array.from(senderCounts.entries())
          .map(([jidKey, data]) => ({
            jid: jidKey,
            ...data,
            percentage: live.length ? Math.round((data.count / live.length) * 100) : 0,
          }))
          .sort((a, b) => b.count - a.count);

        let lurkers: Array<{ id: string; phoneNumber: string }> = [];
        let participantsCount = 0;

        if (isGroup) {
          try {
            const metadata = await this.fetchGroupMetadata(jid);
            participantsCount = metadata.participants?.length || 0;
            const activeJids = new Set(Array.from(senderCounts.keys()).map((k) => k.split('@')[0]));

            lurkers = (metadata.participants || [])
              .filter((p: any) => !activeJids.has(p.id.split('@')[0]))
              .map((p: any) => ({
                id: p.id,
                phoneNumber: p.id.split('@')[0].replace(/\D/g, ''),
              }));
          } catch (mErr) {
            logger.warn({ mErr, jid }, 'Could not fetch metadata for lurker analysis');
          }
        }

        res.json({
          success: true,
          analytics: {
            chatJid: jid,
            isGroup,
            totalRecorded: live.length,
            participantsCount,
            typeBreakdown,
            hourlyActivity: hourly,
            topSenders: sortedSenders.slice(0, 10),
            lurkersCount: lurkers.length,
            lurkers: lurkers.slice(0, 50),
          },
        });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message || 'Failed to compute chat analytics.' });
      }
    });

    // -------------------------------------------------------------------------
    // SCHEDULED MESSAGES (SCHEDULE, LIST, CANCEL)
    // -------------------------------------------------------------------------
    this.app.post('/api/chats/schedule', this.requireDashboardAuth.bind(this), (req, res) => {
      const { jid, text, sendAt, mentionAll, quotedMessageId } = req.body || {};
      if (!jid || !text || !sendAt) {
        res.status(400).json({ success: false, error: 'jid, text, and sendAt timestamp are required.' });
        return;
      }

      const targetTime = new Date(sendAt).getTime();
      if (isNaN(targetTime) || targetTime <= Date.now()) {
        res.status(400).json({ success: false, error: 'sendAt must be a valid future ISO date/time.' });
        return;
      }

      const newItem: ScheduledMessage = {
        id: `sched-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        chatJid: jid,
        text: String(text).trim(),
        sendAt: new Date(targetTime).toISOString(),
        mentionAll: Boolean(mentionAll),
        quotedMessageId: quotedMessageId || undefined,
        createdAt: new Date().toISOString(),
      };

      this.scheduledMessages.push(newItem);
      this.io.to('auth').emit('chat:scheduled-update', this.scheduledMessages);

      res.json({ success: true, item: newItem });
    });

    this.app.get('/api/chats/scheduled', this.requireDashboardAuth.bind(this), (req, res) => {
      const jid = req.query.jid ? String(req.query.jid) : null;
      const list = jid ? this.scheduledMessages.filter((m) => m.chatJid === jid) : this.scheduledMessages;
      res.json({ success: true, scheduled: list });
    });

    this.app.delete('/api/chats/scheduled/:id', this.requireDashboardAuth.bind(this), (req, res) => {
      const id = String(req.params.id);
      const prevLen = this.scheduledMessages.length;
      this.scheduledMessages = this.scheduledMessages.filter((m) => m.id !== id);
      const removed = this.scheduledMessages.length < prevLen;
      if (removed) {
        this.io.to('auth').emit('chat:scheduled-update', this.scheduledMessages);
      }
      res.json({ success: true, removed });
    });

    // -------------------------------------------------------------------------
    // BATCH FORWARD TO MULTIPLE CHATS (BYPASSING 5-FORWARD LIMIT)
    // -------------------------------------------------------------------------
    this.app.post('/api/chats/forward-batch', this.requireDashboardAuth.bind(this), async (req, res) => {
      const { messageId, sourceJid, targetJids } = req.body || {};
      if (!messageId || !Array.isArray(targetJids) || !targetJids.length) {
        res.status(400).json({ success: false, error: 'messageId and targetJids array are required.' });
        return;
      }

      if (!botSocket) {
        res.status(503).json({ success: false, error: 'Bot is not connected.' });
        return;
      }

      try {
        const rawMsg = this.rawMessageMap.get(messageId);
        const storedMsg = (this.liveMessageStore.get(sourceJid) || []).find((m) => m.id === messageId);

        const successfulTargets: string[] = [];
        const failedTargets: string[] = [];

        for (const targetJid of targetJids) {
          try {
            if (rawMsg) {
              const sent = await botSocket.sendMessage(targetJid, { forward: rawMsg });
              if (sent?.key.id) this.rawMessageMap.set(sent.key.id, sent);
              this.recordOutgoingChatMessage(
                targetJid,
                sent?.key.id || undefined,
                storedMsg?.text || '[Forwarded Message]',
                storedMsg?.type || 'conversation'
              );
            } else if (storedMsg) {
              const sent = await botSocket.sendMessage(targetJid, { text: storedMsg.text || '[Forwarded Message]' });
              if (sent?.key.id) this.rawMessageMap.set(sent.key.id, sent);
              this.recordOutgoingChatMessage(targetJid, sent?.key.id || undefined, storedMsg.text || '', 'conversation');
            }
            successfulTargets.push(targetJid);
          } catch (fErr) {
            failedTargets.push(targetJid);
          }
        }

        res.json({
          success: true,
          forwardedCount: successfulTargets.length,
          successfulTargets,
          failedTargets,
        });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message || 'Batch forward failed.' });
      }
    });

    // -------------------------------------------------------------------------
    // MULTI-COMMAND BATCH RUNNER
    // -------------------------------------------------------------------------
    this.app.post('/api/commands/execute', this.requireDashboardAuth.bind(this), async (req, res) => {
      const { commands, targetJid, sendToChat, delayMs } = req.body || {};
      const commandList: string[] = Array.isArray(commands)
        ? commands
        : typeof commands === 'string'
        ? commands.split('\n').map((l) => l.trim()).filter(Boolean)
        : [];

      if (!commandList.length) {
        res.status(400).json({ success: false, error: 'No commands provided.' });
        return;
      }

      if (!botSocket) {
        res.status(503).json({ success: false, error: 'Bot is not connected to WhatsApp.' });
        return;
      }

      const results = [];
      const delay = Math.max(0, Math.min(Number(delayMs) || 100, 5000));
      const ownerNumber =
        config.OWNER_NUMBER?.replace(/\D/g, '') ||
        botSocket.user?.id?.split(':')[0]?.replace(/\D/g, '') ||
        '0';
      const defaultJid = targetJid || `${ownerNumber}@s.whatsapp.net`;
      const ownerJid = `${ownerNumber}@s.whatsapp.net`;

      for (let i = 0; i < commandList.length; i++) {
        const cmdStr = commandList[i].trim();
        if (!cmdStr) continue;

        if (i > 0 && delay > 0) {
          await new Promise((r) => setTimeout(r, delay));
        }

        const startTime = Date.now();
        const prefix = config.BOT_PREFIX || '.';
        const body = cmdStr.startsWith(prefix) ? cmdStr.slice(prefix.length).trim() : cmdStr;
        const firstSpace = body.search(/\s/);
        const commandName = (firstSpace === -1 ? body : body.slice(0, firstSpace)).toLowerCase();
        const rawArgs = firstSpace === -1 ? '' : body.slice(firstSpace).trim();
        const args = rawArgs ? rawArgs.split(/\s+/) : [];

        const command = commandRegistry.get(commandName);
        if (!command) {
          results.push({
            command: cmdStr,
            success: false,
            outputs: [],
            error: `Unknown command "${commandName}".`,
            durationMs: Date.now() - startTime,
          });
          continue;
        }

        const outputs: string[] = [];
        const fakeSender: SenderIdentity = {
          jid: ownerJid,
          displayName: config.OWNER_NAME || 'Bot Owner',
          phoneNumber: ownerNumber,
          chatJid: defaultJid,
          fromMe: true,
        };

        const fakeMsg: any = {
          key: {
            remoteJid: defaultJid,
            fromMe: true,
            id: `DASH-${Date.now()}-${i}`,
            participant: ownerJid,
          },
          message: {
            conversation: `${prefix}${body}`,
          },
          messageTimestamp: Math.floor(Date.now() / 1000),
        };

        const ctx: BotContext = {
          socket: botSocket,
          message: fakeMsg,
          sender: fakeSender,
          args,
          rawArgs,
          reply: async (replyText: string) => {
            outputs.push(replyText);
            if (sendToChat && defaultJid && botSocket) {
              try {
                await botSocket.sendMessage(defaultJid, { text: replyText });
              } catch (sendErr) {
                logger.warn({ sendErr, targetJid: defaultJid }, 'Failed to mirror command output to WhatsApp');
              }
            }
          },
        };

        try {
          await command.execute(ctx);
          results.push({
            command: cmdStr,
            commandName,
            success: true,
            outputs,
            durationMs: Date.now() - startTime,
          });
        } catch (execErr: any) {
          results.push({
            command: cmdStr,
            commandName,
            success: false,
            outputs,
            error: execErr?.message || String(execErr),
            durationMs: Date.now() - startTime,
          });
        }
      }

      this.io.to('auth').emit('bot:activity', {
        type: 'commands:executed',
        count: results.length,
        timestamp: new Date().toISOString(),
      });

      res.json({
        success: true,
        results,
        total: results.length,
      });
    });

    // -------------------------------------------------------------------------
    // BROADCAST TOOL
    // -------------------------------------------------------------------------
    this.app.post('/api/broadcast', this.requireDashboardAuth.bind(this), async (req, res) => {
      const { jids, text, delayMs } = req.body || {};
      const targetJids: string[] = Array.isArray(jids) ? jids : [];
      if (!targetJids.length || !text?.trim()) {
        res.status(400).json({ success: false, error: 'Target JIDs and message text are required.' });
        return;
      }

      if (!botSocket) {
        res.status(503).json({ success: false, error: 'Bot is not connected.' });
        return;
      }

      const delay = Math.max(500, Math.min(Number(delayMs) || 1000, 10000));
      const results = [];

      for (let i = 0; i < targetJids.length; i++) {
        const jid = targetJids[i];
        if (i > 0) {
          await new Promise((r) => setTimeout(r, delay));
        }

        try {
          const sent = await botSocket.sendMessage(jid, { text: text.trim() });
          results.push({ jid, success: true, messageId: sent?.key.id });
        } catch (err: any) {
          results.push({ jid, success: false, error: err?.message || 'Send failed' });
        }
      }

      const succeeded = results.filter((r) => r.success).length;
      res.json({
        success: true,
        total: results.length,
        succeeded,
        failed: results.length - succeeded,
        results,
      });
    });

    // -------------------------------------------------------------------------
    // VIEW-ONCE & DELETED RECOVERY VAULT
    // -------------------------------------------------------------------------
    this.app.get('/api/vault/viewonce', this.requireDashboardAuth.bind(this), (req, res) => {
      try {
        const records = getAllViewOnceMessages();
        res.json({
          success: true,
          count: records.length,
          records: records.map((r) => ({
            chatJid: r.chatJid,
            messageId: r.messageId,
            senderName: r.senderName,
            senderNumber: r.senderNumber,
            messageType: r.messageType,
            text: r.text,
            timestamp: r.timestamp,
            deletedAt: r.deletedAt,
            hasMedia: Boolean(r.media),
            mediaKind: r.media?.kind,
            mediaSize: r.media?.size,
          })),
        });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message });
      }
    });

    this.app.get('/api/vault/deleted', this.requireDashboardAuth.bind(this), (req, res) => {
      try {
        const records = listAllDeletedMessages(100);
        res.json({
          success: true,
          count: records.length,
          records: records.map((r) => ({
            chatJid: r.chatJid,
            messageId: r.messageId,
            senderName: r.senderName,
            senderNumber: r.senderNumber,
            messageType: r.messageType,
            text: r.text,
            timestamp: r.timestamp,
            deletedAt: r.deletedAt,
            hasMedia: Boolean(r.media),
            mediaKind: r.media?.kind,
            mediaSize: r.media?.size,
          })),
        });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message });
      }
    });

    this.app.post('/api/vault/restore', this.requireDashboardAuth.bind(this), async (req, res) => {
      const { messageId, chatJid, targetJid } = req.body || {};
      if (!messageId) {
        res.status(400).json({ success: false, error: 'messageId is required.' });
        return;
      }
      if (!botSocket) {
        res.status(503).json({ success: false, error: 'Bot is not connected.' });
        return;
      }

      try {
        const stored = findStoredMessageById(chatJid || '', messageId);
        if (!stored) {
          res.status(404).json({ success: false, error: 'Message record not found in vault.' });
          return;
        }

        const buffer = await readDeletedMessageMedia(stored);
        const ownerNumber =
          config.OWNER_NUMBER?.replace(/\D/g, '') ||
          botSocket.user?.id?.split(':')[0]?.replace(/\D/g, '');
        const destination = targetJid || (ownerNumber ? `${ownerNumber}@s.whatsapp.net` : null);

        if (!destination) {
          res.status(400).json({ success: false, error: 'No target destination JID available.' });
          return;
        }

        const formatted = formatRecord(stored as DeletedMessageRecord, 1, true);

        if (buffer) {
          if (!stored.media) {
            stored.media = {
              kind: 'image',
              mimetype: 'image/jpeg',
              extension: 'jpg',
              fileName: `vo-${stored.messageId}.jpg`,
              size: buffer.length,
              viewOnce: true,
            };
          }

          const fakeCtx: any = {
            message: { key: { remoteJid: destination } },
            sender: { chatJid: destination },
            socket: botSocket,
            reply: (t: string) => botSocket!.sendMessage(destination, { text: t }),
          };

          await sendRecoveredMedia(fakeCtx, stored as DeletedMessageRecord, formatted);
          res.json({ success: true, message: `Media restored and sent to ${destination}` });
          return;
        }

        await botSocket.sendMessage(destination, {
          text: `${formatted}\n\n⚠️ Media bytes could not be retrieved from disk or cloud storage.`,
        });
        res.json({ success: true, message: `Metadata sent to ${destination} (media bytes unavailable).` });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message || 'Restore failed' });
      }
    });

    this.app.get('/api/vault/media/:messageId', this.requireDashboardAuth.bind(this), async (req, res) => {
      const messageId = String(req.params.messageId || '');
      const chatJid = String(req.query.chatJid || '');

      try {
        const stored = findStoredMessageById(chatJid, messageId);
        if (!stored) {
          res.status(404).send('Message record not found.');
          return;
        }

        const buffer = await readDeletedMessageMedia(stored);
        if (!buffer) {
          res.status(404).send('Media file buffer is not available.');
          return;
        }

        const mimetype = stored.media?.mimetype || 'application/octet-stream';
        res.setHeader('Content-Type', mimetype);
        res.setHeader('Content-Length', buffer.length);
        res.send(buffer);
      } catch (err: any) {
        res.status(500).send(err?.message || 'Error reading media buffer');
      }
    });

    this.app.use(express.static(path.join(process.cwd(), 'public')));
  }

  private recordOutgoingChatMessage(
    chatJid: string,
    messageId: string | undefined,
    text: string,
    type: string,
    quoted?: DashboardChatMessage['quoted']
  ) {
    if (!botSocket) return;
    const msgObj: DashboardChatMessage = {
      id: messageId || `sent-${Date.now()}`,
      chatJid,
      senderJid: botSocket.user?.id || '',
      senderName: botSocket.user?.name || 'Bot',
      senderNumber: botSocket.user?.id?.split(':')[0]?.replace(/\D/g, '') || '',
      fromMe: true,
      timestamp: new Date().toISOString(),
      text,
      type,
      quoted,
    };
    this.addMessageToStore(msgObj);
    this.io.to('auth').emit('chat:message', msgObj);
  }

  private setupSocketIO() {
    this.io.on('connection', (socket) => {
      const socketToken = socket.handshake.auth?.token || socket.handshake.query?.token;
      const authed =
        this.tokenMatches(socketToken) ||
        this.tokenMatches(this.cookieValue(socket.handshake.headers.cookie, 'dashboard_auth'));

      if (authed) socket.join('auth');

      socket.emit('status', this.getStatusPayload(authed));

      if (authed && this.authQR) {
        this.getAuthQRDataUrl()
          .then((qrDataUrl) => socket.emit('auth:qr', { qr: qrDataUrl }))
          .catch((err) => logger.error({ err }, 'Failed to send cached QR code'));
      }

      if (authed && this.pairingCode) {
        socket.emit('auth:pairing-code', { code: this.pairingCode });
      }

      socket.on('disconnect', () => {
        // Disconnected
      });
    });
  }

  private async processScheduledMessages(): Promise<void> {
    if (!botSocket || !this.scheduledMessages.length) return;
    const now = Date.now();
    const due = this.scheduledMessages.filter((m) => new Date(m.sendAt).getTime() <= now);
    if (!due.length) return;

    this.scheduledMessages = this.scheduledMessages.filter((m) => new Date(m.sendAt).getTime() > now);

    for (const item of due) {
      try {
        let mentions: string[] | undefined = undefined;
        if (item.chatJid.endsWith('@g.us') && (item.mentionAll || /\b@(everyone|all)\b/i.test(item.text))) {
          try {
            const meta = await this.fetchGroupMetadata(item.chatJid);
            mentions = meta.participants?.map((p: any) => p.id);
          } catch {}
        }

        const rawQuoted = item.quotedMessageId ? this.rawMessageMap.get(item.quotedMessageId) : undefined;
        const sent = await botSocket.sendMessage(
          item.chatJid,
          { text: item.text, mentions },
          this.chatSendOptions(item.chatJid, rawQuoted)
        );
        if (sent?.key.id) this.rawMessageMap.set(sent.key.id, sent);
        this.recordOutgoingChatMessage(item.chatJid, sent?.key.id || undefined, item.text, 'conversation');
      } catch (err) {
        logger.error({ err, item }, 'Failed to dispatch scheduled message');
      }
    }

    this.io.to('auth').emit('chat:scheduled-update', this.scheduledMessages);
  }

  async fetchGroupMetadata(jid: string, forceFresh: boolean = false): Promise<any> {
    if (!botSocket) {
      throw new Error('Bot is not connected to WhatsApp.');
    }

    const now = Date.now();
    const cached = this.groupMetadataCache.get(jid);
    if (!forceFresh && cached && now - cached.cachedAt < 60_000 && Array.isArray(cached.data?.participants)) {
      return cached.data;
    }

    // 1. Try direct groupMetadata(jid) query
    try {
      const meta = await botSocket.groupMetadata(jid);
      if (meta && Array.isArray(meta.participants)) {
        this.groupMetadataCache.set(jid, { data: meta, cachedAt: now });
        return meta;
      }
    } catch (err: any) {
      logger.warn({ err: err?.message || err, jid }, 'Direct groupMetadata query failed, attempting fallbacks');
    }

    // 2. Check if previous cache entry has participants
    if (cached && Array.isArray(cached.data?.participants) && cached.data.participants.length > 0) {
      logger.info({ jid }, 'Serving group metadata from previous cache entry');
      return cached.data;
    }

    // 3. Fallback: query all participating groups
    try {
      const allGroups = await botSocket.groupFetchAllParticipating();
      for (const [gId, gMeta] of Object.entries(allGroups)) {
        this.groupMetadataCache.set(gId, { data: gMeta, cachedAt: now });
      }
      const found = this.groupMetadataCache.get(jid)?.data || allGroups[jid];
      if (found && Array.isArray(found.participants)) {
        return found;
      }
    } catch (allErr: any) {
      logger.warn({ allErr: allErr?.message || allErr }, 'groupFetchAllParticipating fallback failed');
    }

    // 4. Return any cached entry if exists
    if (this.groupMetadataCache.has(jid)) {
      return this.groupMetadataCache.get(jid)!.data;
    }

    throw new Error('Could not retrieve group metadata from WhatsApp. The bot may have been removed or query timed out.');
  }

  start() {
    this.server.listen(this.port, () => {
      logger.info(`API server started on http://localhost:${this.port}`);
    });
  }

  stop() {
    if (this.scheduledTimer) {
      clearInterval(this.scheduledTimer);
      this.scheduledTimer = null;
    }
    this.server.close();
    this.io.close();
    void this.outboundQueue.close().catch((err) => logger.warn({ err }, 'Failed to close outbound queue'));
  }

  getIO(): SocketIOServer {
    return this.io;
  }
}

export let apiServer: ApiServer | null = null;

export function initApiServer(options?: ApiServerOptions): ApiServer {
  apiServer = new ApiServer(options);
  return apiServer;
}

export default ApiServer;
