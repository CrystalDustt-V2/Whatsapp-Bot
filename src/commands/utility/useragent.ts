import { parseUserAgent } from '../../services/user-agent';
import { Command, CommandCategory } from '../../types';

export const UserAgentCommand: Command = {
  name: 'useragent',
  aliases: ['ua', 'parseua', 'uaparse', 'deviceinfo'],
  category: CommandCategory.NETWORK,
  description: 'Parse a browser user agent string',
  usage: 'useragent <user-agent>',
  async execute(ctx) {
    const userAgent = ctx.args.join(' ').trim();
    if (!userAgent) {
      await ctx.reply('Usage: .useragent <user-agent>');
      return;
    }

    const parsed = parseUserAgent(userAgent);
    await ctx.reply(
      `Browser: ${parsed.browser}\n` +
        `OS: ${parsed.os}\n` +
        `Device: ${parsed.device}\n` +
        `Engine: ${parsed.engine}`
    );
  },
};

export default UserAgentCommand;
