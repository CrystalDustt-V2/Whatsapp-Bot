import type { WASocket } from '@whiskeysockets/baileys';
import cors from 'cors';
import crypto from 'crypto';
import express from 'express';
import http from 'http';
import path from 'path';
import qrcode from 'qrcode';
import { Server as SocketIOServer } from 'socket.io';
import { commandRegistry } from './command-registry';
import logger from './logger';
import config from '../config';
 
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

  private getStatusPayload() {
    return {
      status: botSocket ? 'connected' : 'disconnected',
      uptime: process.uptime(),
      commands: commandRegistry.getVisibleAll().length,
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

  private async getAuthQRDataUrl() {
    return qrcode.toDataURL(this.authQR!);
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
    return this.tokenMatches(req.query.token) ||
      this.tokenMatches(req.header('x-dashboard-token')) ||
      this.tokenMatches(this.cookieValue(req.header('cookie'), 'dashboard_auth'));
  }

  private requireDashboardAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (!config.DASHBOARD_AUTH_TOKEN) {
      res.status(403).send('DASHBOARD_AUTH_TOKEN is not configured.');
      return;
    }

    if (this.tokenMatches(req.query.token)) {
      res.setHeader('Set-Cookie', `dashboard_auth=${encodeURIComponent(String(req.query.token))}; HttpOnly; SameSite=Strict; Path=/`);
      res.redirect('/auth');
      return;
    }

    if (!this.isDashboardAuthorized(req)) {
      res.status(401).send('Private auth console. Open /auth?token=YOUR_TOKEN.');
      return;
    }

    next();
  }
 
  setBotSocket(socket: WASocket) {
    botSocket = socket;
    this.authQR = null;
    this.pairingCode = null;
    this.io.emit('bot:connected', this.getStatusPayload());
    this.io.emit('status', this.getStatusPayload());
  }

  clearBotSocket() {
    botSocket = null;
    this.io.emit('bot:disconnected', this.getStatusPayload());
    this.io.emit('status', this.getStatusPayload());
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
    this.app.use(express.json());
  }
 
  private setupRoutes() {
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
    });

    this.app.get('/auth', this.requireDashboardAuth.bind(this), (req, res) => {
      res.sendFile(path.join(process.cwd(), 'public', 'auth.html'));
    });

    this.app.get('/auth.html', this.requireDashboardAuth.bind(this), (req, res) => {
      res.sendFile(path.join(process.cwd(), 'public', 'auth.html'));
    });

    this.app.get('/auth/logout', (req, res) => {
      res.setHeader('Set-Cookie', 'dashboard_auth=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
      res.redirect('/');
    });
 
    this.app.get('/api/status', (req, res) => {
      res.json(this.getStatusPayload());
    });

    this.app.get('/api/public-config', (req, res) => {
      res.json(this.getPublicConfigPayload());
    });

    this.app.get('/healthz', (req, res) => {
      res.json({
        ok: true,
        ...this.getStatusPayload(),
      });
    });
 
    this.app.get('/api/commands', (req, res) => {
      res.json({ 
        commands: commandRegistry.getVisibleAll().map(cmd => ({ 
          name: cmd.name, 
          category: cmd.category, 
          description: cmd.description, 
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

    this.app.use(express.static(path.join(process.cwd(), 'public')));
  }
 
  private setupSocketIO() {
    this.io.on('connection', (socket) => {
      logger.info(`Socket connected: ${socket.id}`);
      const socketToken = socket.handshake.auth?.token || socket.handshake.query?.token;
      const authed = this.tokenMatches(socketToken) || this.tokenMatches(this.cookieValue(socket.handshake.headers.cookie, 'dashboard_auth'));
      if (authed) socket.join('auth');
 
      socket.emit('status', this.getStatusPayload());

      if (authed && this.authQR) {
        this.getAuthQRDataUrl()
          .then((qrDataUrl) => socket.emit('auth:qr', { qr: qrDataUrl }))
          .catch((err) => logger.error({ err }, 'Failed to send cached QR code'));
      }

      if (authed && this.pairingCode) {
        socket.emit('auth:pairing-code', { code: this.pairingCode });
      }
 
      socket.on('disconnect', () => {
        logger.info(`Socket disconnected: ${socket.id}`);
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
