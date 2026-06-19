import { textUtils } from '../../services/text-utils';
import { Command, CommandCategory } from '../../types';

export const UpsideDownCommand: Command = {
  name: 'upside',
  aliases: ['upsidedown', 'fliptext'],
  category: CommandCategory.UTILITY,
  description: 'Turn text upside down',
  usage: 'upside <text>',
  async execute(ctx) {
    const text = ctx.args.join(' ');

    if (!text) {
      await ctx.reply('Usage: .upside <text>');
      return;
    }

    await ctx.reply(textUtils.upsideDown(text));
  },
};

export default UpsideDownCommand;
