import { Command, CommandCategory } from '../../types';
import randomData from '../../services/random-data';

export const QuoteCommand: Command = {
  name: 'quote',
  aliases: ['q', 'quotes', 'motivation'],
  category: CommandCategory.FUN,
  description: 'Get an inspirational or philosophical quote',
  usage: 'quote',
  async execute(ctx) {
    try {
      const response = await fetch('https://dummyjson.com/quotes/random', {
        headers: { 'User-Agent': 'WhatsAppHybridBot/1.0' },
      });

      if (response.ok) {
        const data = await response.json() as { quote?: string; author?: string };
        if (data.quote) {
          await ctx.reply(`📜 *Quote:*\n\n"${data.quote}"\n\n— *${data.author || 'Unknown'}*`);
          return;
        }
      }
    } catch {
      // Fallback
    }

    const quote = randomData.getQuote();
    await ctx.reply(`📜 *Quote:*\n\n"${quote.text}"\n\n— *${quote.author}*`);
  },
};

export default QuoteCommand;
