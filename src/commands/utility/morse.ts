import { Command, CommandCategory } from '../../types';
import textUtils from '../../services/text-utils';

export const MorseCommand: Command = {
  name: 'morse',
  aliases: [],
  category: CommandCategory.UTILITY,
  description: 'Encode or decode Morse code',
  usage: 'morse encode/decode <text>',
  async execute(ctx) {
    if (ctx.args.length < 2) {
      await ctx.reply('Usage: .morse encode/decode <text>');
      return;
    }

    const mode = ctx.args[0].toLowerCase();
    const text = ctx.args.slice(1).join(' ');

    if (mode === 'encode') {
      const encoded = textUtils.morseEncode(text);
      await ctx.reply(encoded);
    } else if (mode === 'decode') {
      const decoded = textUtils.morseDecode(text);
      await ctx.reply(decoded);
    } else {
      await ctx.reply('Usage: .morse encode/decode <text>');
    }
  },
};

export default MorseCommand;
