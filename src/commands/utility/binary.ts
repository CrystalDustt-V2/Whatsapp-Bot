import { Command, CommandCategory } from '../../types';
import textUtils from '../../services/text-utils';

export const BinaryCommand: Command = {
  name: 'binary',
  aliases: ['bin'],
  category: CommandCategory.UTILITY,
  description: 'Encode or decode binary',
  usage: 'binary encode/decode <text>',
  async execute(ctx) {
    if (ctx.args.length < 2) {
      await ctx.reply('Usage: .binary encode/decode <text>');
      return;
    }

    const mode = ctx.args[0].toLowerCase();
    const text = ctx.args.slice(1).join(' ');

    if (mode === 'encode') {
      const encoded = textUtils.binaryEncode(text);
      await ctx.reply(encoded);
    } else if (mode === 'decode') {
      const decoded = textUtils.binaryDecode(text);
      await ctx.reply(decoded);
    } else {
      await ctx.reply('Usage: .binary encode/decode <text>');
    }
  },
};

export default BinaryCommand;
