import { Command, CommandCategory } from '../../types';
import textUtils from '../../services/text-utils';

export const UrlDecodeCommand: Command = {
  name: 'urldecode',
  aliases: ['urldec'],
  category: CommandCategory.UTILITY,
  description: 'URL decode text',
  usage: 'urldecode <text>',
  async execute(ctx) {
    if (!ctx.args.length) {
      await ctx.socket.sendMessage(ctx.message.key.remoteJid!, { text: 'Usage: .urldecode <text>' });
      return;
    }

    const text = ctx.args.join(' ');
    const decoded = textUtils.urlDecode(text);

    await ctx.socket.sendMessage(ctx.message.key.remoteJid!, { text: decoded });
  },
};

export default UrlDecodeCommand;
