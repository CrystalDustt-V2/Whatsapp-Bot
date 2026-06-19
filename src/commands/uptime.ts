import { Command, CommandCategory } from '../types';
import { formatDuration } from '../services/bot-info';

export const UptimeCommand: Command = {
  name: 'uptime',
  aliases: ['runtime', 'up'],
  category: CommandCategory.CORE,
  description: 'Show bot uptime',
  usage: 'uptime',
  async execute(ctx) {
    await ctx.reply(`*Bot Uptime*\n${formatDuration(process.uptime())}`);
  },
};

export default UptimeCommand;
