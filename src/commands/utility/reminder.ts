import { parseDuration } from '../../services/duration';
import { Command, CommandCategory } from '../../types';

const MAX_REMINDER_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ACTIVE_REMINDERS = 100;
let activeReminders = 0;

export const ReminderCommand: Command = {
  name: 'remind',
  aliases: ['reminder', 'ingatkan'],
  category: CommandCategory.UTILITY,
  description: 'Set an in-memory reminder',
  usage: 'remind <10m|2h|1d> <message>',
  async execute(ctx) {
    const duration = parseDuration(ctx.args[0] || '', {
      maxMilliseconds: MAX_REMINDER_MS,
    });
    const text = ctx.args.slice(1).join(' ').trim();

    if (!duration || !text) {
      await ctx.reply('Usage: .remind <10m|2h|1d> <message>\nMaximum: 7 days');
      return;
    }

    if (activeReminders >= MAX_ACTIVE_REMINDERS) {
      await ctx.reply('Reminder queue is full. Try again after an active reminder finishes.');
      return;
    }

    activeReminders += 1;
    await ctx.reply(`Reminder set for ${duration.label}: ${text}`);

    setTimeout(() => {
      activeReminders = Math.max(0, activeReminders - 1);
      ctx.reply(`Reminder: ${text}`).catch(() => undefined);
    }, duration.milliseconds);
  },
};

export default ReminderCommand;
