import { Command, CommandCategory } from '../../types';
import textUtils from '../../services/text-utils';

export const UrlEncodeCommand: Command = {
  name: 'urlencode',
  aliases: ['urlenc'],
  category: CommandCategory.UTILITY,
  description: 'URL encode text',
  usage: 'urlencode <text>',
  async execute(ctx) {
    if (!ctx.args.length) {
      await ctx.socket.sendMessage(ctx.message.key.remoteJid!, { text: 'Usage: .urlencode <text>' });
      return;
    }

    const text = ctx.args.join(' ');
    const encoded = textUtils.urlEncode(text);

    await ctx.socket.sendMessage(ctx.message.key.remoteJid!, { text: encoded });
  },
};

export default UrlEncodeCommand;
