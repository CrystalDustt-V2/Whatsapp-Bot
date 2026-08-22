import config from '../../config';
import {
  listDeletedMessages,
  listAllDeletedMessages,
  listDeletedChats,
  readDeletedMessageMedia,
  type DeletedMessageRecord,
} from '../../services/deleted-message-recovery';
import { Command, CommandCategory, type BotContext } from '../../types';

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-US', { hour12: false });
}

function preview(value: string, max = 60): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text || '[Media / Empty Text]';
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatChatLabel(chatJid: string): string {
  if (chatJid.endsWith('@g.us')) {
    const id = chatJid.replace('@g.us', '');
    return `Group [${id.length > 15 ? `${id.slice(0, 12)}...` : id}]`;
  }
  if (chatJid.endsWith('@s.whatsapp.net')) {
    return `DM [+${chatJid.replace('@s.whatsapp.net', '')}]`;
  }
  return `Chat [${chatJid}]`;
}

function isOwnerOrSelf(ctx: BotContext): boolean {
  if (ctx.sender.fromMe || ctx.message.key.fromMe) return true;

  const senderNumber = ctx.sender.phoneNumber?.replace(/\D/g, '') || '';
  const senderJid = ctx.sender.jid || '';
  const ownerNumber = config.OWNER_NUMBER?.replace(/\D/g, '') || '';
  const botNumber = ctx.socket.user?.id?.split(':')[0]?.replace(/\D/g, '') || '';

  if (ownerNumber && (senderNumber === ownerNumber || senderJid.includes(ownerNumber))) {
    return true;
  }
  if (botNumber && (senderNumber === botNumber || senderJid.includes(botNumber))) {
    return true;
  }

  return false;
}

function isSelfOrOwnerChat(ctx: BotContext): boolean {
  const remoteJid = ctx.message.key.remoteJid || ctx.sender.chatJid;
  if (!remoteJid || remoteJid.endsWith('@g.us')) return false;

  const botJid = ctx.socket.user?.id?.split(':')[0]?.replace(/\D/g, '') || '';
  const ownerNumber = config.OWNER_NUMBER?.replace(/\D/g, '') || '';
  const chatNumber = remoteJid.split('@')[0]?.replace(/\D/g, '') || '';

  return (
    ctx.sender.fromMe ||
    ctx.message.key.fromMe ||
    (Boolean(botJid) && chatNumber === botJid) ||
    (Boolean(ownerNumber) && chatNumber === ownerNumber)
  );
}

function formatRecord(record: DeletedMessageRecord, index: number, showChat = false): string {
  const chatLine = showChat ? `Chat: ${formatChatLabel(record.chatJid)} (${record.chatJid})\n` : '';
  const mediaLine = record.media
    ? `Media: saved ${record.media.viewOnce ? 'view-once ' : ''}${record.media.kind} (${formatBytes(record.media.size)})\n`
    : '';

  return (
    `*Deleted message #${index}*\n` +
    chatLine +
    `From: ${record.senderName}${record.senderNumber ? ` (${record.senderNumber})` : ''}\n` +
    `Deleted by: ${record.deletedByName}${record.deletedByNumber ? ` (${record.deletedByNumber})` : ''}\n` +
    `Type: ${record.messageType}\n` +
    mediaLine +
    `Sent: ${formatTime(record.timestamp)}\n` +
    `Deleted: ${formatTime(record.deletedAt)}\n\n` +
    `${record.text || (record.media ? `[${record.media.kind.toUpperCase()} ATTACHMENT]` : '')}`
  );
}

function formatList(records: DeletedMessageRecord[], title = 'Recovered deleted messages', showChat = false): string {
  const lines = records.map((record, index) => {
    const chatPrefix = showChat ? `${formatChatLabel(record.chatJid)} ` : '';
    const media = record.media ? ` [${record.media.viewOnce ? 'view-once ' : ''}${record.media.kind}]` : '';
    return `${index + 1}. ${chatPrefix}${record.senderName}${media} - ${preview(record.text)} (${formatTime(record.deletedAt)})`;
  });

  return (
    `*${title} (${records.length})*\n\n` +
    `${lines.join('\n')}\n\n` +
    `👉 Use *${config.BOT_PREFIX}deleted ${showChat ? 'all ' : ''}<number>* to view message & recover media.`
  );
}

async function sendRecoveredMedia(
  ctx: BotContext,
  record: DeletedMessageRecord,
  formattedText: string
): Promise<void> {
  const targetJid = ctx.message.key.remoteJid || ctx.sender.chatJid;
  if (!record.media) {
    await ctx.reply(formattedText);
    return;
  }

  const buffer = await readDeletedMessageMedia(record);
  if (!buffer) {
    await ctx.reply(
      `${formattedText}\n\n⚠️ _The deleted media metadata is saved, but the file is no longer on storage._`
    );
    return;
  }

  if (record.media.kind === 'video') {
    await ctx.socket.sendMessage(targetJid, {
      video: buffer,
      mimetype: record.media.mimetype || 'video/mp4',
      caption: formattedText,
    });
    return;
  }

  if (record.media.kind === 'image') {
    await ctx.socket.sendMessage(targetJid, {
      image: buffer,
      mimetype: record.media.mimetype || 'image/jpeg',
      caption: formattedText,
    });
    return;
  }

  // Audio / voice note
  await ctx.reply(formattedText);
  await ctx.socket.sendMessage(targetJid, {
    audio: buffer,
    mimetype: record.media.mimetype || 'audio/ogg',
    ptt: record.media.ptt ?? false,
  });
}

export const DeletedMessageCommand: Command = {
  name: 'deleted',
  aliases: ['antidelete', 'undelete', 'revoke'],
  category: CommandCategory.UTILITY,
  description: 'Recover deleted messages from current chat or all chats (Owner / Message Yourself)',
  usage: 'deleted [list|all|chats|number]',
  async execute(ctx) {
    const isOwner = isOwnerOrSelf(ctx);
    const isSelfChat = isSelfOrOwnerChat(ctx);
    const currentChatJid = ctx.message.key.remoteJid || ctx.sender.chatJid;
    const arg0 = (ctx.args[0] || '').toLowerCase();
    const arg1 = (ctx.args[1] || '').toLowerCase();

    // 1. Owner subcommands: .deleted chats
    if (isOwner && (arg0 === 'chats' || arg0 === 'groups')) {
      const chats = listDeletedChats();
      if (!chats.length) {
        await ctx.reply('No deleted messages saved across any chats yet.');
        return;
      }

      const lines = chats.map((c, i) => {
        return `${i + 1}. *${formatChatLabel(c.chatJid)}* (${c.count} deleted)\n   Last: ${c.lastSenderName} • ${formatTime(c.lastDeletedAt)}\n   JID: \`${c.chatJid}\``;
      });

      await ctx.reply(`*Chats with Deleted Messages (${chats.length})*\n\n${lines.join('\n\n')}\n\n👉 View with *${config.BOT_PREFIX}deleted chat <number|jid>*`);
      return;
    }

    // 2. Owner subcommands: .deleted chat <jid or chat number>
    if (isOwner && arg0 === 'chat' && arg1) {
      let targetJid = arg1;
      const chatIndex = Number(arg1);
      if (Number.isInteger(chatIndex) && chatIndex >= 1) {
        const chats = listDeletedChats();
        if (chatIndex <= chats.length) {
          targetJid = chats[chatIndex - 1].chatJid;
        }
      }

      const records = listDeletedMessages(targetJid, 15);
      if (!records.length) {
        await ctx.reply(`No deleted messages found for chat "${targetJid}".`);
        return;
      }

      await ctx.reply(formatList(records, `Deleted Messages for ${formatChatLabel(targetJid)}`, false));
      return;
    }

    // 3. Global All-Chats mode: .deleted all [number] OR auto-all when in "Message Yourself"
    const wantsGlobal = isOwner && (arg0 === 'all' || arg0 === 'global');
    const localRecords = listDeletedMessages(currentChatJid, 15);
    const globalRecords = isOwner ? listAllDeletedMessages(30) : [];

    // If owner explicitly asked for 'all' or if owner is in "Message Yourself" chat and has no local-only deleted records
    const useGlobal = wantsGlobal || (isOwner && isSelfChat && (!localRecords.length || arg0 === 'all'));

    if (useGlobal) {
      if (!globalRecords.length) {
        await ctx.reply('No deleted messages saved from any chats yet. I can only recover messages I saw while I was running.');
        return;
      }

      const targetArg = wantsGlobal ? arg1 : arg0;

      // List all global
      if (!targetArg || targetArg === 'list' || targetArg === 'recent') {
        const title = isSelfChat ? 'Global Deleted Messages (Message Yourself)' : 'Global Deleted Messages (All Chats)';
        await ctx.reply(formatList(globalRecords, title, true));
        return;
      }

      // View specific global index
      const globalIndex = Number(targetArg);
      if (!Number.isInteger(globalIndex) || globalIndex < 1 || globalIndex > globalRecords.length) {
        await ctx.reply(
          `Pick a number from 1 to ${globalRecords.length}, or use *${config.BOT_PREFIX}deleted all* to list.`
        );
        return;
      }

      const record = globalRecords[globalIndex - 1];
      const formatted = formatRecord(record, globalIndex, true);
      await sendRecoveredMedia(ctx, record, formatted);
      return;
    }

    // 4. Standard chat-specific mode (current group / DM)
    if (!localRecords.length) {
      const extraHint = isOwner ? `\n\n💡 _As bot owner, you can view deleted messages across ALL chats with *${config.BOT_PREFIX}deleted all*_` : '';
      await ctx.reply(`No deleted messages saved for this chat yet. I can only recover messages I saw while I was running.${extraHint}`);
      return;
    }

    if (arg0 === 'list' || arg0 === 'recent') {
      await ctx.reply(formatList(localRecords, 'Recovered deleted messages (This Chat)', false));
      return;
    }

    const index = arg0 ? Number(arg0) : 1;
    if (!Number.isInteger(index) || index < 1 || index > localRecords.length) {
      await ctx.reply(`Pick a number from 1 to ${localRecords.length}, or use *${config.BOT_PREFIX}deleted list*.`);
      return;
    }

    const record = localRecords[index - 1];
    const formatted = formatRecord(record, index, false);
    await sendRecoveredMedia(ctx, record, formatted);
  },
};

export default DeletedMessageCommand;
