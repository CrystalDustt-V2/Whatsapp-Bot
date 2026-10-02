import {
  Browsers,
  default as makeWASocket,
  AuthenticationState,
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
  onPairingCode?: (code: string) => Promise<void>;
  onConnected?: (socket: WASocket) => Promise<void>;
  onDisconnected?: (reason?: DisconnectReason) => Promise<void>;
}

export class ConnectionManager {
  private socket: WASocket | null = null;
  private options: ConnectionManagerOptions;
  private retryCount: number = 0;
  private readonly maxRetries: number = 10;
  private pairingCodeRequested = false;

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

  private async requestPairingCodeIfNeeded(state: AuthenticationState, saveCreds: () => Promise<void>): Promise<void> {
    const phoneNumber = config.AUTH_PHONE_NUMBER?.replace(/\D/g, '');
    if (!this.socket || !phoneNumber || state.creds.registered || this.pairingCodeRequested) return;

    this.pairingCodeRequested = true;

    try {
      const code = await this.socket.requestPairingCode(phoneNumber);
      logger.info(`Pairing code: ${code}`);
      await this.options.onPairingCode?.(code);
    } catch (err) {
      if (!state.creds.registered && state.creds.me?.id === `${phoneNumber}@s.whatsapp.net`) {
        state.creds.me = undefined;
        state.creds.pairingCode = undefined;
        await saveCreds();
      }

      this.pairingCodeRequested = false;
      logger.error({ err }, 'Failed to request pairing code');
    }
  }

  private async clearStalePairingCreds(state: AuthenticationState, saveCreds: () => Promise<void>): Promise<void> {
    const phoneNumber = config.AUTH_PHONE_NUMBER?.replace(/\D/g, '');
    if (!phoneNumber || state.creds.registered || state.creds.me?.id !== `${phoneNumber}@s.whatsapp.net`) return;

    state.creds.me = undefined;
    state.creds.pairingCode = undefined;
    await saveCreds();
  }

  purgeSessionAuthFiles(): void {
    const sessionDir = this.options.sessionPath!;
    try {
      if (fs.existsSync(sessionDir)) {
        const files = fs.readdirSync(sessionDir);
        for (const file of files) {
          if (
            file === 'creds.json' ||
            file.startsWith('app-state-sync-') ||
            file.startsWith('pre-key-') ||
            file.startsWith('session-') ||
            file.startsWith('sender-key-')
          ) {
            const filePath = path.join(sessionDir, file);
            try {
              fs.rmSync(filePath, { recursive: true, force: true });
            } catch (e) {
              logger.warn({ filePath, err: e }, 'Failed to remove session auth file');
            }
          }
        }
        logger.info('Purged stale session credentials');
      }
    } catch (err) {
      logger.error({ err }, 'Failed to purge session directory');
    }
  }

  async resetSession(): Promise<void> {
    logger.info('Resetting WhatsApp session requested...');
    this.disconnect();
    this.purgeSessionAuthFiles();
    this.retryCount = 0;
    this.pairingCodeRequested = false;
    await this.connect();
  }

  async connect(): Promise<WASocket> {
    const { state, saveCreds } = await useMultiFileAuthState(
      this.options.sessionPath!
    );
    await this.clearStalePairingCreds(state, saveCreds);

    const { version, isLatest, error } = await fetchLatestWaWebVersion({});

    if (error) {
      logger.warn({ err: error }, 'Could not fetch latest WhatsApp Web version, using bundled Baileys version');
    } else {
      logger.info({ version, isLatest }, 'Using WhatsApp Web version');
    }

    this.socket = makeWASocket({
      auth: state,
      version,
      browser: Browsers.ubuntu('Chrome'),
      syncFullHistory: true,
      markOnlineOnConnect: false,
      qrTimeout: 60000,
      generateHighQualityLinkPreview: false,
      appStateMacVerification: {
        patch: false,
        snapshot: false,
      },
      shouldIgnoreJid: (jid) => Boolean(jid && config.IGNORE_NEWSLETTER_MESSAGES && jid.endsWith('@newsletter')),
    });

    this.socket.ev.on('creds.update', saveCreds);

    this.socket.ev.on('connection.update', async (update) => {
      const { connection, qr } = update;

      if (qr) {
        try {
          if (config.AUTH_PHONE_NUMBER) {
            await this.requestPairingCodeIfNeeded(state, saveCreds);
          } else if (this.options.onQR) {
            const qrString = await qrcode.toString(qr, { type: 'terminal' });
            logger.info('QR Code received:');
            console.log(qrString);
            await this.options.onQR(qr);
          }
        } catch (err) {
          logger.error({ err }, 'Failed to handle auth QR');
        }
      }

      if (connection === 'close') {
        const reason = new Boom(update.lastDisconnect?.error as Error)
          ?.output?.statusCode;
        const isLoggedOut = reason === DisconnectReason.loggedOut || reason === 401;

        if (this.options.onDisconnected) {
          await this.options.onDisconnected(reason);
        }

        if (isLoggedOut) {
          logger.warn('WhatsApp session was logged out / revoked (401). Purging stale auth and generating fresh QR / pairing code...');
          this.purgeSessionAuthFiles();
          this.retryCount = 0;
          this.pairingCodeRequested = false;
          setTimeout(() => this.connect(), 1000);
          return;
        }

        this.retryCount++;
        
        if (this.retryCount > this.maxRetries) {
          logger.error('Maximum retries reached. Purging stale auth and restarting pairing flow...');
          this.purgeSessionAuthFiles();
          this.retryCount = 0;
          this.pairingCodeRequested = false;
          setTimeout(() => this.connect(), 2000);
          return;
        }

        const delay = this.getRetryDelay(reason);
        const delayMinutes = (delay / 60000).toFixed(1);
        
        logger.info(
          { reason, attempt: this.retryCount, max: this.maxRetries },
          `Reconnecting in ${delayMinutes} minutes... (Attempt ${this.retryCount}/${this.maxRetries})`
        );
        
        setTimeout(() => this.connect(), delay);
      } else if (connection === 'open') {
        this.retryCount = 0;
        this.pairingCodeRequested = false;
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
