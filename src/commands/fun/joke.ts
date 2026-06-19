import { Command, CommandCategory } from '../../types';
import randomData from '../../services/random-data';

export const JokeCommand: Command = {
  name: 'joke',
  aliases: ['j'],
  category: CommandCategory.FUN,
  description: 'Get a random joke',
  usage: 'joke',
  async execute(ctx) {
    const joke = randomData.getJoke();
    await ctx.reply(`Here's a joke:\n\n${joke}`);
  },
};

export default JokeCommand;
