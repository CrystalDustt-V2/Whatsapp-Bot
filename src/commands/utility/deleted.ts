import config from '../../config';
import { listDeletedMessages, readDeletedMessageMedia, type DeletedMessageRecord } from '../../services/deleted-message-recovery';
import { Command, CommandCategory } from '../../types';

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-US', { hour12: false });
}

function preview(value: string, max = 80): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function formatRecord(record: DeletedMessageRecord, index: number): string {
  const mediaLine = record.media
    ? `Media: saved ${record.media.viewOnce ? 'view-once ' : ''}${record.media.kind} (${formatBytes(record.media.size)})\n`
    : '';

  return (
    `*Deleted message #${index}*\n` +
    `From: ${record.senderName}${record.senderNumber ? ` (${record.senderNumber})` : ''}\n` +
    `Deleted by: ${record.deletedByName}${record.deletedByNumber ? ` (${record.deletedByNumber})` : ''}\n` +
    `Type: ${record.messageType}\n` +
    mediaLine +
    `Sent: ${formatTime(record.timestamp)}\n` +
    `Deleted: ${formatTime(record.deletedAt)}\n\n` +
    `${record.text}`
  );
}

function formatList(records: DeletedMessageRecord[]): string {
  const lines = records.map((record, index) => {
    const media = record.media ? ` [${record.media.viewOnce ? 'view-once ' : ''}${record.media.kind}]` : '';
    return `${index + 1}. ${record.senderName}${media} - ${preview(record.text)} (${formatTime(record.deletedAt)})`;
  });

  return `*Recovered deleted messages*\n${lines.join('\n')}\n\nUse ${config.BOT_PREFIX}deleted <number> to view one.`;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export const DeletedMessageCommand: Command = {
  name: 'deleted',
  aliases: ['antidelete', 'undelete', 'revoke'],
  category: CommandCategory.UTILITY,
  description: 'Recover recently deleted messages from this chat',
  usage: 'deleted [list|number]',
  async execute(ctx) {
    const chatJid = ctx.message.key.remoteJid || ctx.sender.chatJid;
    const records = listDeletedMessages(chatJid, 10);
    if (!records.length) {
      await ctx.reply('No deleted messages saved for this chat yet. I can only recover messages I saw while I was running.');
      return;
    }

    const mode = (ctx.args[0] || '').toLowerCase();
    if (mode === 'list' || mode === 'recent') {
      await ctx.reply(formatList(records));
      return;
    }

    const index = mode ? Number(mode) : 1;
    if (!Number.isInteger(index) || index < 1 || index > records.length) {
      await ctx.reply(`Pick a number from 1 to ${records.length}, or use ${config.BOT_PREFIX}deleted list.`);
      return;
    }

    const record = records[index - 1];
    await ctx.reply(formatRecord(record, index));

    if (!record.media) return;
    const buffer = await readDeletedMessageMedia(record);
    if (!buffer) {
      await ctx.reply('The deleted media metadata is saved, but the media file is no longer available.');
      return;
    }

    if (record.media.kind === 'video') {
      await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
        video: buffer,
        mimetype: record.media.mimetype || 'video/mp4',
      });
      return;
    }

    if (record.media.kind === 'image') {
      await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
        image: buffer,
        mimetype: record.media.mimetype || 'image/jpeg',
      });
      return;
    }

    await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
      audio: buffer,
      mimetype: record.media.mimetype || 'audio/ogg',
      ptt: record.media.ptt,
    });
  },
};
