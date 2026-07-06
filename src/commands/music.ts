import { Command, CommandCategory } from '../types';
import { downloadYtDlpAudioFile, DownloadedAudio, DownloadedMediaInfo } from '../services/tiktok-downloader';
import logger from '../core/logger';

type MusicPlatform = {
  name: string;
  aliases: string[];
  hostPattern: RegExp;
  searchInput(query: string): string;
  autoSearchInput?(query: string): string;
};

type MusicSource = {
  label: string;
  input: string;
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
    autoSearchInput: (query) => `https://open.spotify.com/search/${encodeURIComponent(query)}`,
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
    autoSearchInput: (query) => `https://www.newgrounds.com/search/conduct/audio?terms=${encodeURIComponent(query)}`,
  },
};

const autoMusicPlatformOrder = [platforms.youtube, platforms.spotify, platforms.soundcloud, platforms.newgrounds];

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
    await sendMusicInfo(ctx, { webpageUrl: httpUrl.toString(), extractor: 'Direct audio' }, platform?.name, input);
    return;
  }

  const sources = httpUrl
    ? [{ label: platform?.name || httpUrl.hostname, input: (platform && normalizeUrl(input, platform)) || httpUrl.toString() }]
    : platform
      ? [{ label: platform.name, input: platform.searchInput(input) }]
      : autoMusicPlatformOrder.map((item) => ({
          label: item.name,
          input: (item.autoSearchInput || item.searchInput)(input),
        }));
  const audio = await downloadFirstAudio(sources);
  await sendAudio(ctx, audio.buffer, audio.mimetype);
  await sendMusicInfo(ctx, audio.info, audio.platformName || platform?.name, input);
}

async function downloadFirstAudio(sources: MusicSource[]): Promise<DownloadedAudio & { platformName?: string }> {
  let lastError: unknown;
  const uniqueSources = sources.filter(
    (source, index) => sources.findIndex((item) => item.input === source.input) === index
  );

  for (let i = 0; i < uniqueSources.length; i += 1) {
    const source = uniqueSources[i];
    try {
      return { ...(await downloadYtDlpAudioFile(source.input)), platformName: source.label };
    } catch (err) {
      const log = i === uniqueSources.length - 1 ? logger.warn.bind(logger) : logger.info.bind(logger);
      log({ platform: source.label, source: safeSource(source.input), error: errorSummary(err) }, 'Music audio source failed');
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

function errorSummary(err: unknown): string {
  return err instanceof Error ? err.message.split('\n')[0] : String(err);
}

async function sendMusicInfo(
  ctx: Parameters<Command['execute']>[0],
  info?: DownloadedMediaInfo,
  platformName?: string,
  requested?: string
): Promise<void> {
  if (!info) return;

  const lines = [
    'Music info',
    requested && !parseHttpUrl(requested) ? `Requested: ${requested}` : undefined,
    info.title ? `Result title: ${info.title}` : undefined,
    info.uploader ? `Uploader: ${info.uploader}` : undefined,
    `Source platform: ${platformName || prettyPlatform(info.extractor)}`,
    info.duration ? `Duration: ${info.duration}` : undefined,
    info.webpageUrl ? `Source: ${info.webpageUrl}` : undefined,
  ].filter(Boolean);

  await ctx.socket.sendMessage(ctx.message.key.remoteJid!, { text: lines.join('\n'), linkPreview: null });
}

function prettyPlatform(value?: string): string {
  if (!value) return 'Unknown';
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
}

function playFailure(err: unknown): string {
  const message = err instanceof Error ? err.message : '';
  if (message.includes('yt-dlp is not installed')) return 'yt-dlp is not installed on this server.';
  if (message.includes('yt-dlp is not executable')) return 'yt-dlp exists but is not executable. Run chmod 755 on it.';
  if (message.includes('yt-dlp binary cannot run')) return 'yt-dlp binary cannot run on this server. Upload the Linux binary.';
  if (message.includes('cookies file was not found')) return 'Configured yt-dlp cookies file was not found.';
  if (message.includes('cookies file is invalid')) return 'yt-dlp cookies file is invalid. Export it in Netscape cookies.txt format.';
  if (message.includes('YouTube requires cookies')) return 'YouTube blocked this server. Upload cookies.txt and configure yt-dlp cookies.';
  if (message.includes('DRM')) return 'That source uses DRM and cannot be downloaded.';
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
