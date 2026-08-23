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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
        text: `*TikTok Audio*\nTitle: ${audio.info.title}\nCreator: ${audio.info.uploader || 'Unknown'}${audio.info.duration ? `\nDuration: ${audio.info.duration}` : ''}\nSize: ${formatBytes(audio.buffer.byteLength)}${audio.fromCache ? ' ⚡ (Instant Cache)' : ''}`,
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
    `Size: ${formatBytes(video.buffer.byteLength)}${video.fromCache ? ' ⚡ (Instant Cache)' : ''}`,
  ].filter(Boolean);

  await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
    video: video.buffer,
    mimetype: video.mimetype || 'video/mp4',
    caption: captionLines.join('\n'),
  });
}

import { formatUsageError, formatFailed } from '../core/response-formatter';

export const TikTokCommand: Command = {
  name: 'tiktok',
  aliases: ['tt', 'ttvideo', 'tiktokdl'],
  category: CommandCategory.DOWNLOADER,
  description: 'Download TikTok video or audio by URL or search query',
  usage: 'tiktok <url|query> [video|audio]',
  examples: [
    'tiktok https://vt.tiktok.com/...',
    'tiktok https://vt.tiktok.com/... audio',
    'tiktok trending dance beat',
  ],
  inputs: 'TikTok video/audio URL or search query',
  limits: 'Max 50MB video / 20MB audio',
  async execute(ctx) {
    if (!ctx.args.length) {
      await ctx.reply(
        formatUsageError({
          command: 'tiktok',
          reason: 'TikTok URL or search query is required.',
          examples: [
            'tiktok https://vt.tiktok.com/...',
            'tiktok https://www.tiktok.com/@user/video/... audio',
            'tiktok viral sound query',
          ],
          hint: 'Add "audio" at the end to extract the sound as MP3.',
        })
      );
      return;
    }

    const { url, query, format } = extractUrlOrQuery(ctx.args);
    try {
      const targetUrl = await resolveVideoUrl(url, query);
      if (!targetUrl) {
        await ctx.reply(
          formatFailed({
            title: 'TikTok Search',
            reason: `No TikTok video or audio found matching "${query}".`,
            tryHint: 'Check your search query or provide a direct TikTok link.',
          })
        );
        return;
      }
      await sendTikTok(ctx, targetUrl, format);
    } catch (err) {
      await ctx.reply(
        formatFailed({
          title: `TikTok ${format.toUpperCase()}`,
          reason: 'Could not download TikTok content. The video might be private, deleted, or geo-restricted.',
          tryHint: 'Ensure the link is from a public TikTok account.',
        })
      );
    }
  },
};

export const TikTokAudioCommand: Command = {
  name: 'tiktokaudio',
  aliases: ['ttaudio', 'ttmp3', 'tiktokmusic'],
  category: CommandCategory.DOWNLOADER,
  description: 'Download a TikTok video directly as audio MP3',
  usage: 'tiktokaudio <url|query>',
  examples: [
    'tiktokaudio https://vt.tiktok.com/...',
    'tiktokaudio viral sound challenge',
  ],
  inputs: 'TikTok URL or search query',
  limits: 'Max 20MB audio',
  async execute(ctx) {
    const input = ctx.args.join(' ').trim();
    if (!input) {
      await ctx.reply(
        formatUsageError({
          command: 'tiktokaudio',
          reason: 'TikTok URL or search query is required.',
          examples: [
            'tiktokaudio https://vt.tiktok.com/...',
            'tiktokaudio lofi viral audio',
          ],
          hint: 'Extracts the background audio track as an MP3 file.',
        })
      );
      return;
    }

    const { url, query } = extractUrlOrQuery(ctx.args);
    try {
      const targetUrl = await resolveVideoUrl(url, query);
      if (!targetUrl) {
        await ctx.reply(
          formatFailed({
            title: 'TikTok Audio',
            reason: `No TikTok found matching "${query}".`,
            tryHint: 'Try another search query or paste a direct video link.',
          })
        );
        return;
      }
      await sendTikTok(ctx, targetUrl, 'audio');
    } catch (err) {
      await ctx.reply(
        formatFailed({
          title: 'TikTok Audio Export',
          reason: 'Failed to extract audio from that TikTok.',
          tryHint: 'Ensure the video is public and has an audible sound track.',
        })
      );
    }
  },
};

