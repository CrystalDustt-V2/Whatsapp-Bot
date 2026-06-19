import { Command, CommandCategory } from '../../types';
import randomData from '../../services/random-data';

export const PickupLineCommand: Command = {
  name: 'pickupline',
  aliases: ['pickup', 'pl'],
  category: CommandCategory.FUN,
  description: 'Get a random pickup line',
  usage: 'pickupline',
  async execute(ctx) {
    const line = randomData.getPickupLine();
    await ctx.socket.sendMessage(ctx.message.key.remoteJid!, { 
      text: `💕 ${line}` 
    });
  },
};

export default PickupLineCommand;
