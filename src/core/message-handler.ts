import type { WASocket, WAMessage, WAMessageKey, WAMessageUpdate, proto } from '@whiskeysockets/baileys';
import logger from './logger';
import config from '../config';
import { commandRegistry } from './command-registry';
import { formatCommandHelp } from './command-help';
import type { BotContext } from '../types';
import { getSenderIdentity, recordAiMemoryMessage } from '../services/message-memory';
import {
  recordDeletedMessageByKey,
  recordDeletedMessageFromProtocol,
  recordDeletedMessageFromUpdate,
  recordRecoverableMessage,
  readDeletedMessageMedia,
  type DeletedMessageRecord,
} from '../services/deleted-message-recovery';
import * as fs from 'fs';
import * as path from 'path';

const MAX_SEEN_MESSAGES = 5000;
const seenMessages = new Set<string>();
const seenMessageOrder: string[] = [];
const SEEN_MESSAGES_PATH = path.join(config.SESSION_PATH, 'processed-messages.json');

function loadSeenMessages(): void {
  try {
    const messages = JSON.parse(fs.readFileSync(SEEN_MESSAGES_PATH, 'utf8')) as string[];
    for (const key of messages.slice(-MAX_SEEN_MESSAGES)) {
      seenMessages.add(key);
      seenMessageOrder.push(key);
    }
  } catch {
    // ponytail: missing/corrupt cache only means old commands may replay once.
  }
}

function saveSeenMessages(): void {
  try {
    fs.mkdirSync(path.dirname(SEEN_MESSAGES_PATH), { recursive: true });
    fs.writeFileSync(SEEN_MESSAGES_PATH, JSON.stringify(seenMessageOrder.slice(-MAX_SEEN_MESSAGES)));
  } catch (err) {
    logger.warn({ err }, 'Could not save processed message cache');
  }
}

loadSeenMessages();

function markMessageSeen(key: string): void {
  if (seenMessages.has(key)) return;

  seenMessages.add(key);
  seenMessageOrder.push(key);

  while (seenMessageOrder.length > MAX_SEEN_MESSAGES) {
    seenMessages.delete(seenMessageOrder.shift()!);
  }

  saveSeenMessages();
}

function getTimestampSeconds(message: WAMessage): number {
  const value = message.messageTimestamp;
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (!value) return 0;

  const timestamp = value as {
    toNumber?: () => number;
    toString?: () => string;
    low?: number;
    high?: number;
  };

  if (typeof timestamp.toNumber === 'function') return timestamp.toNumber();

  if (typeof timestamp.low === 'number' && typeof timestamp.high === 'number') {
    return timestamp.high * 4294967296 + (timestamp.low >>> 0);
  }

  const parsed = Number(timestamp.toString?.());
  return Number.isFinite(parsed) ? parsed : 0;
}

export class MessageHandler {
  private socket: WASocket;
  private ignoreUntilMs: number;
  private ignoreBeforeSeconds: number;

  constructor(socket: WASocket, ignoreUntilMs = Date.now() + config.STARTUP_IGNORE_MESSAGES_SECONDS * 1000) {
    this.socket = socket;
    this.ignoreUntilMs = ignoreUntilMs;
    this.ignoreBeforeSeconds = Math.floor(ignoreUntilMs / 1000) + config.IGNORE_OLD_MESSAGES_SECONDS;
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

  private async forwardViewOnceToOwner(record: DeletedMessageRecord): Promise<void> {
    try {
      const ownerNumber = config.OWNER_NUMBER?.replace(/\D/g, '');
      const botNumber = this.socket.user?.id?.split(':')[0]?.replace(/\D/g, '');
      const targetJid = ownerNumber ? `${ownerNumber}@s.whatsapp.net` : (botNumber ? `${botNumber}@s.whatsapp.net` : null);
      if (!targetJid) return;

      // Avoid forwarding if the owner sent the view-once message themselves to prevent loop
      if (record.senderNumber && ownerNumber && record.senderNumber.replace(/\D/g, '') === ownerNumber) {
        return;
      }

      const buffer = await readDeletedMessageMedia(record);
      if (!buffer || !record.media) return;

      const caption =
        `👁️ *[VIEW-ONCE AUTO-SAVED]*\n` +
        `From: *${record.senderName}* (${record.senderNumber || record.senderJid})\n` +
        `Chat: \`${record.chatJid}\`\n` +
        `Time: ${new Date(record.timestamp).toLocaleString()}\n\n` +
        (record.text ? `Caption: ${record.text}` : '');

      if (record.media.kind === 'video') {
        await this.socket.sendMessage(targetJid, {
          video: buffer,
          mimetype: record.media.mimetype || 'video/mp4',
          caption: caption.trim(),
        });
      } else if (record.media.kind === 'image') {
        await this.socket.sendMessage(targetJid, {
          image: buffer,
          mimetype: record.media.mimetype || 'image/jpeg',
          caption: caption.trim(),
        });
      } else if (record.media.kind === 'audio') {
        await this.socket.sendMessage(targetJid, { text: caption.trim() });
        await this.socket.sendMessage(targetJid, {
          audio: buffer,
          mimetype: record.media.mimetype || 'audio/ogg',
          ptt: record.media.ptt ?? false,
        });
      }
    } catch (err) {
      logger.warn({ err, messageId: record.messageId }, 'Could not auto-forward view-once media to owner');
    }
  }

  async handleMessage(message: WAMessage): Promise<void> {
    try {
      if (!message.key.remoteJid) {
        logger.debug({ messageId: message.key.id }, 'Skipping message without remoteJid');
        return;
      }

      const messageKey = `${message.key.remoteJid}:${message.key.id || ''}:${message.key.participant || ''}`;
      if (seenMessages.has(messageKey)) {
        logger.debug({ messageId: message.key.id, remoteJid: message.key.remoteJid }, 'Skipping already processed message');
        return;
      }

      const timestamp = getTimestampSeconds(message);
      const msg = message.message;
      if (!msg) {
        logger.debug(
          { fromMe: message.key.fromMe, remoteJid: message.key.remoteJid, messageId: message.key.id },
          'Skipping message without decrypted content'
        );
        return;
      }

      const sender = getSenderIdentity(message, this.socket);
      const messageType = Object.keys(msg)[0] || 'unknown';
      const text = this.getMessageText(msg).trim();
      const logContext = {
        fromMe: message.key.fromMe,
        remoteJid: message.key.remoteJid,
        messageId: message.key.id,
        sender: sender.displayName,
        senderNumber: sender.phoneNumber,
      };

      recordAiMemoryMessage(message, sender, text, messageType, timestamp);

      if (Date.now() < this.ignoreUntilMs) {
        markMessageSeen(messageKey);
        logger.debug(
          { ...logContext, ignoreUntilMs: this.ignoreUntilMs },
          'Skipping message during startup backlog drain'
        );
        return;
      }

      if (timestamp > 0 && timestamp < this.ignoreBeforeSeconds) {
        markMessageSeen(messageKey);
        logger.debug(
          { ...logContext, timestamp, ignoreBeforeSeconds: this.ignoreBeforeSeconds },
          'Skipping old message from before this connection'
        );
        return;
      }

      const recovered = recordDeletedMessageFromProtocol(message, sender, timestamp);
      if (recovered) {
        markMessageSeen(messageKey);
        logger.info(
          { ...logContext, recoveredMessageId: recovered.messageId, recoveredSender: recovered.senderName },
          'Recovered deleted message metadata'
        );
        return;
      }

      const savedViewOnce = await recordRecoverableMessage(message, sender, text, timestamp);
      if (savedViewOnce && config.VIEW_ONCE_AUTO_FORWARD) {
        await this.forwardViewOnceToOwner(savedViewOnce);
      }

      if (!text.startsWith(config.BOT_PREFIX)) {
        logger.debug(
          {
            ...logContext,
            messageType,
          },
          'Skipping non-command message'
        );
        return;
      }

      const body = text.slice(config.BOT_PREFIX.length).trim();
      const firstSpace = body.search(/\s/);
      const commandName = (firstSpace === -1 ? body : body.slice(0, firstSpace)).toLowerCase();
      const rawArgs = firstSpace === -1 ? '' : body.slice(firstSpace).trim();
      const args = rawArgs ? rawArgs.split(/\s+/) : [];

      if (!commandName) return;

      const command = commandRegistry.get(commandName);
      if (!command) {
        logger.info(
          logContext,
          `Unknown command: ${commandName}`
        );
        return;
      }

      markMessageSeen(messageKey);

      if (command.name !== 'ai' && args[0]?.toLowerCase() === 'help') {
        await this.reply(message, formatCommandHelp(command));
        return;
      }

      logger.info(
        logContext,
        `Executing command: ${commandName}`
      );

      const ctx: BotContext = {
        socket: this.socket,
        message,
        sender,
        args,
        rawArgs,
        reply: (replyText) => this.reply(message, replyText),
      };

      await command.execute(ctx);
      logger.info(
        logContext,
        `Command completed: ${commandName}`
      );
    } catch (err) {
      logger.error({ err }, 'Error handling message');
    }
  }

  async handleMessageUpdate(update: WAMessageUpdate): Promise<void> {
    try {
      const key = update.update.key || update.key;
      const timestampSeconds = Math.floor(Date.now() / 1000);
      const deletedBy = getSenderIdentity({ key, messageTimestamp: timestampSeconds } as WAMessage, this.socket);
      if (config.DELETED_MESSAGE_DEBUG) {
        logger.info(
          {
            remoteJid: key.remoteJid,
            messageId: key.id,
            updateKeys: Object.keys(update.update),
            messageType: update.update.message ? Object.keys(update.update.message)[0] || 'unknown' : 'none',
          },
          'Received message update for deleted-message recovery'
        );
      }

      const recovered = recordDeletedMessageFromUpdate(update, deletedBy, timestampSeconds);
      if (!recovered) {
        if (config.DELETED_MESSAGE_DEBUG) {
          logger.info(
            { remoteJid: key.remoteJid, messageId: key.id },
            'Message update was not a recoverable delete'
          );
        }
        return;
      }

      logger.info(
        {
          remoteJid: recovered.chatJid,
          messageId: recovered.messageId,
          sender: recovered.senderName,
          deletedBy: recovered.deletedByName,
        },
        'Recovered deleted message metadata'
      );
    } catch (err) {
      logger.warn({ err }, 'Could not process deleted message update');
    }
  }

  async handleMessageDelete(update: { keys: WAMessageKey[] } | { jid: string; all: true }): Promise<void> {
    if ('all' in update) {
      if (config.DELETED_MESSAGE_DEBUG) {
        logger.info({ jid: update.jid }, 'Received all-messages delete event');
      }
      return;
    }

    if (config.DELETED_MESSAGE_DEBUG) {
      logger.info(
        { count: update.keys.length, keys: update.keys.map((key) => ({ remoteJid: key.remoteJid, id: key.id })) },
        'Received message delete event'
      );
    }

    for (const key of update.keys) {
      try {
        const timestampSeconds = Math.floor(Date.now() / 1000);
        const deletedBy = getSenderIdentity({ key, messageTimestamp: timestampSeconds } as WAMessage, this.socket);
        const recovered = recordDeletedMessageByKey(key, deletedBy, timestampSeconds);
        if (!recovered) {
          logger.info(
            { remoteJid: key.remoteJid, messageId: key.id },
            'Deleted message event had no cached recoverable message'
          );
          continue;
        }

        logger.info(
          {
            remoteJid: recovered.chatJid,
            messageId: recovered.messageId,
            sender: recovered.senderName,
            deletedBy: recovered.deletedByName,
          },
          'Recovered deleted message metadata'
        );
      } catch (err) {
        logger.warn({ err, remoteJid: key.remoteJid, messageId: key.id }, 'Could not process deleted message event');
      }
    }
  }
}

export default MessageHandler;
