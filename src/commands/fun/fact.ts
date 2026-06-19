import { Command, CommandCategory } from '../../types';
import randomData from '../../services/random-data';

export const FactCommand: Command = {
  name: 'fact',
  aliases: ['f'],
  category: CommandCategory.FUN,
  description: 'Get a random fun fact',
  usage: 'fact',
  async execute(ctx) {
    const fact = randomData.getFact();
    await ctx.socket.sendMessage(ctx.message.key.remoteJid!, { 
      text: `🤓 Fun fact:\n\n${fact}` 
    });
  },
};

export default FactCommand;
