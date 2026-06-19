import { Command, CommandCategory } from '../../types';
import textUtils from '../../services/text-utils';

export const ReverseCommand: Command = {
  name: 'reverse',
  aliases: ['rev'],
  category: CommandCategory.UTILITY,
  description: 'Reverse text',
  usage: 'reverse <text>',
  async execute(ctx) {
    if (!ctx.args.length) {
      await ctx.reply('Usage: .reverse <text>');
      return;
    }

    const text = ctx.args.join(' ');
    const reversed = textUtils.reverse(text);

    await ctx.reply(reversed);
  },
};

export default ReverseCommand;
