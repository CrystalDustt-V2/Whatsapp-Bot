import { parseDuration } from '../../services/duration';
import { Command, CommandCategory } from '../../types';
import { getReminderService, MAX_REMINDER_MS, MAX_REMINDER_TEXT } from '../../services/reminders';
import logger from '../../core/logger';

export const ReminderCommand: Command = {
  name: 'remind',
  aliases: ['reminder', 'ingatkan'],
  category: CommandCategory.UTILITY,
  description: 'Set a saved reminder, list your reminders, or cancel one',
  usage: 'remind <10m|2h|1d> <message> | list | cancel <id>',
  examples: ['remind 10m Drink water', 'remind list', 'remind cancel <id>'],
  limits: 'Maximum 7 days, 1000 characters, 100 active reminders',
  async execute(ctx) {
    const chatJid = ctx.message.key.remoteJid;
    if (!chatJid) return;
    const ownerId = ctx.sender.phoneNumber || ctx.sender.jid;
    try {
      const reminders = getReminderService();
      if (ctx.args[0]?.toLowerCase() === 'list') {
        if (ctx.args.length !== 1) { await ctx.reply('Usage: .remind list'); return; }
        const items = reminders.list(chatJid, ownerId);
        if (!items.length) { await ctx.reply('You have no active reminders in this chat.'); return; }
        const text = items.map((item) => `${item.id}\nDue (UTC): ${new Date(item.dueAt).toISOString()}\n${item.text.slice(0, 80)}${item.text.length > 80 ? '…' : ''}`).join('\n\n');
        for (const chunk of text.match(/[\s\S]{1,3500}/gu) || []) await ctx.reply(chunk);
        return;
      }
      if (ctx.args[0]?.toLowerCase() === 'cancel') {
        if (ctx.args.length !== 2) { await ctx.reply('Usage: .remind cancel <id>'); return; }
        await ctx.reply(reminders.cancel(ctx.args[1], chatJid, ownerId)
          ? 'Reminder cancelled.' : 'Reminder not found in your reminders for this chat.');
        return;
      }
      const duration = parseDuration(ctx.args[0] || '', {
        maxMilliseconds: MAX_REMINDER_MS,
      });
      const text = (ctx.rawArgs ?? ctx.args.join(' ')).trim().replace(/^\S+\s*/, '').trim();

      if (!duration || !text) {
        await ctx.reply('Usage: .remind <10m|2h|1d> <message>\nMaximum: 7 days');
        return;
      }

      if (text.length > MAX_REMINDER_TEXT) {
        await ctx.reply(`Reminder text must be at most ${MAX_REMINDER_TEXT} characters.`);
        return;
      }

      const reminder = reminders.add({ chatJid, ownerId, ownerJid: ctx.sender.jid, text, dueAt: Date.now() + duration.milliseconds });
      await ctx.reply(`Reminder set for ${duration.label}: ${text}\nID: ${reminder.id}\nCancel: .remind cancel ${reminder.id}`);
    } catch (err) {
      logger.warn({ err }, 'Reminder command failed');
      await ctx.reply(err instanceof Error && err.message.startsWith('Reminder queue is full')
        ? err.message : 'Could not save or load reminders. Please try again later.');
    }
  },
};

export default ReminderCommand;
