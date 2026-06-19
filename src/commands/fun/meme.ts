import { Command, CommandCategory } from '../../types';
import randomData from '../../services/random-data';

export const MemeCommand: Command = {
  name: 'meme',
  aliases: ['mem'],
  category: CommandCategory.FUN,
  description: 'Get a random meme',
  usage: 'meme',
  async execute(ctx) {
    const meme = randomData.getMeme();
    await ctx.socket.sendMessage(ctx.message.key.remoteJid!, { 
      text: `😂 ${meme}` 
    });
  },
};

export default MemeCommand;
