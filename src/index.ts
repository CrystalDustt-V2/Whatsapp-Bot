// Suppress noisy raw console logs from libsignal-node
const rawConsoleInfo = console.info.bind(console);
console.info = (...args: any[]) => {
  if (
    typeof args[0] === 'string' &&
    (args[0].startsWith('Closing session:') ||
      args[0].startsWith('Removing old closed session:') ||
      args[0].startsWith('Opening session:') ||
      args[0].includes('closed session'))
  ) {
    return;
  }
  rawConsoleInfo(...args);
};

const rawConsoleWarn = console.warn.bind(console);
console.warn = (...args: any[]) => {
  if (
    typeof args[0] === 'string' &&
    (args[0].startsWith('Session already closed') ||
      args[0].startsWith('Session already open'))
  ) {
    return;
  }
  rawConsoleWarn(...args);
};

import qrcode from 'qrcode';
import loadCommands from './commands';
import config from './config';
import { initApiServer } from './core/api-server';
import { ConnectionManager } from './core/connection-manager';
import logger from './core/logger';
import { MessageHandler } from './core/message-handler';
import { syncContacts, triggerFullContactSync } from './services/message-memory';

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

      // Trigger automatic comprehensive contact sync from primary phone in the background
      triggerFullContactSync(socket)
        .then((res) => {
          logger.info({ count: res.count }, 'Startup primary phone contact sync finished');
          apiServer.handleContactsSync([]);
        })
        .catch((err) => {
          logger.debug({ err }, 'Background contact sync encountered error');
        });

      const messageHandler = new MessageHandler(socket);

      socket.ev.on('messages.upsert', async (m) => {
        const messages = m.messages;
        if (!messages) return;

        if (config.DELETED_MESSAGE_DEBUG) {
          logger.info(
            {
              type: m.type,
              count: messages.length,
              messageTypes: messages.map((msg) => Object.keys(msg.message || {})[0] || 'none'),
            },
            'Received message upsert batch'
          );
        }

        for (const msg of messages) {
          // Ingest all messages into admin dashboard live buffer & stream
          try {
            apiServer.handleIncomingMessage(msg);
          } catch (dashErr) {
            logger.debug({ dashErr }, 'Failed to pass message to dashboard');
          }

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

      socket.ev.on('groups.update', (updates) => {
        try {
          apiServer.handleGroupsUpdate(updates);
        } catch (grpErr) {
          logger.debug({ grpErr }, 'Failed to handle groups update in dashboard');
        }
      });

      socket.ev.on('contacts.upsert', (newContacts) => {
        try {
          syncContacts(newContacts);
          apiServer.handleContactsSync(newContacts);
        } catch (cErr) {
          logger.debug({ cErr }, 'Failed to sync contacts upsert');
        }
      });

      socket.ev.on('contacts.update', (updates) => {
        try {
          syncContacts(updates as any);
          apiServer.handleContactsSync(updates as any);
        } catch (cErr) {
          logger.debug({ cErr }, 'Failed to sync contacts update');
        }
      });

      socket.ev.on('messaging-history.set', ({ contacts, chats }) => {
        try {
          if (contacts && contacts.length) {
            syncContacts(contacts);
          }
          if (chats && chats.length) {
            const direct = chats
              .filter((ch) => ch.id && !ch.id.endsWith('@g.us') && !ch.id.endsWith('@newsletter') && (ch as any).name)
              .map((ch) => ({ id: ch.id, name: (ch as any).name }));
            if (direct.length) syncContacts(direct);
          }
          apiServer.handleContactsSync(contacts || []);
        } catch (cErr) {
          logger.debug({ cErr }, 'Failed to sync messaging-history contacts');
        }
      });

      socket.ev.on('chats.upsert', (newChats) => {
        try {
          const direct = newChats
            .filter((ch) => ch.id && !ch.id.endsWith('@g.us') && !ch.id.endsWith('@newsletter') && (ch as any).name)
            .map((ch) => ({ id: ch.id, name: (ch as any).name }));
          if (direct.length) {
            syncContacts(direct);
            apiServer.handleContactsSync(direct);
          }
        } catch (chErr) {
          logger.debug({ chErr }, 'Failed to sync direct chats upsert names');
        }
      });

      socket.ev.on('chats.update', (updates) => {
        try {
          const direct = updates
            .filter((ch) => ch.id && !ch.id.endsWith('@g.us') && !ch.id.endsWith('@newsletter') && (ch as any).name)
            .map((ch) => ({ id: ch.id, name: (ch as any).name }));
          if (direct.length) {
            syncContacts(direct);
            apiServer.handleContactsSync(direct);
          }
        } catch (chErr) {
          logger.debug({ chErr }, 'Failed to sync direct chats update names');
        }
      });

      socket.ev.on('chats.phoneNumberShare', ({ lid, jid }) => {
        try {
          if (lid && jid) {
            syncContacts([{ id: jid, lid, jid }]);
            apiServer.handleContactsSync([]);
          }
        } catch (pnErr) {
          logger.debug({ pnErr }, 'Failed to sync phoneNumberShare mapping');
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

  apiServer.setConnectionManager(connectionManager);

  await connectionManager.connect();
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start bot');
  process.exit(1);
});
