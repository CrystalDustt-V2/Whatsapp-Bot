import { Command, CommandCategory } from '../../types';
import textUtils from '../../services/text-utils';

export const PasswordCommand: Command = {
  name: 'password',
  aliases: ['pass', 'pwd'],
  category: CommandCategory.UTILITY,
  description: 'Generate a random password',
  usage: 'password [length]',
  async execute(ctx) {
    let length = 16;

    if (ctx.args.length) {
      const parsed = parseInt(ctx.args[0]);
      if (!isNaN(parsed) && parsed > 0 && parsed <= 128) {
        length = parsed;
      }
    }

    const password = textUtils.generatePassword(length);
    await ctx.socket.sendMessage(ctx.message.key.remoteJid!, { text: `🔐 Generated password: ${password}` });
  },
};

export default PasswordCommand;
