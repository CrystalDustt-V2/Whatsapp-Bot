import { Command, CommandCategory } from '../types';

type MusicPlatform = {
  name: string;
  aliases: string[];
  hostPattern: RegExp;
  searchUrl(query: string): string;
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
    searchUrl: (query) => `https://music.youtube.com/search?q=${encodeURIComponent(query)}`,
  },
  spotify: {
    name: 'spotify',
    aliases: ['sp'],
    hostPattern: /(^|\.)spotify\.com$/,
    searchUrl: (query) => `https://open.spotify.com/search/${encodeURIComponent(query)}`,
  },
  soundcloud: {
    name: 'soundcloud',
    aliases: ['sc'],
    hostPattern: /(^|\.)soundcloud\.com$/,
    searchUrl: (query) => `https://soundcloud.com/search?q=${encodeURIComponent(query)}`,
  },
  newgrounds: {
    name: 'newgrounds',
    aliases: ['ng', 'ngaudio'],
    hostPattern: /(^|\.)newgrounds\.com$/,
    searchUrl: (query) => `https://www.newgrounds.com/search/conduct/audio?terms=${encodeURIComponent(query)}`,
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

function createMusicCommand(platform: MusicPlatform): Command {
  return {
    name: platform.name,
    aliases: platform.aliases,
    category: CommandCategory.DOWNLOADER,
    description: `Find or play music on ${platform.name}`,
    usage: `${platform.name} <song name|url>`,
    async execute(ctx) {
      const query = ctx.args.join(' ').trim();
      if (!query) {
        await ctx.reply(`Usage: .${platform.name} <song name|url>`);
        return;
      }

      const httpUrl = parseHttpUrl(query);
      if (httpUrl && isDirectAudioUrl(httpUrl)) {
        const audio = await fetchAudio(httpUrl.toString());
        if (!audio) {
          await ctx.reply('Could not fetch that audio file. Use a direct audio URL under 20 MB.');
          return;
        }

        await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
          audio: audio.buffer,
          mimetype: audio.mimetype,
          ptt: true,
        });
        return;
      }

      const url = (httpUrl && normalizeUrl(query, platform)) || platform.searchUrl(query);
      await ctx.reply(`${platform.name}: ${url}`);
    },
  };
}

export const YouTubeCommand = createMusicCommand(platforms.youtube);
export const SpotifyCommand = createMusicCommand(platforms.spotify);
export const SoundCloudCommand = createMusicCommand(platforms.soundcloud);
export const NewgroundsCommand = createMusicCommand(platforms.newgrounds);
