import { Command, CommandCategory } from '../types';

export const PingCommand: Command = {
  name: 'ping',
  aliases: ['p'],
  category: CommandCategory.CORE,
  description: 'Check bot latency',
  usage: 'ping',
  async execute(ctx) {
    const start = Date.now();
    const sentMsg = await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
      text: 'Pinging...',
    });
    const latency = Date.now() - start;

    await ctx.socket.sendMessage(
      ctx.message.key.remoteJid!,
      {
        text: `🏓 Pong!\nLatency: ${latency}ms`,
        edit: sentMsg?.key,
      },
      {
        quoted: ctx.message,
      }
    );
  },
};

export default PingCommand;
