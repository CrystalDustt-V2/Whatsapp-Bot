import { Command, CommandCategory } from '../../types';
import randomData from '../../services/random-data';

export const WouldYouRatherCommand: Command = {
  name: 'wouldyourather',
  aliases: ['wyr', 'wouldyou'],
  category: CommandCategory.FUN,
  description: 'Get a random "Would you rather?" question',
  usage: 'wouldyourather',
  async execute(ctx) {
    const wyr = randomData.getWouldYouRather();
    await ctx.socket.sendMessage(ctx.message.key.remoteJid!, { 
      text: `🤔 WOULD YOU RATHER:\n\n${wyr}` 
    });
  },
};

export default WouldYouRatherCommand;
