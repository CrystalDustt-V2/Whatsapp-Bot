import { Command, CommandCategory } from '../../types';
import textUtils, { FontStyle } from '../../services/text-utils';

export const FancyCommand: Command = {
  name: 'fancy',
  aliases: ['font'],
  category: CommandCategory.UTILITY,
  description: 'Convert text to fancy circled font',
  usage: 'fancy <text>',
  async execute(ctx) {
    if (!ctx.args.length) {
      await ctx.reply('Usage: .fancy <text>');
      return;
    }

    const text = ctx.args.join(' ');
    const fancy = textUtils.applyFont(text, FontStyle.CIRCLED);

    await ctx.reply(fancy);
  },
};

export default FancyCommand;
