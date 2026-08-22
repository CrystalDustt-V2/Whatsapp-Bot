import { Command, CommandCategory } from '../../types';
import randomData from '../../services/random-data';
import aiService from '../../services/ai-service';

export const FactCommand: Command = {
  name: 'fact',
  aliases: ['f', 'funfact', 'facts'],
  category: CommandCategory.FUN,
  description: 'Get an interesting random fact',
  usage: 'fact [topic]',
  async execute(ctx) {
    const topic = ctx.args.join(' ').trim();

    // 1. If topic specified, use AI to generate fact on that topic
    if (topic) {
      try {
        const aiRes = await aiService.chat(
          [
            { role: 'system', content: 'You are a fun science & trivia expert. Provide 1 fascinating, verified, and mind-blowing fact on the user topic. Keep it concise (1-2 sentences).' },
            { role: 'user', content: `Give me 1 interesting fun fact about: ${topic}` },
          ],
          { maxTokens: 120, temperature: 0.8 }
        );
        const text = aiRes.text.trim();
        if (text) {
          await ctx.reply(`🤓 *Fun Fact (${topic}):*\n\n${text}`);
          return;
        }
      } catch {
        // Fallback
      }
    }

    // 2. Query live UselessFacts API
    try {
      const response = await fetch('https://uselessfacts.jsph.pl/api/v2/facts/random?language=en', {
        headers: { 'User-Agent': 'WhatsAppHybridBot/1.0' },
      });
      if (response.ok) {
        const data = (await response.json()) as { text?: string };
        if (data.text) {
          await ctx.reply(`🤓 *Fun Fact:*\n\n${data.text}`);
          return;
        }
      }
    } catch {
      // Fallback
    }

    // 3. Fallback to local fact database
    const fact = randomData.getFact();
    await ctx.reply(`🤓 *Fun Fact:*\n\n${fact}`);
  },
};

export default FactCommand;
