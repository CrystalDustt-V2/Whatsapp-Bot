import { Command, CommandCategory } from '../../types';
import randomData from '../../services/random-data';

async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'WhatsAppHybridBot/1.0' } });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export const MemeCommand: Command = {
  name: 'meme',
  aliases: ['mem', 'randommeme'],
  category: CommandCategory.FUN,
  description: 'Get a random image meme or joke meme',
  usage: 'meme',
  async execute(ctx) {
    try {
      const response = await fetch('https://meme-api.com/gimme', {
        headers: { 'User-Agent': 'WhatsAppHybridBot/1.0' },
      });

      if (response.ok) {
        const data = await response.json() as {
          title?: string;
          url?: string;
          subreddit?: string;
          author?: string;
          ups?: number;
        };

        if (data.url && (data.url.endsWith('.jpg') || data.url.endsWith('.png') || data.url.endsWith('.jpeg') || data.url.endsWith('.gif') || data.url.endsWith('.webp'))) {
          const imageBuffer = await fetchImage(data.url);
          if (imageBuffer) {
            const caption = [
              `*${data.title || 'Meme'}*`,
              data.subreddit ? `r/${data.subreddit}${data.ups ? ` (👍 ${data.ups})` : ''}` : undefined,
            ].filter(Boolean).join('\n');

            await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
              image: imageBuffer,
              caption,
            });
            return;
          }
        }
      }
    } catch {
      // Fallback to local text memes
    }

    const meme = randomData.getMeme();
    await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
      text: `😂 ${meme}`,
    });
  },
};

export default MemeCommand;
