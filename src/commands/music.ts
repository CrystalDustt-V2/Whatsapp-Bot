import { Command, CommandCategory } from '../types';
import {
  downloadYtDlpAudioFile,
  DownloadedAudio,
  DownloadedMediaInfo,
  searchYtDlp,
  YtDlpSearchResult,
} from '../services/tiktok-downloader';
import logger from '../core/logger';
import config from '../config';

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
  query?: string;
  match?: SpotifyTrackMatch;
  audioSourceLabel?: string;
};

type SpotifyTrackMatch = {
  title: string;
  artists: string;
  album?: string;
  durationMs?: number;
  url: string;
  query: string;
};

type DownloadedMusic = DownloadedAudio & {
  platformName?: string;
  audioSourceName?: string;
  match?: SpotifyTrackMatch;
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
    searchInput: (query) => `ytsearch5:${query}`,
  },
  spotify: {
    name: 'spotify',
    aliases: ['sp'],
    hostPattern: /(^|\.)spotify\.com$/,
    searchInput: (query) => `ytsearch5:${query}`,
  },
  soundcloud: {
    name: 'soundcloud',
    aliases: ['sc'],
    hostPattern: /(^|\.)soundcloud\.com$/,
    searchInput: (query) => `scsearch5:${query}`,
  },
  newgrounds: {
    name: 'newgrounds',
    aliases: ['ng', 'ngaudio'],
    hostPattern: /(^|\.)newgrounds\.com$/,
    searchInput: (query) => `ytsearch5:${query}`,
    autoSearchInput: (query) => `https://www.newgrounds.com/search/conduct/audio?terms=${encodeURIComponent(query)}`,
  },
};

let spotifyToken: { value: string; expiresAt: number } | null = null;

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

  let sources: MusicSource[];
  if (platform?.name === platforms.spotify.name) {
    sources = await spotifyMusicSources(input, httpUrl);
  } else if (httpUrl && !platform) {
    sources = await autoMusicSources(input, httpUrl);
  } else if (httpUrl) {
    sources = [{ label: platform?.name || httpUrl.hostname, input: (platform && normalizeUrl(input, platform)) || httpUrl.toString() }];
  } else if (platform) {
    sources = [{ label: platform.name, input: platform.searchInput(input), query: input }];
  } else {
    sources = await autoMusicSources(input);
  }
  const audio = await downloadFirstAudio(sources);
  await sendAudio(ctx, audio.buffer, audio.mimetype);
  await sendMusicInfo(ctx, audio.info, audio.platformName || platform?.name, input, audio.match, audio.audioSourceName);
}

function spotifyDownloadSources(spotifyMatch: SpotifyTrackMatch): MusicSource[] {
  return [
    {
      label: 'spotify',
      input: platforms.youtube.searchInput(spotifyMatch.query),
      query: spotifyMatch.query,
      match: spotifyMatch,
      audioSourceLabel: 'youtube-music',
    },
    {
      label: 'spotify',
      input: platforms.soundcloud.searchInput(spotifyMatch.query),
      query: spotifyMatch.query,
      match: spotifyMatch,
      audioSourceLabel: 'soundcloud',
    },
  ];
}

async function spotifyMusicSources(input: string, url?: URL | null): Promise<MusicSource[]> {
  const spotifyMatch = await spotifyMatchForRequest(input, url || undefined);
  if (spotifyMatch) return spotifyDownloadSources(spotifyMatch);

  if (url && isSpotifyUrl(url)) {
    throw new Error('Spotify metadata lookup failed');
  }

  return [
    {
      label: platforms.spotify.name,
      input: platforms.spotify.searchInput(input),
      query: input,
      audioSourceLabel: 'youtube-music',
    },
  ];
}

async function autoMusicSources(input: string, url?: URL): Promise<MusicSource[]> {
  const spotifyMatch = await spotifyMatchForRequest(input, url);
  const spotifySources = spotifyMatch ? spotifyDownloadSources(spotifyMatch) : [];

  if (url) {
    return spotifySources.length
      ? spotifySources
      : [{ label: url.hostname, input: url.toString() }];
  }

  return [
    {
      label: platforms.youtube.name,
      input: platforms.youtube.searchInput(input),
      query: input,
    },
    ...spotifySources,
    {
      label: platforms.soundcloud.name,
      input: platforms.soundcloud.searchInput(input),
      query: input,
    },
    {
      label: platforms.newgrounds.name,
      input: platforms.newgrounds.searchInput(input),
      query: input,
    },
  ];
}

async function downloadFirstAudio(sources: MusicSource[]): Promise<DownloadedMusic> {
  let lastError: unknown;
  const uniqueSources = sources.filter(
    (source, index) => sources.findIndex((item) => item.input === source.input) === index
  );

  for (let i = 0; i < uniqueSources.length; i += 1) {
    const source = uniqueSources[i];
    try {
      const input = await bestDownloadInput(source);
      return {
        ...(await downloadYtDlpAudioFile(input)),
        platformName: source.label,
        audioSourceName: source.audioSourceLabel || source.label,
        match: source.match,
      };
    } catch (err) {
      const log = i === uniqueSources.length - 1 ? logger.warn.bind(logger) : logger.info.bind(logger);
      log({ platform: source.label, source: safeSource(source.input), error: errorSummary(err) }, 'Music audio source failed');
      lastError = err;
    }
  }
  throw lastError;
}

async function bestDownloadInput(source: MusicSource): Promise<string> {
  if (!source.query || !/^(yt|sc)search\d*:/i.test(source.input)) return source.input;

  const results = await searchYtDlp(source.input, 5);
  const best = results
    .map((result) => ({ result, score: relevanceScore(source.query!, result, source.match?.durationMs) }))
    .sort((a, b) => b.score - a.score)[0]?.result;
  const url = best?.webpageUrl || best?.url;

  return url && /^https?:\/\//i.test(url) ? url : source.input;
}

function relevanceScore(query: string, result: YtDlpSearchResult, durationMs?: number): number {
  const queryText = normalizeSearchText(query);
  const title = normalizeSearchText(result.title || '');
  const uploader = normalizeSearchText(result.uploader || '');
  const tokens = [...new Set(queryText.split(' ').filter((token) => token.length > 1))];
  let score = title.includes(queryText) ? 20 : 0;

  for (const token of tokens) {
    if (title.includes(token)) score += 4;
    else if (uploader.includes(token)) score += 1;
  }

  if (!tokens.includes('cover') && title.includes('cover')) score -= 3;
  if (!tokens.includes('remix') && title.includes('remix')) score -= 2;
  if (!tokens.includes('instrumental') && title.includes('instrumental')) score -= 3;
  if (!tokens.includes('karaoke') && title.includes('karaoke')) score -= 3;
  if (durationMs && result.durationSeconds) {
    const diff = Math.abs(result.durationSeconds - Math.round(durationMs / 1000));
    if (diff <= 3) score += 8;
    else if (diff <= 8) score += 4;
    else if (diff >= 30) score -= 5;
  }

  return score;
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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

function isSpotifyUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return host === 'open.spotify.com' || host.endsWith('.spotify.com');
}

function spotifyTrackIdFromUrl(url: URL): string | null {
  if (!isSpotifyUrl(url)) return null;
  const [, type, id] = url.pathname.split('/');
  return type === 'track' && /^[A-Za-z0-9]+$/.test(id || '') ? id : null;
}

async function spotifyAccessToken(): Promise<string | null> {
  const clientId = config.SPOTIFY_CLIENT_ID?.trim();
  const clientSecret = config.SPOTIFY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;

  if (spotifyToken && spotifyToken.expiresAt > Date.now() + 30_000) {
    return spotifyToken.value;
  }

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  });

  if (!response.ok) {
    logger.warn({ status: response.status }, 'Spotify token request failed');
    return null;
  }

  const data = await response.json() as { access_token?: string; expires_in?: number };
  if (!data.access_token) return null;

  spotifyToken = {
    value: data.access_token,
    expiresAt: Date.now() + Math.max(60, data.expires_in || 3600) * 1000,
  };

  return spotifyToken.value;
}

async function spotifyApi(path: string): Promise<Record<string, unknown> | null> {
  const token = await spotifyAccessToken();
  if (!token) return null;

  const response = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    logger.info({ status: response.status, path: path.split('?')[0] }, 'Spotify metadata request failed');
    return null;
  }

  const data = await response.json();
  return data && typeof data === 'object' ? data as Record<string, unknown> : null;
}

function spotifyTrackFromObject(item: Record<string, unknown> | null): SpotifyTrackMatch | null {
  if (!item) return null;

  const title = typeof item.name === 'string' ? item.name : '';
  const artists = Array.isArray(item.artists)
    ? item.artists
        .map((artist) => artist && typeof artist === 'object' && 'name' in artist ? String(artist.name || '') : '')
        .filter(Boolean)
        .join(', ')
    : '';
  const album = item.album && typeof item.album === 'object' && 'name' in item.album ? String(item.album.name || '') : undefined;
  const durationMs = typeof item.duration_ms === 'number' ? item.duration_ms : undefined;
  const externalUrls = item.external_urls && typeof item.external_urls === 'object' ? item.external_urls as Record<string, unknown> : {};
  const url = typeof externalUrls.spotify === 'string' ? externalUrls.spotify : '';

  if (!title || !artists || !url) return null;

  return {
    title,
    artists,
    album,
    durationMs,
    url,
    query: `${title} ${artists}`,
  };
}

async function spotifyTrackById(id: string): Promise<SpotifyTrackMatch | null> {
  return spotifyTrackFromObject(await spotifyApi(`/tracks/${encodeURIComponent(id)}`));
}

async function searchSpotifyTrack(query: string): Promise<SpotifyTrackMatch | null> {
  const params = new URLSearchParams({
    type: 'track',
    limit: '5',
    q: query,
  });
  if (config.SPOTIFY_MARKET?.trim()) params.set('market', config.SPOTIFY_MARKET.trim());

  const data = await spotifyApi(`/search?${params.toString()}`);
  const tracks = data?.tracks && typeof data.tracks === 'object' ? data.tracks as Record<string, unknown> : null;
  const items = Array.isArray(tracks?.items) ? tracks.items : [];
  const matches = items
    .map((item) => spotifyTrackFromObject(item && typeof item === 'object' ? item as Record<string, unknown> : null))
    .filter((item): item is SpotifyTrackMatch => Boolean(item));

  return matches
    .map((match) => ({ match, score: spotifyRelevanceScore(query, match) }))
    .sort((a, b) => b.score - a.score)[0]?.match || null;
}

function spotifyRelevanceScore(query: string, match: SpotifyTrackMatch): number {
  const queryText = normalizeSearchText(query);
  const title = normalizeSearchText(match.title);
  const artists = normalizeSearchText(match.artists);
  const combined = `${title} ${artists}`.trim();
  const tokens = [...new Set(queryText.split(' ').filter((token) => token.length > 1))];
  let score = combined.includes(queryText) ? 25 : 0;

  for (const token of tokens) {
    if (title.includes(token)) score += 5;
    else if (artists.includes(token)) score += 2;
  }

  return score;
}

async function spotifyMatchForRequest(input: string, url?: URL): Promise<SpotifyTrackMatch | null> {
  try {
    const trackId = url ? spotifyTrackIdFromUrl(url) : null;
    if (trackId) return spotifyTrackById(trackId);
    if (url && isSpotifyUrl(url)) {
      const searchText = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '');
      return searchText ? searchSpotifyTrack(searchText) : null;
    }
    return searchSpotifyTrack(input);
  } catch (err) {
    logger.info({ err: errorSummary(err) }, 'Spotify metadata lookup failed');
    return null;
  }
}

async function sendMusicInfo(
  ctx: Parameters<Command['execute']>[0],
  info?: DownloadedMediaInfo,
  platformName?: string,
  requested?: string,
  match?: SpotifyTrackMatch,
  audioSourceName?: string
): Promise<void> {
  if (!info) return;

  const lines = [
    'Music info',
    requested && !parseHttpUrl(requested) ? `Requested: ${requested}` : undefined,
    match ? `Spotify match: ${match.title} - ${match.artists}` : undefined,
    match?.album ? `Album: ${match.album}` : undefined,
    match?.url ? `Spotify link: ${match.url}` : undefined,
    info.title ? `Result title: ${info.title}` : undefined,
    info.uploader ? `Uploader: ${info.uploader}` : undefined,
    `Matched via: ${platformName || prettyPlatform(info.extractor)}`,
    audioSourceName && audioSourceName !== platformName ? `Audio source: ${audioSourceName}` : undefined,
    info.duration ? `Duration: ${info.duration}` : undefined,
    info.webpageUrl ? `Download source: ${info.webpageUrl}` : undefined,
  ].filter(Boolean);

  await ctx.socket.sendMessage(ctx.message.key.remoteJid!, { text: lines.join('\n'), linkPreview: null });
}

function prettyPlatform(value?: string): string {
  if (!value) return 'Unknown';
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
}

function platformFromToken(value: string): MusicPlatform | undefined {
  const token = value.toLowerCase().replace(/^-+/, '');
  return Object.values(platforms).find((platform) => platform.name === token || platform.aliases.includes(token));
}

function parsePlayArgs(args: string[]): { query: string; platform?: MusicPlatform } {
  const platform = args[0] ? platformFromToken(args[0]) : undefined;
  return {
    platform,
    query: (platform ? args.slice(1) : args).join(' ').trim(),
  };
}

function playFailure(err: unknown): string {
  const message = err instanceof Error ? err.message : '';
  if (message.includes('yt-dlp is not installed')) return 'yt-dlp is not installed on this server.';
  if (message.includes('yt-dlp is not executable')) return 'yt-dlp exists but is not executable. Run chmod 755 on it.';
  if (message.includes('yt-dlp binary cannot run')) return 'yt-dlp binary cannot run on this server. Upload the Linux binary.';
  if (message.includes('cookies file was not found')) return 'Configured yt-dlp cookies file was not found.';
  if (message.includes('cookies file is invalid')) return 'yt-dlp cookies file is invalid. Export it in Netscape cookies.txt format.';
  if (message.includes('YouTube requires cookies')) return 'YouTube blocked this server. Upload cookies.txt and configure yt-dlp cookies.';
  if (message.includes('JS runtime/EJS')) return 'YouTube needs a JS runtime/EJS solver. Configure YT_DLP_JS_RUNTIME and YT_DLP_REMOTE_COMPONENTS.';
  if (message.includes('DRM')) return 'That source uses DRM and cannot be downloaded.';
  if (message.includes('Spotify metadata lookup failed')) return 'Spotify track links need SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET, or Spotify did not return that track.';
  if (message.includes('too large')) return 'The audio file is over 20 MB.';
  return 'The source did not provide downloadable audio.';
}

function createMusicCommand(platform: MusicPlatform): Command {
  const isSpotify = platform.name === platforms.spotify.name;
  return {
    name: platform.name,
    aliases: platform.aliases,
    category: CommandCategory.DOWNLOADER,
    description: isSpotify
      ? 'Use Spotify metadata to find and play matching audio'
      : `Play music from ${platform.name} as audio`,
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
  usage: 'play [youtube|spotify|soundcloud|newgrounds] <song name|url>',
  async execute(ctx) {
    const { query, platform } = parsePlayArgs(ctx.args);
    if (!query) {
      await ctx.reply('Usage: .play [youtube|spotify|soundcloud|newgrounds] <song name|url>');
      return;
    }

    try {
      await ctx.reply(platform ? `Finding ${platform.name} audio...` : 'Finding the best audio result...');
      await playMusic(ctx, query, platform);
    } catch (err) {
      await ctx.reply(`Could not play audio for that request. ${playFailure(err)}`);
    }
  },
};

export const YouTubeCommand = createMusicCommand(platforms.youtube);
export const SpotifyCommand = createMusicCommand(platforms.spotify);
export const SoundCloudCommand = createMusicCommand(platforms.soundcloud);
export const NewgroundsCommand = createMusicCommand(platforms.newgrounds);
