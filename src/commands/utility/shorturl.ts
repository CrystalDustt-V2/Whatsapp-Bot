import { normalizeHttpUrl } from '../../services/network-tools';
import { Command, CommandCategory } from '../../types';

export const ShortUrlCommand: Command = {
  name: 'shorturl',
  aliases: ['shorten', 'tinyurl'],
  category: CommandCategory.UTILITY,
  description: 'Shorten a URL with TinyURL',
  usage: 'shorturl <url>',
  async execute(ctx) {
    const url = normalizeHttpUrl(ctx.args[0] || '');
    if (!url) {
      await ctx.reply('Usage: .shorturl <url>');
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`, {
        signal: controller.signal,
      });
      const shortUrl = (await response.text()).trim();

      if (!response.ok || !normalizeHttpUrl(shortUrl)) {
        await ctx.reply('Could not shorten that URL.');
        return;
      }

      await ctx.reply(`Short URL: ${shortUrl}`);
    } catch (err) {
      await ctx.reply('Could not shorten that URL.');
    } finally {
      clearTimeout(timeout);
    }
  },
};

export default ShortUrlCommand;
