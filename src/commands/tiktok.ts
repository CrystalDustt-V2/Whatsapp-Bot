import {
  downloadTikTokAudioFile,
  downloadTikTokVideoFile,
  isTikTokUrl,
  searchYtDlp,
} from '../services/tiktok-downloader';
import { Command, CommandCategory } from '../types';

type TikTokFormat = 'audio' | 'video';

function extractUrlOrQuery(args: string[]): { url?: string; query?: string; format: TikTokFormat } {
  const last = args.at(-1)?.toLowerCase();
  const format: TikTokFormat = last === 'audio' || last === 'mp3' ? 'audio' : 'video';
  const remaining = (last === 'audio' || last === 'mp3' || last === 'video' || last === 'mp4') ? args.slice(0, -1) : args;
  const input = remaining.join(' ').trim();

  if (isTikTokUrl(input)) {
    return { url: input, format };
  }

  if (/^https?:\/\//i.test(input)) {
    return { url: input, format };
  }

  return { query: input, format };
}

async function resolveVideoUrl(url?: string, query?: string): Promise<string | null> {
  if (url) return url;
  if (!query) return null;

  const results = await searchYtDlp(`ytsearch1:${query} tiktok`, 1);
  return results[0]?.webpageUrl || results[0]?.url || null;
}

async function sendTikTok(ctx: Parameters<Command['execute']>[0], targetUrl: string, format: TikTokFormat): Promise<void> {
  if (format === 'audio') {
    await ctx.reply('Exporting TikTok audio...');
    const audio = await downloadTikTokAudioFile(targetUrl);
    await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
      audio: audio.buffer,
      mimetype: audio.mimetype,
      ptt: false,
    });
    if (audio.info?.title) {
      await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
        text: `*TikTok Audio*\nTitle: ${audio.info.title}\nCreator: ${audio.info.uploader || 'Unknown'}${audio.info.duration ? `\nDuration: ${audio.info.duration}` : ''}`,
      });
    }
    return;
  }

  await ctx.reply('Downloading TikTok video...');
  const video = await downloadTikTokVideoFile(targetUrl);
  const captionLines = [
    `*TikTok Video*`,
    video.info?.title ? `Title: ${video.info.title}` : undefined,
    video.info?.uploader ? `Creator: ${video.info.uploader}` : undefined,
    video.info?.duration ? `Duration: ${video.info.duration}` : undefined,
  ].filter(Boolean);

  await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
    video: video.buffer,
    mimetype: video.mimetype || 'video/mp4',
    caption: captionLines.join('\n'),
  });
}

export const TikTokCommand: Command = {
  name: 'tiktok',
  aliases: ['tt', 'ttvideo', 'tiktokdl'],
  category: CommandCategory.DOWNLOADER,
  description: 'Download TikTok video or audio by URL or search query',
  usage: 'tiktok <url|query> [video|audio]',
  async execute(ctx) {
    if (!ctx.args.length) {
      await ctx.reply('Usage: .tiktok <tiktok url|search query> [video|audio]\nExample: .tiktok https://vt.tiktok.com/... \nExample: .tiktok trending dance audio');
      return;
    }

    const { url, query, format } = extractUrlOrQuery(ctx.args);
    try {
      const targetUrl = await resolveVideoUrl(url, query);
      if (!targetUrl) {
        await ctx.reply(`No TikTok found for "${query}".`);
        return;
      }
      await sendTikTok(ctx, targetUrl, format);
    } catch (err) {
      await ctx.reply(`Failed to download TikTok ${format}. Check if the link is public and accessible.`);
    }
  },
};

export const TikTokAudioCommand: Command = {
  name: 'tiktokaudio',
  aliases: ['ttaudio', 'ttmp3', 'tiktokmusic'],
  category: CommandCategory.DOWNLOADER,
  description: 'Download a TikTok video directly as audio MP3',
  usage: 'tiktokaudio <url|query>',
  async execute(ctx) {
    const input = ctx.args.join(' ').trim();
    if (!input) {
      await ctx.reply('Usage: .tiktokaudio <tiktok url|search query>');
      return;
    }

    const { url, query } = extractUrlOrQuery(ctx.args);
    try {
      const targetUrl = await resolveVideoUrl(url, query);
      if (!targetUrl) {
        await ctx.reply(`No TikTok audio found for "${query}".`);
        return;
      }
      await sendTikTok(ctx, targetUrl, 'audio');
    } catch (err) {
      await ctx.reply('Failed to export audio from that TikTok.');
    }
  },
};

