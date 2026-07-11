import qrcode from 'qrcode';
import loadCommands from './commands';
import config from './config';
import { initApiServer } from './core/api-server';
import { ConnectionManager } from './core/connection-manager';
import logger from './core/logger';
import { MessageHandler } from './core/message-handler';

async function main() {
  logger.info('Starting WhatsApp Hybrid Bot...');

  loadCommands();

  const apiServer = initApiServer({ port: config.PORT });
  apiServer.start();

  logger.info('');
  logger.info('╔══════════════════════════════════════════════════════════╗');
  logger.info('║     📱 WhatsApp Hybrid Bot - Web Auth Interface            ║');
  logger.info('╠══════════════════════════════════════════════════════════╣');
  logger.info('║  Open your browser and visit:                             ║');
  logger.info(`║  \x1b[36mhttp://localhost:${config.PORT}\x1b[0m                                      ║`);
  logger.info('║                                                           ║');
  logger.info('║  Or scan the QR code that will appear below...           ║');
  logger.info('╚══════════════════════════════════════════════════════════╝');
  logger.info('');

  const connectionManager = new ConnectionManager({
    async onQR(qr) {
      logger.info('QR Code received!');
      logger.info('');

      try {
        const qrTerminal = await qrcode.toString(qr, { type: 'terminal' });
        console.log(qrTerminal);
      } catch (err) {
        logger.warn('Could not generate terminal QR, using web interface instead');
      }

      logger.info('');
      logger.info(`📱 Scan with WhatsApp or open http://localhost:${config.PORT}`);
      apiServer.setAuthQR(qr);
    },
    async onPairingCode(code) {
      logger.info(`Link with phone number code: ${code}`);
      apiServer.setPairingCode(code);
    },
    async onConnected(socket) {
      logger.info('');
      logger.info('╔══════════════════════════════════════════════════════════╗');
      logger.info('║                   ✅ Bot Connected!                       ║');
      logger.info('╠══════════════════════════════════════════════════════════╣');
      logger.info('║  Your WhatsApp account is now connected!                  ║');
      logger.info('║  Use commands starting with . (dot)                       ║');
      logger.info('╚══════════════════════════════════════════════════════════╝');
      logger.info('');

      apiServer.setBotSocket(socket);

      const messageHandler = new MessageHandler(socket);

      socket.ev.on('messages.upsert', async (m) => {
        const messages = m.messages;
        if (!messages || m.type !== 'notify') return;

        for (const msg of messages) {
          const fromMe = Boolean(msg.key.fromMe);
          const shouldHandle = fromMe
            ? config.HANDLE_SELF_MESSAGES
            : config.HANDLE_INCOMING_MESSAGES;

          if (!shouldHandle) {
            logger.info(
              { fromMe, remoteJid: msg.key.remoteJid, messageId: msg.key.id },
              'Skipping message because this direction is disabled'
            );
            continue;
          }

          await messageHandler.handleMessage(msg);
        }
      });

      socket.ev.on('messages.update', async (updates) => {
        for (const update of updates) {
          await messageHandler.handleMessageUpdate(update);
        }
      });

      socket.ev.on('messages.delete', async (update) => {
        await messageHandler.handleMessageDelete(update);
      });
    },
    async onDisconnected() {
      apiServer.clearBotSocket();
    },
  });

  await connectionManager.connect();
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start bot');
  process.exit(1);
});
