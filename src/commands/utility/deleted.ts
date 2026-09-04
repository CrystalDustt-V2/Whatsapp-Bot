import config from '../../config';
import {
  listDeletedMessages,
  getAllDeletedMessages,
  listDeletedChats,
  listViewOnceMessages,
  readDeletedMessageMedia,
  type DeletedMessageRecord,
} from '../../services/deleted-message-recovery';
import { Command, CommandCategory, type BotContext } from '../../types';

const PAGE_SIZE = 30;

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

export function formatChatLabel(chatJid: string): string {
  if (chatJid.endsWith('@g.us')) {
    const id = chatJid.replace('@g.us', '');
    return `Group [${id.length > 15 ? `${id.slice(0, 12)}...` : id}]`;
  }
  if (chatJid.endsWith('@s.whatsapp.net')) {
    return `DM [+${chatJid.replace('@s.whatsapp.net', '')}]`;
  }
  return `Chat [${chatJid}]`;
}

export function isOwnerOrSelf(ctx: BotContext): boolean {
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

export function formatRecord(record: DeletedMessageRecord, index: number, showChat = false): string {
  const isVo = Boolean(record.viewOnce || record.media?.viewOnce || record.messageType?.startsWith('viewOnce:'));
  const header = isVo ? `*Saved View-Once message #${index}*` : `*Deleted message #${index}*`;
  const chatLine = showChat ? `Chat: ${formatChatLabel(record.chatJid)} (${record.chatJid})\n` : '';
  const mediaLine = record.media
    ? `Media: saved ${isVo ? 'view-once ' : ''}${record.media.kind} (${formatBytes(record.media.size)})\n`
    : '';

  const actionLine =
    isVo && record.deletedByName === record.senderName
      ? `Action: Auto-saved View Once media\n`
      : `Deleted by: ${record.deletedByName}${record.deletedByNumber ? ` (${record.deletedByNumber})` : ''}\n`;

  const timeAction = isVo && record.deletedByName === record.senderName ? 'Saved' : 'Deleted';

  return (
    `${header}\n` +
    chatLine +
    `From: ${record.senderName}${record.senderNumber ? ` (${record.senderNumber})` : ''}\n` +
    actionLine +
    `Type: ${record.messageType}\n` +
    mediaLine +
    `Sent: ${formatTime(record.timestamp)}\n` +
    `${timeAction}: ${formatTime(record.deletedAt)}\n\n` +
    `${record.text || (record.media ? `[${record.media.kind.toUpperCase()} ATTACHMENT]` : '')}`
  );
}

export function formatList(records: DeletedMessageRecord[], title = 'Recovered deleted & view-once messages', showChat = false): string {
  const lines = records.map((record, index) => {
    const isVo = Boolean(record.viewOnce || record.media?.viewOnce || record.messageType?.startsWith('viewOnce:'));
    const chatPrefix = showChat ? `${formatChatLabel(record.chatJid)} ` : '';
    const media = record.media ? ` [${isVo ? 'view-once ' : ''}${record.media.kind}]` : '';
    return `${index + 1}. ${chatPrefix}${record.senderName}${media} - ${preview(record.text)} (${formatTime(record.deletedAt)})`;
  });

  return (
    `*${title} (${records.length})*\n\n` +
    `${lines.join('\n')}\n\n` +
    `👉 Use *${config.BOT_PREFIX}deleted <number>* to view message & recover media.`
  );
}

export async function sendRecoveredMedia(
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

import { formatUsageError, formatFailed } from '../../core/response-formatter';

export const DeletedMessageCommand: Command = {
  name: 'deleted',
  aliases: ['antidelete', 'undelete', 'revoke'],
  category: CommandCategory.UTILITY,
  description: 'Recover deleted messages and saved view-once media with multi-page support',
  usage: 'deleted [list [page]|viewonce [page]|chats|number]',
  examples: [
    'deleted',
    'deleted list',
    'deleted viewonce',
    'deleted list 2',
    'deleted 1',
    'deleted chats',
  ],
  inputs: 'Subcommand (list, chats) or message index number',
  limits: 'Can only recover messages witnessed by the bot while running',
  async execute(ctx) {
    const isOwner = isOwnerOrSelf(ctx);
    const currentChatJid = ctx.message.key.remoteJid || ctx.sender.chatJid;
    const arg0 = (ctx.args[0] || '').toLowerCase();
    const arg1 = (ctx.args[1] || '').toLowerCase();

    // ==========================================
    // OWNER / BOT ITSELF: Global Paginated Mode
    // ==========================================
    if (isOwner) {
      // 1. Owner subcommand: .deleted chats / .deleted groups
      if (arg0 === 'chats' || arg0 === 'groups') {
        const chats = listDeletedChats();
        if (!chats.length) {
          await ctx.reply('No deleted messages saved across any chats yet.');
          return;
        }

        const lines = chats.map((c, i) => {
          return `${i + 1}. *${formatChatLabel(c.chatJid)}* (${c.count} deleted)\n   Last: ${c.lastSenderName} • ${formatTime(c.lastDeletedAt)}\n   JID: \`${c.chatJid}\``;
        });

        await ctx.reply(
          `*Chats with Deleted Messages (${chats.length})*\n\n${lines.join('\n\n')}\n\n👉 View with *${config.BOT_PREFIX}deleted chat <number|jid>*`
        );
        return;
      }

      // 2. Owner subcommand: .deleted chat <jid or chat number>
      if (arg0 === 'chat' && arg1) {
        let targetJid = arg1;
        const chatIndex = Number(arg1);
        if (Number.isInteger(chatIndex) && chatIndex >= 1) {
          const chats = listDeletedChats();
          if (chatIndex <= chats.length) {
            targetJid = chats[chatIndex - 1].chatJid;
          }
        }

        const records = listDeletedMessages(targetJid, 30);
        if (!records.length) {
          await ctx.reply(`No deleted messages found for chat "${targetJid}".`);
          return;
        }

        await ctx.reply(formatList(records, `Deleted Messages for ${formatChatLabel(targetJid)}`, false));
        return;
      }

      // 3. Owner subcommand: .deleted viewonce or .deleted vo -> redirect to .viewonce
      if (arg0 === 'viewonce' || arg0 === 'vo') {
        await ctx.reply(`👉 View-once media is isolated and accessible only via *${config.BOT_PREFIX}viewonce* (or *${config.BOT_PREFIX}vo*).`);
        return;
      }

      const allRecords = getAllDeletedMessages();
      const totalCount = allRecords.length;

      if (!totalCount) {
        await ctx.reply('No deleted messages saved from any chats yet. I can only recover messages I saw while I was running.');
        return;
      }

      // 3. Owner subcommand: .deleted list [page] (or .deleted without args, or .deleted all for compatibility)
      if (!arg0 || arg0 === 'list' || arg0 === 'all' || arg0 === 'recent') {
        const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
        let page = 1;

        const pageArg = arg0 === 'list' || arg0 === 'all' ? arg1 : '';
        if (pageArg) {
          const parsedPage = Number(pageArg);
          if (Number.isInteger(parsedPage) && parsedPage >= 1) {
            page = parsedPage;
          } else {
            await ctx.reply(`Invalid page number "${pageArg}". Available pages: 1 to ${totalPages}`);
            return;
          }
        }

        if (page > totalPages) {
          await ctx.reply(`Page ${page} does not exist. Available pages: 1 to ${totalPages} (Total: ${totalCount} recovered messages).`);
          return;
        }

        const startIndex = (page - 1) * PAGE_SIZE;
        const pageRecords = allRecords.slice(startIndex, startIndex + PAGE_SIZE);

        const lines = pageRecords.map((record, index) => {
          const globalIndex = startIndex + index + 1;
          const chatPrefix = `${formatChatLabel(record.chatJid)} `;
          const media = record.media ? ` [${record.media.viewOnce ? 'view-once ' : ''}${record.media.kind}]` : '';
          return `${globalIndex}. ${chatPrefix}${record.senderName}${media} - ${preview(record.text)} (${formatTime(record.deletedAt)})`;
        });

        const nextPageHint =
          page < totalPages
            ? `📖 Page ${page}/${totalPages} • Use *${config.BOT_PREFIX}deleted list ${page + 1}* for next page\n`
            : `📖 Page ${page}/${totalPages} (End of recovered messages)\n`;

        const text =
          `*Recovered Deleted Messages (All Chats)*\n` +
          `*Page ${page} of ${totalPages} (Total: ${totalCount} messages)*\n\n` +
          `${lines.join('\n')}\n\n` +
          `${nextPageHint}` +
          `👉 Use *${config.BOT_PREFIX}deleted <number>* to view message & recover media.`;

        await ctx.reply(text);
        return;
      }

      // 4. Owner subcommand: .deleted <number>
      const globalIndex = Number(arg0);
      if (!Number.isInteger(globalIndex) || globalIndex < 1 || globalIndex > totalCount) {
        await ctx.reply(
          `Pick a number from 1 to ${totalCount}, or use *${config.BOT_PREFIX}deleted list* to browse pages.`
        );
        return;
      }

      const record = allRecords[globalIndex - 1];
      const formatted = formatRecord(record, globalIndex, true);
      await sendRecoveredMedia(ctx, record, formatted);
      return;
    }

    // ==========================================
    // NON-OWNER USERS: Current Chat Only Mode
    // ==========================================
    if (arg0 === 'viewonce' || arg0 === 'vo') {
      await ctx.reply('⛔ Access denied. View-once messages can only be viewed and restored by the bot owner.');
      return;
    }

    const localRecords = listDeletedMessages(currentChatJid, 30);
    if (!localRecords.length) {
      await ctx.reply('No deleted messages saved for this chat yet. I can only recover messages I saw while I was running.');
      return;
    }

    if (!arg0 || arg0 === 'list' || arg0 === 'recent') {
      await ctx.reply(formatList(localRecords, 'Recovered deleted messages (This Chat)', false));
      return;
    }

    const localIndex = Number(arg0);
    if (!Number.isInteger(localIndex) || localIndex < 1 || localIndex > localRecords.length) {
      await ctx.reply(`Pick a number from 1 to ${localRecords.length}, or use *${config.BOT_PREFIX}deleted list*.`);
      return;
    }

    const record = localRecords[localIndex - 1];
    const formatted = formatRecord(record, localIndex, false);
    await sendRecoveredMedia(ctx, record, formatted);
  },
};

export default DeletedMessageCommand;
