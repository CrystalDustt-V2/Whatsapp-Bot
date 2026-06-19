import { Command, CommandCategory } from '../../types';
import { parseDuration } from '../../services/duration';

export const CountdownCommand: Command = {
  name: 'countdown',
  aliases: ['timer'],
  category: CommandCategory.UTILITY,
  description: 'Start a short countdown timer',
  usage: 'countdown <10s|5m|1h> [label]',
  async execute(ctx) {
    const duration = parseDuration(ctx.args[0] || '', {
      maxMilliseconds: 60 * 60 * 1000,
    });

    if (!duration) {
      await ctx.reply('Usage: .countdown <10s|5m|1h> [label]\nMaximum: 1 hour');
      return;
    }

    const label = ctx.args.slice(1).join(' ').trim();
    await ctx.reply(`Countdown started: ${duration.label}${label ? ` for ${label}` : ''}`);

    setTimeout(() => {
      ctx.reply(`Countdown finished${label ? `: ${label}` : ''}`).catch(() => undefined);
    }, duration.milliseconds);
  },
};

export default CountdownCommand;
