import { Command, CommandCategory } from '../../types';
import randomData from '../../services/random-data';

export const DareCommand: Command = {
  name: 'dare',
  aliases: ['d'],
  category: CommandCategory.FUN,
  description: 'Get a random dare',
  usage: 'dare',
  async execute(ctx) {
    const dare = randomData.getDare();
    await ctx.socket.sendMessage(ctx.message.key.remoteJid!, { 
      text: `🎲 DARE:\n\n${dare}` 
    });
  },
};

export default DareCommand;
