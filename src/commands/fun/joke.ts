import { Command, CommandCategory } from '../../types';
import randomData from '../../services/random-data';

export const JokeCommand: Command = {
  name: 'joke',
  aliases: ['j', 'jokes'],
  category: CommandCategory.FUN,
  description: 'Get a random joke',
  usage: 'joke',
  async execute(ctx) {
    try {
      const response = await fetch('https://v2.jokeapi.dev/joke/Any?safe-mode', {
        headers: { 'User-Agent': 'WhatsAppHybridBot/1.0' },
      });

      if (response.ok) {
        const data = await response.json() as {
          type?: 'single' | 'twopart';
          joke?: string;
          setup?: string;
          delivery?: string;
        };

        if (data.type === 'single' && data.joke) {
          await ctx.reply(`😂 *Joke:*\n\n${data.joke}`);
          return;
        }

        if (data.type === 'twopart' && data.setup && data.delivery) {
          await ctx.reply(`😂 *Joke:*\n\n${data.setup}\n\n${data.delivery}`);
          return;
        }
      }
    } catch {
      // Fallback
    }

    const joke = randomData.getJoke();
    await ctx.reply(`😂 *Joke:*\n\n${joke}`);
  },
};

export default JokeCommand;
