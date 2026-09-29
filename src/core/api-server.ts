import type { GroupMetadata, WAMessage, WASocket } from '@whiskeysockets/baileys';
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
import { getSenderIdentity } from '../services/message-memory';
import { sendRecoveredMedia, formatRecord } from '../commands/utility/deleted';

interface ApiServerOptions {
  port?: number;
}

export interface DashboardChatMessage {
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

  // Queue on mute: groupJid -> queued messages waiting for announce: false
  private queuedGroupMessages = new Map<string, Array<{ text: string; queuedAt: string }>>();

  // Raw WAMessage cache for authentic quoted replies
  private rawMessageMap = new Map<string, WAMessage>();

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
  }

  // ---------------------------------------------------------------------------
  // LIVE MESSAGE INGESTION FROM BAILEYS
  // ---------------------------------------------------------------------------
  handleIncomingMessage(msg: WAMessage): void {
    const chatJid = msg.key.remoteJid;
    if (!chatJid || !botSocket) return;

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

  handleGroupsUpdate(updates: Partial<GroupMetadata>[]): void {
    for (const update of updates) {
      if (update.id && update.announce === false) {
        // Group was unmuted / opened to all members! Drain queue if any
        const queued = this.queuedGroupMessages.get(update.id);
        if (queued && queued.length && botSocket) {
          logger.info({ groupJid: update.id, count: queued.length }, 'Group unmuted! Draining queued messages');
          this.queuedGroupMessages.delete(update.id);
          for (const item of queued) {
            botSocket.sendMessage(update.id, { text: item.text }).catch((err) => {
              logger.warn({ err, groupJid: update.id }, 'Failed to deliver queued message upon unlock');
            });
          }
          this.io.to('auth').emit('bot:activity', {
            type: 'queue:drained',
            groupJid: update.id,
            count: queued.length,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }
  }

  private addMessageToStore(chatMsg: DashboardChatMessage): void {
    const list = this.liveMessageStore.get(chatMsg.chatJid) || [];
    const existingIndex = list.findIndex((m) => m.id === chatMsg.id);
    if (existingIndex >= 0) {
      list[existingIndex] = { ...list[existingIndex], ...chatMsg };
    } else {
      list.push(chatMsg);
      if (list.length > 100) list.shift();
    }
    this.liveMessageStore.set(chatMsg.chatJid, list);
  }

  private parseWAMessage(msg: WAMessage, socket: WASocket): DashboardChatMessage | null {
    const chatJid = msg.key.remoteJid;
    if (!chatJid) return null;

    const sender = getSenderIdentity(msg, socket);
    const unwrapped = unwrapMessageInfo(msg.message);
    const innerMsg = unwrapped.message;

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
            const me = meta.participants?.find((p) => {
              const pNum = p.id?.replace(/\D/g, '');
              return (myPn && pNum?.includes(myPn)) || (myLid && pNum?.includes(myLid));
            });
            const isBotAdmin = Boolean(me?.admin);

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
            });
          }
        } catch (groupErr: any) {
          logger.warn({ groupErr }, 'Could not fetch all participating groups');
        }

        const directChatsMap = new Map<string, any>();

        const contactsPath = path.join(config.SESSION_PATH, 'contacts.json');
        if (fs.existsSync(contactsPath)) {
          try {
            const saved = JSON.parse(fs.readFileSync(contactsPath, 'utf8'));
            for (const [jid, contact] of Object.entries(saved as Record<string, any>)) {
              if (jid.endsWith('@g.us') || jid.endsWith('@newsletter')) continue;
              directChatsMap.set(jid, {
                id: jid,
                name: contact.displayName || contact.profileName || contact.phoneNumber || jid,
                phoneNumber: contact.phoneNumber || jid.replace(/\D/g, ''),
                isGroup: false,
                lastActive: contact.updatedAt || '',
              });
            }
          } catch {}
        }

        const deletedChats = listDeletedChats();
        for (const item of deletedChats) {
          if (item.chatJid.endsWith('@g.us') || directChatsMap.has(item.chatJid)) continue;
          directChatsMap.set(item.chatJid, {
            id: item.chatJid,
            name: item.lastSenderName || item.chatJid,
            phoneNumber: item.chatJid.replace(/\D/g, ''),
            isGroup: false,
            lastActive: item.lastDeletedAt,
          });
        }

        groups.sort((a, b) => a.name.localeCompare(b.name));
        const directChats = Array.from(directChatsMap.values()).sort((a, b) =>
          (b.lastActive || '').localeCompare(a.lastActive || '')
        );

        res.json({
          success: true,
          groups,
          directChats,
          totalGroups: groups.length,
          totalDirect: directChats.length,
        });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message || 'Failed to fetch chats' });
      }
    });

    // -------------------------------------------------------------------------
    // CHAT MESSAGE HISTORY API (READ REAL MESSAGES)
    // -------------------------------------------------------------------------
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
          const meta = await botSocket.groupMetadata(jid);
          const myPn = botSocket.user?.id?.split(':')[0]?.replace(/\D/g, '');
          const myLid = botSocket.user?.lid?.split(':')[0]?.replace(/\D/g, '');
          const me = meta.participants?.find((p) => {
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
              participants: meta.participants?.map((p) => ({
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
      const { jid, text, bypassAdminOnly, queueOnUnlock, queueOnMute, quotedMessageId } = req.body || {};
      if (!jid || !text?.trim()) {
        res.status(400).json({ success: false, error: 'JID and text are required.' });
        return;
      }

      if (!botSocket) {
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

        if (isGroup) {
          try {
            const meta = await botSocket.groupMetadata(jid);
            const isAnnounce = Boolean(meta.announce);
            const myPn = botSocket.user?.id?.split(':')[0]?.replace(/\D/g, '');
            const myLid = botSocket.user?.lid?.split(':')[0]?.replace(/\D/g, '');
            const me = meta.participants?.find((p) => {
              const pNum = p.id?.replace(/\D/g, '');
              return (myPn && pNum?.includes(myPn)) || (myLid && pNum?.includes(myLid));
            });
            const isBotAdmin = Boolean(me?.admin);

            if (isAnnounce && !isBotAdmin) {
              if (shouldQueue) {
                const list = this.queuedGroupMessages.get(jid) || [];
                list.push({ text: text.trim(), queuedAt: new Date().toISOString() });
                this.queuedGroupMessages.set(jid, list);
                res.json({
                  success: true,
                  queued: true,
                  note: 'Message queued! It will automatically dispatch as soon as the group is unmuted by admins.',
                });
                return;
              }

              try {
                const sent = await botSocket.sendMessage(
                  jid,
                  { text: text.trim() },
                  rawQuoted ? { quoted: rawQuoted } : undefined
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
                    { text: text.trim() },
                    rawQuoted ? { quoted: rawQuoted } : undefined
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
                    { text: text.trim() },
                    rawQuoted ? { quoted: rawQuoted } : undefined
                  );
                  if (sent?.key.id) this.rawMessageMap.set(sent.key.id, sent);
                  this.recordOutgoingChatMessage(jid, sent?.key.id || undefined, text.trim(), 'conversation', quotedContext);
                  res.json({ success: true, messageId: sent?.key.id, note: 'Sent directly using bot Admin privileges.' });
                  return;
                }
              } else {
                const sent = await botSocket.sendMessage(
                  jid,
                  { text: text.trim() },
                  rawQuoted ? { quoted: rawQuoted } : undefined
                );
                if (sent?.key.id) this.rawMessageMap.set(sent.key.id, sent);
                this.recordOutgoingChatMessage(jid, sent?.key.id || undefined, text.trim(), 'conversation', quotedContext);
                res.json({ success: true, messageId: sent?.key.id, note: 'Sent directly using bot Admin privileges.' });
                return;
              }
            }
          } catch (metaErr) {
            logger.debug({ metaErr, jid }, 'Metadata check skipped before send');
          }
        }

        const sent = await botSocket.sendMessage(
          jid,
          { text: text.trim() },
          rawQuoted ? { quoted: rawQuoted } : undefined
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

        const sendOpts = rawQuoted ? { quoted: rawQuoted } : undefined;

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
        this.addMessageToStore(msgObj);
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
        });

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
        this.addMessageToStore(msgObj);
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
        });

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
        this.addMessageToStore(msgObj);
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
        });

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
        this.addMessageToStore(msgObj);
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
        await botSocket.sendMessage(jid, {
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

        this.io.to('auth').emit('chat:reaction', {
          chatJid: jid,
          messageId,
          emoji: emoji || '',
        });

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
          const meta = await botSocket.groupMetadata(jid);
          const myPn = botSocket.user?.id?.split(':')[0]?.replace(/\D/g, '');
          const myLid = botSocket.user?.lid?.split(':')[0]?.replace(/\D/g, '');
          const me = meta.participants?.find((p) => {
            const pNum = p.id?.replace(/\D/g, '');
            return (myPn && pNum?.includes(myPn)) || (myLid && pNum?.includes(myLid));
          });
          const isBotAdmin = Boolean(me?.admin);

          let inviteCode: string | null = null;
          if (isBotAdmin) {
            try {
              inviteCode = (await botSocket.groupInviteCode(jid)) || null;
            } catch {}
          }

          res.json({
            success: true,
            isGroup: true,
            id: meta.id,
            subject: meta.subject,
            owner: meta.owner,
            creation: meta.creation,
            desc: meta.desc?.toString() || '',
            participantsCount: meta.participants?.length || 0,
            isAnnounce: Boolean(meta.announce),
            isRestrict: Boolean(meta.restrict),
            isBotAdmin,
            botAdminRole: me?.admin || null,
            inviteCode,
            inviteLink: inviteCode ? `https://chat.whatsapp.com/${inviteCode}` : null,
            participants: (meta.participants || []).map((p) => ({
              id: p.id,
              phoneNumber: p.id.split('@')[0].replace(/\D/g, ''),
              admin: p.admin || null,
              isSuperAdmin: p.admin === 'superadmin',
              isAdmin: Boolean(p.admin),
            })),
          });
        } else {
          res.json({
            success: true,
            isGroup: false,
            id: jid,
            phoneNumber: jid.split('@')[0].replace(/\D/g, ''),
          });
        }
      } catch (err: any) {
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
          rawQuoted ? { quoted: rawQuoted } : undefined
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
        this.addMessageToStore(msgObj);
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

  start() {
    this.server.listen(this.port, () => {
      logger.info(`API server started on http://localhost:${this.port}`);
    });
  }

  stop() {
    this.server.close();
    this.io.close();
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
