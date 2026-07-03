import type { WASocket } from '@whiskeysockets/baileys';
import cors from 'cors';
import express from 'express';
import http from 'http';
import path from 'path';
import qrcode from 'qrcode';
import { Server as SocketIOServer } from 'socket.io';
import { commandRegistry } from './command-registry';
import logger from './logger';
 
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
      commands: commandRegistry.getAll().length,
    };
  }

  private async getAuthQRDataUrl() {
    return qrcode.toDataURL(this.authQR!);
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
    this.io.emit('auth:qr', { qr: qrDataUrl });
  }

  setPairingCode(code: string) {
    this.pairingCode = code;
    this.io.emit('auth:pairing-code', { code });
  }
 
  private setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.static(path.join(process.cwd(), 'public')));
  }
 
  private setupRoutes() {
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
    });
 
    this.app.get('/api/status', (req, res) => {
      res.json(this.getStatusPayload());
    });

    this.app.get('/healthz', (req, res) => {
      res.json({
        ok: true,
        ...this.getStatusPayload(),
      });
    });
 
    this.app.get('/api/commands', (req, res) => {
      res.json({ 
        commands: commandRegistry.getAll().map(cmd => ({ 
          name: cmd.name, 
          category: cmd.category, 
          description: cmd.description, 
        })), 
      });
    });
 
    this.app.get('/api/auth/qr', async (req, res) => {
      if (!this.authQR) {
        return res.status(404).json({ error: 'QR not available' });
      }
 
      const qrDataUrl = await this.getAuthQRDataUrl();
      res.json({ qr: qrDataUrl });
    });

    this.app.get('/api/auth/pairing-code', (req, res) => {
      if (!this.pairingCode) {
        return res.status(404).json({ error: 'Pairing code not available' });
      }

      res.json({ code: this.pairingCode });
    });
  }
 
  private setupSocketIO() {
    this.io.on('connection', (socket) => {
      logger.info(`Socket connected: ${socket.id}`);
 
      socket.emit('status', this.getStatusPayload());

      if (this.authQR) {
        this.getAuthQRDataUrl()
          .then((qrDataUrl) => socket.emit('auth:qr', { qr: qrDataUrl }))
          .catch((err) => logger.error({ err }, 'Failed to send cached QR code'));
      }

      if (this.pairingCode) {
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
