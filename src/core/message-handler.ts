import type { WASocket, WAMessage, proto } from '@whiskeysockets/baileys';
import logger from './logger';
import config from '../config';
import { commandRegistry } from './command-registry';
import type { BotContext } from '../types';

export class MessageHandler {
  private socket: WASocket;

  constructor(socket: WASocket) {
    this.socket = socket;
  }

  private getMessageText(message: proto.IMessage): string {
    const viewOnceMessage =
      message.viewOnceMessage?.message ||
      message.viewOnceMessageV2?.message ||
      message.viewOnceMessageV2Extension?.message;
    const ephemeralMessage = message.ephemeralMessage?.message;
    const documentWithCaptionMessage = message.documentWithCaptionMessage?.message;
    const editedMessage = message.editedMessage?.message;
    const wrappedMessage =
      viewOnceMessage ||
      ephemeralMessage ||
      documentWithCaptionMessage ||
      editedMessage;

    if (wrappedMessage) {
      return this.getMessageText(wrappedMessage);
    }

    return (
      message.conversation ||
      message.extendedTextMessage?.text ||
      message.imageMessage?.caption ||
      message.videoMessage?.caption ||
      message.documentMessage?.caption ||
      ''
    );
  }

  async reply(message: WAMessage, text: string): Promise<void> {
    if (!message.key.remoteJid) return;

    await this.socket.sendMessage(
      message.key.remoteJid,
      { text },
      message.key.fromMe ? undefined : { quoted: message }
    );
  }

  async handleMessage(message: WAMessage): Promise<void> {
    try {
      if (!message.key.remoteJid) {
        logger.debug({ messageId: message.key.id }, 'Skipping message without remoteJid');
        return;
      }

      const msg = message.message;
      if (!msg) {
        logger.debug(
          { fromMe: message.key.fromMe, remoteJid: message.key.remoteJid, messageId: message.key.id },
          'Skipping message without decrypted content'
        );
        return;
      }

      const text = this.getMessageText(msg).trim();

      if (!text.startsWith(config.BOT_PREFIX)) {
        logger.debug(
          {
            fromMe: message.key.fromMe,
            remoteJid: message.key.remoteJid,
            messageId: message.key.id,
            messageType: Object.keys(msg)[0],
          },
          'Skipping non-command message'
        );
        return;
      }

      const args = text.slice(config.BOT_PREFIX.length).trim().split(/\s+/);
      const commandName = args.shift()?.toLowerCase();

      if (!commandName) return;

      const command = commandRegistry.get(commandName);
      if (!command) {
        logger.info(
          { fromMe: message.key.fromMe, remoteJid: message.key.remoteJid, messageId: message.key.id },
          `Unknown command: ${commandName}`
        );
        return;
      }

      logger.info(
        { fromMe: message.key.fromMe, remoteJid: message.key.remoteJid, messageId: message.key.id },
        `Executing command: ${commandName}`
      );

      const ctx: BotContext = {
        socket: this.socket,
        message,
        args,
        reply: (replyText) => this.reply(message, replyText),
      };

      await command.execute(ctx);
      logger.info(
        { fromMe: message.key.fromMe, remoteJid: message.key.remoteJid, messageId: message.key.id },
        `Command completed: ${commandName}`
      );
    } catch (err) {
      logger.error({ err }, 'Error handling message');
    }
  }
}

export default MessageHandler;
