import { Command, CommandCategory } from '../types';

export const AboutCommand: Command = {
  name: 'about',
  aliases: ['info', 'botinfo'],
  category: CommandCategory.CORE,
  description: 'Show bot information',
  usage: 'about',
  async execute(ctx) {
    const text =
      `🤖 *CrystalDust V0*
      \n━━━━━━━━━━━━━━━━━━━\n\n` +
      `📋 *Platform: Windows\n` +
      `📦 *Version:* 1.0.0\n` +
      `👤 *Owner:* CrystalDust\n` +
      `━━━━━━━━━━━━━━━━━━━\n\n`;

    await ctx.socket.sendMessage(
      ctx.message.key.remoteJid!,
      { text },
      { quoted: ctx.message }
    );
  },
};

export default AboutCommand;
