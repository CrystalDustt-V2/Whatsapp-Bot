import { Command, CommandCategory } from '../types';

export const AboutCommand: Command = {
  name: 'about',
  aliases: ['info', 'botinfo'],
  category: CommandCategory.CORE,
  description: 'Show bot information',
  usage: 'about',
  async execute(ctx) {
    const text = `🤖 *WhatsApp Hybrid Bot\n━━━━━━━━━━━━━━━━━━━\n\n` +
      `📋 *Platform: WhatsApp Hybrid Bot Platform\n` +
      `📦 *Version:* 1.0.0\n` +
      `🛠️ *Tech Stack:* Node.js, TypeScript, Baileys\n` +
      `━━━━━━━━━━━━━━━━━━━\n\n` +
      `Production-grade modular WhatsApp automation platform with hybrid operation mode!`;

    await ctx.socket.sendMessage(
      ctx.message.key.remoteJid!,
      { text },
      { quoted: ctx.message }
    );
  },
};

export default AboutCommand;
