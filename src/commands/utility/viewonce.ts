import config from '../../config';
import {
  downloadAndCacheQuotedMedia,
  findStoredMessageById,
  getAllViewOnceMessages,
  getQuotedContextInfo,
  listViewOnceMessages,
  readDeletedMessageMedia,
  type DeletedMessageRecord,
} from '../../services/deleted-message-recovery';
import { Command, CommandCategory } from '../../types';
import {
  formatChatLabel,
  formatRecord,
  isOwnerOrSelf,
  sendRecoveredMedia,
  saveListingSnapshot,
  getRecordFromListingSnapshot,
} from './deleted';

const PAGE_SIZE = 25;

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-US', { hour12: false });
}

function preview(value: string, max = 60): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text || '[Media / Empty Text]';
}

export const ViewOnceCommand: Command = {
  name: 'viewonce',
  aliases: ['vo', 'rvo', 'antivo', 'antiviewonce', 'readviewonce'],
  category: CommandCategory.UTILITY,
  description: 'Unlock and save view-once photos, videos, and voice notes onto deleted-media',
  usage: 'viewonce [number|list [page]|chats] (or reply to a view-once message)',
  examples: [
    'viewonce (by replying to view-once message)',
    'vo',
    'vo 1',
    'vo list',
    'vo list 2',
    'rvo',
    'antivo',
  ],
  inputs: 'Reply to a view-once message or provide item number/page',
  limits: 'Can only recover view-once messages captured while bot is online or in quoted context',
  async execute(ctx) {
    const isOwner = isOwnerOrSelf(ctx);
    if (!isOwner) {
      await ctx.reply('⛔ Access denied. View-once messages can only be viewed and restored by the bot owner and the bot itself.');
      return;
    }

    const currentChatJid = ctx.message.key.remoteJid || ctx.sender.chatJid;
    const arg0 = (ctx.args[0] || '').toLowerCase();
    const arg1 = (ctx.args[1] || '').toLowerCase();

    // =========================================================================
    // CASE 1: USER QUOTED A MESSAGE -> ATTEMPT INSTANT UNLOCK & DECRYPT
    // =========================================================================
    const contextInfo = getQuotedContextInfo(ctx.message.message);
    if (contextInfo?.quotedMessage || contextInfo?.stanzaId) {
      const quotedStanzaId = contextInfo.stanzaId;
      if (quotedStanzaId) {
        const stored = findStoredMessageById(currentChatJid, quotedStanzaId);
        if (stored && stored.media) {
          const buffer = await readDeletedMessageMedia(stored);
          if (buffer) {
            const formatted =
              `👁️ *[VIEW-ONCE RESTORED]*\n` +
              `From: ${stored.senderName}${stored.senderNumber ? ` (${stored.senderNumber})` : ''}\n` +
              `Type: ${stored.messageType}\n` +
              `Saved: ${formatTime((stored as any).deletedAt || stored.timestamp)}\n\n` +
              `${stored.text || ''}`;

            await sendRecoveredMedia(ctx, stored as DeletedMessageRecord, formatted.trim());
            return;
          }
        }
      }

      await ctx.reply('⏳ Decrypting view-once media from quoted message...');
      const savedRecord = await downloadAndCacheQuotedMedia(ctx.socket, contextInfo, currentChatJid, ctx.sender);

      if (savedRecord) {
        const formatted =
          `👁️ *[VIEW-ONCE UNLOCKED]*\n` +
          `From: ${savedRecord.senderName}${savedRecord.senderNumber ? ` (${savedRecord.senderNumber})` : ''}\n` +
          `Type: ${savedRecord.messageType}\n` +
          `Saved: ${formatTime(savedRecord.deletedAt)}\n\n` +
          `${savedRecord.text || ''}`;

        await sendRecoveredMedia(ctx, savedRecord, formatted.trim());
        return;
      }

      await ctx.reply(
        `❌ The quoted message could not be unlocked as view-once media (media expired or withheld by WhatsApp).\n` +
        `👉 Use *${config.BOT_PREFIX}viewonce list* to browse already captured view-once media.`
      );
      return;
    }

    // =========================================================================
    // CASE 2: OWNER SUBCOMMANDS (.vo chats)
    // =========================================================================
    if (isOwner && (arg0 === 'chats' || arg0 === 'groups')) {
      const allVo = getAllViewOnceMessages();
      if (!allVo.length) {
        await ctx.reply('No view-once media captured across any chats yet.');
        return;
      }

      const map = new Map<string, { count: number; lastTime: string; lastSender: string }>();
      for (const item of allVo) {
        const existing = map.get(item.chatJid);
        if (existing) {
          existing.count += 1;
          if (new Date(item.deletedAt).getTime() > new Date(existing.lastTime).getTime()) {
            existing.lastTime = item.deletedAt;
            existing.lastSender = item.senderName;
          }
        } else {
          map.set(item.chatJid, {
            count: 1,
            lastTime: item.deletedAt,
            lastSender: item.senderName,
          });
        }
      }

      const chats = Array.from(map.entries())
        .map(([chatJid, data]) => ({ chatJid, ...data }))
        .sort((a, b) => new Date(b.lastTime).getTime() - new Date(a.lastTime).getTime());

      const lines = chats.map((c, i) => {
        return `${i + 1}. *${formatChatLabel(c.chatJid)}* (${c.count} view-once saved)\n   Last: ${c.lastSender} • ${formatTime(c.lastTime)}\n   JID: \`${c.chatJid}\``;
      });

      await ctx.reply(
        `*Chats with Saved View-Once Media (${chats.length})*\n\n${lines.join('\n\n')}\n\n👉 View with *${config.BOT_PREFIX}viewonce list* or *${config.BOT_PREFIX}viewonce chat <number|jid>*`
      );
      return;
    }

    // Owner subcommand: .vo chat <jid or chat number>
    if (arg0 === 'chat' && arg1) {
      let targetJid = arg1;
      const chatIndex = Number(arg1);
      if (Number.isInteger(chatIndex) && chatIndex >= 1) {
        const allVo = getAllViewOnceMessages();
        const map = new Map<string, number>();
        for (const item of allVo) {
          map.set(item.chatJid, (map.get(item.chatJid) || 0) + 1);
        }
        const chats = Array.from(map.keys());
        if (chatIndex <= chats.length) {
          targetJid = chats[chatIndex - 1];
        }
      }

      const chatRecords = listViewOnceMessages(targetJid, 50);
      if (!chatRecords.length) {
        await ctx.reply(`No view-once media found for chat "${targetJid}".`);
        return;
      }

      const lines = chatRecords.map((record, index) => {
        const mediaTag = record.media ? ` [${record.media.kind}]` : '';
        return `${index + 1}. ${record.senderName}${mediaTag} - ${preview(record.text)} (${formatTime(record.deletedAt)})`;
      });

      await ctx.reply(
        `*Saved View-Once Media for ${formatChatLabel(targetJid)} (${chatRecords.length})*\n\n` +
        `${lines.join('\n')}\n\n` +
        `👉 Send *${config.BOT_PREFIX}viewonce <number>* to restore.`
      );
      return;
    }

    // =========================================================================
    // CASE 3: LIST SAVED VIEW-ONCE MEDIA (GLOBAL FOR OWNER)
    // =========================================================================
    const records = getAllViewOnceMessages();
    const totalCount = records.length;

    if (!totalCount) {
      await ctx.reply(
        `No view-once media saved across any chats yet.\n\n` +
        `💡 *How it works:*\n` +
        `• Incoming view-once photos, videos, and voice notes are automatically intercepted and stored into \`deleted-media\` storage in the background.\n` +
        `• Only the bot owner and the bot itself can view or restore them via *${config.BOT_PREFIX}viewonce* (or *${config.BOT_PREFIX}vo*).`
      );
      return;
    }

    // Listing view-once messages
    if (!arg0 || arg0 === 'list' || arg0 === 'all' || arg0 === 'recent') {
      const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
      const pageArg = arg0 === 'list' || arg0 === 'all' ? arg1 : '';
      let page = 1;

      if (pageArg) {
        const parsedPage = Number(pageArg);
        if (Number.isInteger(parsedPage) && parsedPage >= 1) {
          page = Math.min(totalPages, parsedPage);
        } else {
          await ctx.reply(`Invalid page number "${pageArg}". Available pages: 1 to ${totalPages}`);
          return;
        }
      }

      const startIndex = (page - 1) * PAGE_SIZE;
      const pageRecords = records.slice(startIndex, startIndex + PAGE_SIZE);
      saveListingSnapshot(currentChatJid, ctx.sender.jid, pageRecords, startIndex);

      const lines = pageRecords.map((record, index) => {
        const globalIndex = startIndex + index + 1;
        const chatPrefix = `${formatChatLabel(record.chatJid)} `;
        const mediaTag = record.media ? ` [${record.media.kind}]` : '';
        return `${globalIndex}. ${chatPrefix}${record.senderName}${mediaTag} - ${preview(record.text)} (${formatTime(record.deletedAt)})`;
      });

      const nextPageHint =
        page < totalPages
          ? `📖 Page ${page}/${totalPages} • Use *${config.BOT_PREFIX}viewonce list ${page + 1}* for next page\n`
          : `📖 Page ${page}/${totalPages} (End of list)\n`;

      const text =
        `👁️ *Saved View-Once Media (Owner Vault)*\n` +
        `*Page ${page} of ${totalPages} (Total: ${totalCount} saved items)*\n\n` +
        `${lines.join('\n')}\n\n` +
        `${nextPageHint}` +
        `👉 Send *${config.BOT_PREFIX}viewonce <number>* to retrieve & play media.\n` +
        `👉 Send *${config.BOT_PREFIX}viewonce <number> dm* to send directly to your private chat.\n` +
        `👉 Or reply to any view-once message with *${config.BOT_PREFIX}vo* to unlock it instantly.`;

      await ctx.reply(text);
      return;
    }

    // =========================================================================
    // CASE 4: RETRIEVE SPECIFIC NUMBER (.vo <number> [dm])
    // =========================================================================
    const targetIndex = Number(arg0);
    if (!Number.isInteger(targetIndex) || targetIndex < 1) {
      await ctx.reply(
        `❌ Pick a number from 1 to ${totalCount}, or use *${config.BOT_PREFIX}viewonce list* to browse.\n` +
        `👉 Example: *${config.BOT_PREFIX}viewonce 1* or *${config.BOT_PREFIX}viewonce 1 dm*`
      );
      return;
    }

    const selectedRecord =
      getRecordFromListingSnapshot(currentChatJid, ctx.sender.jid, targetIndex) ||
      records[targetIndex - 1];

    if (!selectedRecord) {
      await ctx.reply(
        `❌ Pick a number from 1 to ${totalCount}, or use *${config.BOT_PREFIX}viewonce list* to browse.\n` +
        `👉 Example: *${config.BOT_PREFIX}viewonce 1* or *${config.BOT_PREFIX}viewonce 1 dm*`
      );
      return;
    }

    // Verify media buffer is available
    const buffer = await readDeletedMessageMedia(selectedRecord);
    if (!buffer || !selectedRecord.media) {
      await ctx.reply(
        `❌ *View-once media #${targetIndex} could not be retrieved*\n` +
        `From: ${selectedRecord.senderName} (${formatTime(selectedRecord.timestamp)})\n\n` +
        `⚠️ *Reason:* The media bytes were withheld by WhatsApp server from companion devices on arrival.\n` +
        `💡 *How to unlock:* Open the chat where this message was sent, reply directly to the view-once message, and type *${config.BOT_PREFIX}vo*.`
      );
      return;
    }

    const sendToDm = arg1 === 'dm' || arg1 === 'private';
    const ownerNumber = config.OWNER_NUMBER?.replace(/\D/g, '');
    const botNumber = ctx.socket.user?.id?.split(':')[0]?.replace(/\D/g, '');
    const ownerJid = ownerNumber ? `${ownerNumber}@s.whatsapp.net` : (botNumber ? `${botNumber}@s.whatsapp.net` : null);

    const formatted = formatRecord(selectedRecord, targetIndex, true);

    if (sendToDm && ownerJid) {
      const dmCtx = {
        ...ctx,
        message: {
          ...ctx.message,
          key: { ...ctx.message.key, remoteJid: ownerJid },
        },
      };
      await sendRecoveredMedia(dmCtx, selectedRecord, formatted);
      await ctx.reply(`✅ Restored view-once media sent to your private chat.`);
      return;
    }

    await sendRecoveredMedia(ctx, selectedRecord, formatted);
  },
};

export default ViewOnceCommand;
