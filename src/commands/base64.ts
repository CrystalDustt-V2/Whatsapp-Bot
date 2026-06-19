import { Command, CommandCategory } from '../types';

export const Base64Command: Command = {
  name: 'base64',
  aliases: ['b64'],
  category: CommandCategory.UTILITY,
  description: 'Encode/decode Base64',
  usage: 'base64 <encode|decode> <text>',
  async execute(ctx) {
    const [mode, ...textParts] = ctx.args;
    const text = textParts.join(' ');

    if (!mode || !text) {
      await ctx.socket.sendMessage(
        ctx.message.key.remoteJid!,
        { text: `Usage: ${ctx.message.key.remoteJid?.includes('g.us') ? '' : '.'}base64 <encode|decode> <text>` },
        { quoted: ctx.message }
      );
      return;
    }

    try {
      let result: string;

      if (mode.toLowerCase() === 'encode') {
        result = Buffer.from(text).toString('base64');
      } else if (mode.toLowerCase() === 'decode') {
        result = Buffer.from(text, 'base64').toString('utf-8');
      } else {
        await ctx.socket.sendMessage(
          ctx.message.key.remoteJid!,
          { text: 'Invalid mode! Use encode or decode.' },
          { quoted: ctx.message }
        );
        return;
      }

      await ctx.socket.sendMessage(
        ctx.message.key.remoteJid!,
        { text: `📝 Result:\n${result}` },
        { quoted: ctx.message }
      );
    } catch (err) {
      await ctx.socket.sendMessage(
        ctx.message.key.remoteJid!,
        { text: 'Error processing Base64!' },
        { quoted: ctx.message }
      );
    }
  },
};

export default Base64Command;
