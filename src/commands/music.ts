import { Command, CommandCategory } from '../types';
import { downloadYtDlpAudioFile, DownloadedAudio } from '../services/tiktok-downloader';
import logger from '../core/logger';

type MusicPlatform = {
  name: string;
  aliases: string[];
  hostPattern: RegExp;
  searchInput(query: string): string;
};

const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const AUDIO_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/ogg',
  'audio/opus',
  'audio/wav',
  'audio/x-wav',
  'audio/aac',
  'audio/mp4',
  'audio/webm',
]);

const platforms: Record<string, MusicPlatform> = {
  youtube: {
    name: 'youtube-music',
    aliases: ['yt', 'youtube', 'ytmusic', 'ymusic'],
    hostPattern: /(^|\.)music\.youtube\.com$|(^|\.)youtube\.com$|(^|\.)youtu\.be$/,
    searchInput: (query) => `ytsearch1:${query}`,
  },
  spotify: {
    name: 'spotify',
    aliases: ['sp'],
    hostPattern: /(^|\.)spotify\.com$/,
    searchInput: (query) => `ytsearch1:${query}`,
  },
  soundcloud: {
    name: 'soundcloud',
    aliases: ['sc'],
    hostPattern: /(^|\.)soundcloud\.com$/,
    searchInput: (query) => `scsearch1:${query}`,
  },
  newgrounds: {
    name: 'newgrounds',
    aliases: ['ng', 'ngaudio'],
    hostPattern: /(^|\.)newgrounds\.com$/,
    searchInput: (query) => `ytsearch1:${query}`,
  },
};

function normalizeUrl(input: string, platform: MusicPlatform): string | null {
  try {
    const url = new URL(input);
    return platform.hostPattern.test(url.hostname.toLowerCase()) ? url.toString() : null;
  } catch {
    return null;
  }
}

function parseHttpUrl(input: string): URL | null {
  try {
    const url = new URL(input);
    return ['http:', 'https:'].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function isDirectAudioUrl(url: URL): boolean {
  return /\.(mp3|ogg|opus|wav|aac|m4a|webm)$/i.test(url.pathname);
}

async function fetchAudio(url: string): Promise<{ buffer: Buffer; mimetype: string } | null> {
  const response = await fetch(url);
  if (!response.ok) return null;

  const mimetype = response.headers.get('content-type')?.split(';')[0]?.toLowerCase() || 'audio/mpeg';
  const length = Number(response.headers.get('content-length') || 0);

  if (!AUDIO_MIME_TYPES.has(mimetype) || length > MAX_AUDIO_BYTES) {
    return null;
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_AUDIO_BYTES) {
    return null;
  }

  return { buffer: Buffer.from(arrayBuffer), mimetype };
}

async function sendAudio(ctx: Parameters<Command['execute']>[0], audio: Buffer, mimetype = 'audio/mpeg'): Promise<void> {
  await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
    audio,
    mimetype,
    ptt: false,
  });
}

async function playMusic(ctx: Parameters<Command['execute']>[0], input: string, platform?: MusicPlatform): Promise<void> {
  const httpUrl = parseHttpUrl(input);
  if (httpUrl && isDirectAudioUrl(httpUrl)) {
    const audio = await fetchAudio(httpUrl.toString());
    if (!audio) throw new Error('Direct audio fetch failed');
    await sendAudio(ctx, audio.buffer, audio.mimetype);
    return;
  }

  const source = httpUrl
    ? (platform && normalizeUrl(input, platform)) || httpUrl.toString()
    : platform?.searchInput(input) || platforms.youtube.searchInput(input);
  const fallback = httpUrl || platform?.name === platforms.soundcloud.name ? [] : [platforms.soundcloud.searchInput(input)];
  const audio = await downloadFirstAudio([source, ...fallback]);
  await sendAudio(ctx, audio.buffer, audio.mimetype);
}

async function downloadFirstAudio(sources: string[]): Promise<DownloadedAudio> {
  let lastError: unknown;
  for (const source of [...new Set(sources)]) {
    try {
      return await downloadYtDlpAudioFile(source);
    } catch (err) {
      logger.warn({ source: safeSource(source), err }, 'Music audio source failed');
      lastError = err;
    }
  }
  throw lastError;
}

function safeSource(source: string): string {
  try {
    const url = new URL(source);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return source;
  }
}

function playFailure(err: unknown): string {
  const message = err instanceof Error ? err.message : '';
  if (message.includes('yt-dlp is not installed')) return 'yt-dlp is not installed on this server.';
  if (message.includes('yt-dlp is not executable')) return 'yt-dlp exists but is not executable. Run chmod 755 on it.';
  if (message.includes('yt-dlp binary cannot run')) return 'yt-dlp binary cannot run on this server. Upload the Linux binary.';
  if (message.includes('too large')) return 'The audio file is over 20 MB.';
  return 'The source did not provide downloadable audio.';
}

function createMusicCommand(platform: MusicPlatform): Command {
  return {
    name: platform.name,
    aliases: platform.aliases,
    category: CommandCategory.DOWNLOADER,
    description: `Play music from ${platform.name} as audio`,
    usage: `${platform.name} <song name|url>`,
    async execute(ctx) {
      const query = ctx.args.join(' ').trim();
      if (!query) {
        await ctx.reply(`Usage: .${platform.name} <song name|url>`);
        return;
      }

      try {
        await ctx.reply(`Playing ${platform.name} audio...`);
        await playMusic(ctx, query, platform);
      } catch (err) {
        await ctx.reply(`Could not play audio from that ${platform.name} request. ${playFailure(err)}`);
      }
    },
  };
}

export const PlayCommand: Command = {
  name: 'play',
  aliases: [],
  category: CommandCategory.DOWNLOADER,
  description: 'Search and play the best matching music result as audio',
  usage: 'play <song name|url>',
  async execute(ctx) {
    const query = ctx.args.join(' ').trim();
    if (!query) {
      await ctx.reply('Usage: .play <song name|url>');
      return;
    }

    try {
      await ctx.reply('Finding the best audio result...');
      await playMusic(ctx, query);
    } catch (err) {
      await ctx.reply(`Could not play audio for that request. ${playFailure(err)}`);
    }
  },
};

export const YouTubeCommand = createMusicCommand(platforms.youtube);
export const SpotifyCommand = createMusicCommand(platforms.spotify);
export const SoundCloudCommand = createMusicCommand(platforms.soundcloud);
export const NewgroundsCommand = createMusicCommand(platforms.newgrounds);
