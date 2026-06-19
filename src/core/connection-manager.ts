import {
  Browsers,
  default as makeWASocket,
  DisconnectReason,
  fetchLatestWaWebVersion,
  useMultiFileAuthState,
  WASocket,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode';
import logger from './logger';
import config from '../config';
import * as fs from 'fs';
import * as path from 'path';

interface ConnectionManagerOptions {
  sessionPath?: string;
  onQR?: (qr: string) => Promise<void>;
  onConnected?: (socket: WASocket) => Promise<void>;
  onDisconnected?: (reason?: DisconnectReason) => Promise<void>;
}

export class ConnectionManager {
  private socket: WASocket | null = null;
  private options: ConnectionManagerOptions;
  private retryCount: number = 0;
  private readonly maxRetries: number = 10;

  constructor(options: ConnectionManagerOptions = {}) {
    this.options = {
      sessionPath: config.SESSION_PATH,
      ...options,
    };

    if (!fs.existsSync(this.options.sessionPath!)) {
      fs.mkdirSync(this.options.sessionPath!, { recursive: true });
    }
  }

  private getRetryDelay(reason?: number): number {
    if (reason === 405) {
      const baseDelay = 60000;
      const exponentialDelay = baseDelay * Math.pow(1.5, Math.min(this.retryCount, 5));
      return Math.min(exponentialDelay, 300000);
    }
    return 5000;
  }

  async connect(): Promise<WASocket> {
    const { state, saveCreds } = await useMultiFileAuthState(
      this.options.sessionPath!
    );
    const { version, isLatest, error } = await fetchLatestWaWebVersion({});

    if (error) {
      logger.warn({ err: error }, 'Could not fetch latest WhatsApp Web version, using bundled Baileys version');
    } else {
      logger.info({ version, isLatest }, 'Using WhatsApp Web version');
    }

    this.socket = makeWASocket({
      auth: state,
      version,
      browser: Browsers.macOS('Chrome'),
      markOnlineOnConnect: false,
      qrTimeout: 60000,
    });

    this.socket.ev.on('creds.update', saveCreds);

    this.socket.ev.on('connection.update', async (update) => {
      const { connection, qr } = update;

      if (qr && this.options.onQR) {
        try {
          const qrString = await qrcode.toString(qr, { type: 'terminal' });
          logger.info('QR Code received:');
          console.log(qrString);
          await this.options.onQR(qr);
        } catch (err) {
          logger.error({ err }, 'Failed to generate QR code');
        }
      }

      if (connection === 'close') {
        const reason = new Boom(update.lastDisconnect?.error as Error)
          ?.output?.statusCode;

        if (this.options.onDisconnected) {
          await this.options.onDisconnected(reason);
        }

        if (reason !== DisconnectReason.loggedOut) {
          this.retryCount++;
          
          if (this.retryCount > this.maxRetries) {
            logger.error('Maximum retries reached. Please delete sessions folder and try again later.');
            process.exit(1);
          }

          const delay = this.getRetryDelay(reason);
          const delayMinutes = (delay / 60000).toFixed(1);
          
          logger.info(
            { reason, attempt: this.retryCount, max: this.maxRetries },
            `Reconnecting in ${delayMinutes} minutes... (Attempt ${this.retryCount}/${this.maxRetries})`
          );
          
          setTimeout(() => this.connect(), delay);
        } else {
          logger.error('Logged out, please delete session folder and restart');
        }
      } else if (connection === 'open') {
        this.retryCount = 0;
        logger.info('Connected to WhatsApp');
        if (this.options.onConnected && this.socket) {
          await this.options.onConnected(this.socket);
        }
      }
    });

    return this.socket;
  }

  getSocket(): WASocket | null {
    return this.socket;
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.end(undefined);
      this.socket = null;
    }
  }
}

export default ConnectionManager;
