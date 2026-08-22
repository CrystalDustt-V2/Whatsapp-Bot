import { Command, CommandCategory } from '../../types';
import randomData from '../../services/random-data';
import aiService from '../../services/ai-service';

export const DareCommand: Command = {
  name: 'dare',
  aliases: ['d', 'darechallenge'],
  category: CommandCategory.FUN,
  description: 'Get a wild, funny, or bold Dare challenge',
  usage: 'dare [mild|funny|hard]',
  async execute(ctx) {
    const mood = ctx.args[0]?.toLowerCase();

    // 1. If mood specified, query AI for custom dare
    if (mood && ['mild', 'funny', 'hard', 'spicy', 'extreme'].includes(mood)) {
      try {
        const aiRes = await aiService.chat(
          [
            { role: 'system', content: `You are a Truth or Dare game master. Generate 1 ${mood} Dare challenge that is hilarious and safe for messaging chats. Return ONLY the dare text.` },
            { role: 'user', content: `Give me 1 ${mood} dare challenge.` },
          ],
          { maxTokens: 100, temperature: 0.9 }
        );
        const dareText = aiRes.text.trim().replace(/^["']|["']$/g, '');
        if (dareText) {
          await ctx.reply(`🎲 *DARE (${mood.toUpperCase()}):*\n\n${dareText}`);
          return;
        }
      } catch {
        // Fallback
      }
    }

    // 2. Query TruthOrDareBot API
    try {
      const response = await fetch('https://api.truthordarebot.xyz/v1/dare', {
        headers: { 'User-Agent': 'WhatsAppHybridBot/1.0' },
      });
      if (response.ok) {
        const data = (await response.json()) as { question?: string };
        if (data.question) {
          await ctx.reply(`🎲 *DARE:*\n\n${data.question}`);
          return;
        }
      }
    } catch {
      // Fallback
    }

    // 3. Fallback to local dataset
    const dare = randomData.getDare();
    await ctx.reply(`🎲 *DARE:*\n\n${dare}`);
  },
};

export default DareCommand;
