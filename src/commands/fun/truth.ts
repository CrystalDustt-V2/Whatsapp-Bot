import { Command, CommandCategory } from '../../types';
import randomData from '../../services/random-data';

export const TruthCommand: Command = {
  name: 'truth',
  aliases: ['t'],
  category: CommandCategory.FUN,
  description: 'Get a random truth question',
  usage: 'truth',
  async execute(ctx) {
    const truth = randomData.getTruth();
    await ctx.reply(`TRUTH:\n\n${truth}`);
  },
};

export default TruthCommand;
