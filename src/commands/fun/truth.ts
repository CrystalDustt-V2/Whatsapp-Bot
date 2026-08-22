import { Command, CommandCategory } from '../../types';
import randomData from '../../services/random-data';
import aiService from '../../services/ai-service';

export const TruthCommand: Command = {
  name: 'truth',
  aliases: ['t', 'truthquestion'],
  category: CommandCategory.FUN,
  description: 'Get a spicy, deep, or funny Truth question',
  usage: 'truth [mild|spicy|deep]',
  async execute(ctx) {
    const intensity = ctx.args[0]?.toLowerCase();

    // 1. If intensity specified, query AI for custom mood
    if (intensity && ['mild', 'spicy', 'deep', 'funny', 'extreme'].includes(intensity)) {
      try {
        const aiRes = await aiService.chat(
          [
            { role: 'system', content: `You are a Truth or Dare game master. Generate 1 ${intensity} Truth question that is engaging and thought-provoking. Return ONLY the question text.` },
            { role: 'user', content: `Give me 1 ${intensity} truth question.` },
          ],
          { maxTokens: 100, temperature: 0.9 }
        );
        const question = aiRes.text.trim().replace(/^["']|["']$/g, '');
        if (question) {
          await ctx.reply(`🎭 *TRUTH (${intensity.toUpperCase()}):*\n\n${question}`);
          return;
        }
      } catch {
        // Fallback
      }
    }

    // 2. Query TruthOrDareBot API
    try {
      const response = await fetch('https://api.truthordarebot.xyz/v1/truth', {
        headers: { 'User-Agent': 'WhatsAppHybridBot/1.0' },
      });
      if (response.ok) {
        const data = (await response.json()) as { question?: string };
        if (data.question) {
          await ctx.reply(`🎭 *TRUTH:*\n\n${data.question}`);
          return;
        }
      }
    } catch {
      // Fallback
    }

    // 3. Fallback to local dataset
    const truth = randomData.getTruth();
    await ctx.reply(`🎭 *TRUTH:*\n\n${truth}`);
  },
};

export default TruthCommand;
