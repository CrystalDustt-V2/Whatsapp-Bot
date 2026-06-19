import { Command, CommandCategory } from '../../types';
import randomData from '../../services/random-data';

export const QuoteCommand: Command = {
  name: 'quote',
  aliases: ['q'],
  category: CommandCategory.FUN,
  description: 'Get a random quote',
  usage: 'quote',
  async execute(ctx) {
    const quote = randomData.getQuote();
    await ctx.reply(`"${quote.text}"\n- ${quote.author}`);
  },
};

export default QuoteCommand;
