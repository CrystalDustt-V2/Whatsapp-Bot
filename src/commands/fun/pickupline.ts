import { Command, CommandCategory } from '../../types';
import randomData from '../../services/random-data';
import aiService from '../../services/ai-service';

export const PickupLineCommand: Command = {
  name: 'pickupline',
  aliases: ['pickup', 'pl', 'rizz'],
  category: CommandCategory.FUN,
  description: 'Get a smooth, funny, or creative pickup line',
  usage: 'pickupline [target or vibe]',
  async execute(ctx) {
    const topic = ctx.args.join(' ').trim();

    // 1. Try AI Generation if target/vibe or active
    try {
      const prompt = topic
        ? `Give me 1 creative, charming, or hilarious pickup line suitable for: "${topic}". Return ONLY the pickup line text without quotes or preamble.`
        : `Give me 1 smooth, clever, or funny modern pickup line. Return ONLY the pickup line text without quotes or preamble.`;

      const aiRes = await aiService.chat(
        [
          { role: 'system', content: 'You are a charming, witty wingman. Return only 1 single pickup line.' },
          { role: 'user', content: prompt },
        ],
        { maxTokens: 100, temperature: 0.9 }
      );

      const generated = aiRes.text.trim().replace(/^["']|["']$/g, '');
      if (generated && generated.length > 5) {
        await ctx.reply(`💕 *Pickup Line:*\n\n${generated}`);
        return;
      }
    } catch {
      // Fallback
    }

    // 2. Try online APIs
    try {
      const response = await fetch('https://api.popcat.xyz/pickupline', {
        headers: { 'User-Agent': 'WhatsAppHybridBot/1.0' },
      });
      if (response.ok) {
        const data = (await response.json()) as { pickupline?: string };
        if (data.pickupline) {
          await ctx.reply(`💕 *Pickup Line:*\n\n${data.pickupline}`);
          return;
        }
      }
    } catch {
      // Fallback
    }

    // 3. Fallback to local dataset
    const line = randomData.getPickupLine();
    await ctx.reply(`💕 *Pickup Line:*\n\n${line}`);
  },
};

export default PickupLineCommand;
