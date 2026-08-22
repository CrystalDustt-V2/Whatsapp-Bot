import { Command, CommandCategory } from '../../types';
import randomData from '../../services/random-data';
import aiService from '../../services/ai-service';

export const WouldYouRatherCommand: Command = {
  name: 'wouldyourather',
  aliases: ['wyr', 'wouldyou'],
  category: CommandCategory.FUN,
  description: 'Get a thought-provoking "Would you rather?" dilemma',
  usage: 'wouldyourather [topic]',
  async execute(ctx) {
    const topic = ctx.args.join(' ').trim();

    // 1. If topic specified, use AI to generate tailored dilemma
    if (topic) {
      try {
        const aiRes = await aiService.chat(
          [
            { role: 'system', content: 'You are a master of tough dilemmas. Generate 1 creative "Would you rather..." question tailored to the topic. Return ONLY the question.' },
            { role: 'user', content: `Give me a Would You Rather dilemma about: ${topic}` },
          ],
          { maxTokens: 100, temperature: 0.9 }
        );
        const question = aiRes.text.trim().replace(/^["']|["']$/g, '');
        if (question) {
          await ctx.reply(`🤔 *WOULD YOU RATHER (${topic}):*\n\n${question}`);
          return;
        }
      } catch {
        // Fallback
      }
    }

    // 2. Query TruthOrDareBot WYR API
    try {
      const response = await fetch('https://api.truthordarebot.xyz/v1/wyr', {
        headers: { 'User-Agent': 'WhatsAppHybridBot/1.0' },
      });
      if (response.ok) {
        const data = (await response.json()) as { question?: string };
        if (data.question) {
          await ctx.reply(`🤔 *WOULD YOU RATHER:*\n\n${data.question}`);
          return;
        }
      }
    } catch {
      // Fallback
    }

    // 3. Fallback to local dataset
    const wyr = randomData.getWouldYouRather();
    await ctx.reply(`🤔 *WOULD YOU RATHER:*\n\n${wyr}`);
  },
};

export default WouldYouRatherCommand;
