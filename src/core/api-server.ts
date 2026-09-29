import type { WASocket } from '@whiskeysockets/baileys';
import cors from 'cors';
import crypto from 'crypto';
import express from 'express';
import http from 'http';
import path from 'path';
import * as fs from 'fs';
import qrcode from 'qrcode';
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
  type DeletedMessageRecord,
} from '../services/deleted-message-recovery';
import { sendRecoveredMedia, formatRecord } from '../commands/utility/deleted';

interface ApiServerOptions {
  port?: number;
}

let botSocket: WASocket | null = null;

export class ApiServer {
  private app: express.Application;
  private server: http.Server;
  private io: SocketIOServer;
  private port: number;
  private authQR: string | null = null;
  private pairingCode: string | null = null;

  constructor(options: ApiServerOptions = {}) {
    this.port = options.port || 3001;
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = new SocketIOServer(this.server, {
      cors: {
        origin: '*',
      },
    });

    this.setupMiddleware();
    this.setupRoutes();
    this.setupSocketIO();
  }

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
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));
  }

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
    // ADMIN DASHBOARD: CHATS & GROUPS API
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
    // ADMIN DASHBOARD: SEND CHAT (WITH ADMIN-ONLY GROUP BYPASS / DISPATCH)
    // -------------------------------------------------------------------------
    this.app.post('/api/chats/send', this.requireDashboardAuth.bind(this), async (req, res) => {
      const { jid, text, bypassAdminOnly } = req.body || {};
      if (!jid || !text?.trim()) {
        res.status(400).json({ success: false, error: 'JID and text are required.' });
        return;
      }

      if (!botSocket) {
        res.status(503).json({ success: false, error: 'Bot is not connected to WhatsApp.' });
        return;
      }

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
              try {
                const sent = await botSocket.sendMessage(jid, { text: text.trim() });
                this.io.to('auth').emit('bot:activity', {
                  type: 'chat:send',
                  jid,
                  text: text.trim(),
                  timestamp: new Date().toISOString(),
                });
                res.json({ success: true, messageId: sent?.key.id, note: 'Sent as group member.' });
                return;
              } catch (sendErr: any) {
                res.status(403).json({
                  success: false,
                  error: 'This group is restricted to Admins only and this bot is not an admin. Promote the bot to admin in this group to send messages.',
                });
                return;
              }
            }

            if (isAnnounce && isBotAdmin) {
              if (bypassAdminOnly) {
                try {
                  await botSocket.groupSettingUpdate(jid, 'not_announcement');
                  const sent = await botSocket.sendMessage(jid, { text: text.trim() });
                  await botSocket.groupSettingUpdate(jid, 'announcement');
                  bypassed = true;
                  note = 'Bypassed admin-only mode (temporarily unlocked group, sent message, and re-locked).';
                  this.io.to('auth').emit('bot:activity', {
                    type: 'chat:send',
                    jid,
                    text: text.trim(),
                    bypassed: true,
                    timestamp: new Date().toISOString(),
                  });
                  res.json({ success: true, messageId: sent?.key.id, bypassed, note });
                  return;
                } catch (toggleErr) {
                  const sent = await botSocket.sendMessage(jid, { text: text.trim() });
                  res.json({ success: true, messageId: sent?.key.id, note: 'Sent directly using bot Admin privileges.' });
                  return;
                }
              } else {
                const sent = await botSocket.sendMessage(jid, { text: text.trim() });
                res.json({ success: true, messageId: sent?.key.id, note: 'Sent directly using bot Admin privileges.' });
                return;
              }
            }
          } catch (metaErr) {
            logger.debug({ metaErr, jid }, 'Metadata check skipped before send');
          }
        }

        const sent = await botSocket.sendMessage(jid, { text: text.trim() });
        this.io.to('auth').emit('bot:activity', {
          type: 'chat:send',
          jid,
          text: text.trim(),
          timestamp: new Date().toISOString(),
        });

        res.json({ success: true, messageId: sent?.key.id, note });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message || 'Failed to send message.' });
      }
    });

    // -------------------------------------------------------------------------
    // ADMIN DASHBOARD: MULTI-COMMAND EXECUTION RUNNER
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
    // ADMIN DASHBOARD: BROADCAST API
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
    // ADMIN DASHBOARD: VIEW-ONCE & DELETED RECOVERY VAULT API
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
