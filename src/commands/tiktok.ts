import {
  downloadTikTokAudioFile,
  downloadTikTokVideo,
  isTikTokUrl,
} from '../services/tiktok-downloader';
import { Command, CommandCategory } from '../types';

type TikTokFormat = 'audio' | 'video';

function getUrl(args: string[]): string | null {
  const value = args[0]?.trim();
  return value && isTikTokUrl(value) ? value : null;
}

function getFormat(value: string | undefined): TikTokFormat | null {
  if (!value) return 'video';
  const normalized = value.toLowerCase();
  return normalized === 'audio' || normalized === 'video' ? normalized : null;
}

async function sendTikTok(ctx: Parameters<Command['execute']>[0], url: string, format: TikTokFormat): Promise<void> {
  if (format === 'audio') {
    await ctx.reply('Exporting TikTok audio...');
    const audio = await downloadTikTokAudioFile(url);
    await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
      audio: audio.buffer,
      mimetype: audio.mimetype,
    });
    return;
  }

  await ctx.reply('Downloading TikTok video...');
  const video = await downloadTikTokVideo(url);
  await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
    video,
    mimetype: 'video/mp4',
    caption: 'TikTok video',
  });
}

export const TikTokCommand: Command = {
  name: 'tiktok',
  aliases: ['tt', 'ttvideo'],
  category: CommandCategory.DOWNLOADER,
  description: 'Download a TikTok as video or audio',
  usage: 'tiktok <url> <video|audio>',
  async execute(ctx) {
    const url = getUrl(ctx.args);
    const format = getFormat(ctx.args[1]);
    if (!url || !format) {
      await ctx.reply('Usage: .tiktok <tiktok url> <video|audio>');
      return;
    }

    try {
      await sendTikTok(ctx, url, format);
    } catch (err) {
      await ctx.reply(`Failed to download TikTok ${format}.`);
    }
  },
};

export const TikTokAudioCommand: Command = {
  name: 'tiktokaudio',
  aliases: ['ttaudio', 'ttmp3'],
  category: CommandCategory.DOWNLOADER,
  description: 'Download a TikTok video as audio',
  usage: 'tiktokaudio <url>',
  async execute(ctx) {
    const url = getUrl(ctx.args);
    if (!url) {
      await ctx.reply('Usage: .tiktokaudio <tiktok url>');
      return;
    }

    try {
      await sendTikTok(ctx, url, 'audio');
    } catch (err) {
      await ctx.reply('Failed to export audio from that TikTok video.');
    }
  },
};
