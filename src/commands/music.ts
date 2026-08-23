import { Command, CommandCategory } from '../types';
import {
  downloadYtDlpAudioFile,
  downloadYtDlpVideoFile,
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
  await sendMusicInfo(ctx, audio.info, audio.platformName || platform?.name, input, audio.match, audio.audioSourceName, (audio as any).fromCache);
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

  return [
    {
      label: 'youtube-music',
      input: platforms.youtube.searchInput(input),
      query: input,
      audioSourceLabel: 'youtube-music',
    },
    {
      label: 'soundcloud',
      input: platforms.soundcloud.searchInput(input),
      query: input,
      audioSourceLabel: 'soundcloud',
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

function isLikelyValidSpotifyCredential(val?: string): boolean {
  if (!val) return false;
  const clean = val.trim();
  return clean.length >= 16 && !clean.includes('your_') && !clean.includes('placeholder') && !clean.includes('example');
}

async function spotifyAccessToken(): Promise<string | null> {
  const clientId = config.SPOTIFY_CLIENT_ID?.trim();
  const clientSecret = config.SPOTIFY_CLIENT_SECRET?.trim();
  if (!isLikelyValidSpotifyCredential(clientId) || !isLikelyValidSpotifyCredential(clientSecret)) {
    return null;
  }

  if (spotifyToken && spotifyToken.expiresAt > Date.now() + 30_000) {
    return spotifyToken.value;
  }

  try {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
    });

    if (!response.ok) {
      logger.info({ status: response.status }, 'Spotify client credentials rejected, falling back to zero-key resolution');
      return null;
    }

    const data = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;

    spotifyToken = {
      value: data.access_token,
      expiresAt: Date.now() + Math.max(60, data.expires_in || 3600) * 1000,
    };

    return spotifyToken.value;
  } catch {
    return null;
  }
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

async function fetchSpotifyOembedTrack(trackUrl: string): Promise<SpotifyTrackMatch | null> {
  try {
    const response = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(trackUrl)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 WhatsAppHybridBot/1.0' },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { title?: string; thumbnail_url?: string };
    if (!data.title) return null;

    return {
      title: data.title,
      artists: '',
      url: trackUrl,
      query: data.title,
    };
  } catch {
    return null;
  }
}

async function spotifyMatchForRequest(input: string, url?: URL): Promise<SpotifyTrackMatch | null> {
  try {
    const trackId = url ? spotifyTrackIdFromUrl(url) : null;
    if (trackId) {
      const byApi = await spotifyTrackById(trackId);
      if (byApi) return byApi;
      return fetchSpotifyOembedTrack(url!.toString());
    }
    if (url && isSpotifyUrl(url)) {
      const oembed = await fetchSpotifyOembedTrack(url.toString());
      if (oembed) return oembed;
      const searchText = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '');
      return searchText ? searchSpotifyTrack(searchText) : null;
    }
    return searchSpotifyTrack(input);
  } catch (err) {
    if (url && isSpotifyUrl(url)) {
      const oembed = await fetchSpotifyOembedTrack(url.toString());
      if (oembed) return oembed;
    }
    logger.info({ err: errorSummary(err) }, 'Spotify metadata lookup failed');
    return null;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function sendMusicInfo(
  ctx: Parameters<Command['execute']>[0],
  info?: DownloadedMediaInfo,
  platformName?: string,
  requested?: string,
  match?: SpotifyTrackMatch,
  audioSourceName?: string,
  fromCache = false
): Promise<void> {
  if (!info) return;

  const title = match?.title || info.title || requested || 'Audio Track';
  const artist = match?.artists || info.uploader || 'Various Artists';
  const duration = info.duration || 'N/A';
  const platform = platformName ? prettyPlatform(platformName) : prettyPlatform(info.extractor);
  const sourceUrl = match?.url || info.webpageUrl;

  const lines = [
    `🎵 *Now Playing: ${title}*`,
    `👤 *Artist / Channel:* ${artist}`,
    match?.album ? `💿 *Album:* ${match.album}` : undefined,
    `⏱️ *Duration:* ${duration}`,
    `🌐 *Platform:* ${platform}${fromCache ? ' ⚡ (Instant Cache)' : ''}`,
    audioSourceName && audioSourceName !== platformName ? `🔊 *Stream Source:* ${prettyPlatform(audioSourceName)}` : undefined,
    sourceUrl ? `🔗 *Track Link:* ${sourceUrl}` : undefined,
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
  if (message.includes('exceeds the allowable limit')) return 'The media duration exceeds maximum allowed limit (Max 15m video / 30m audio).';
  if (message.includes('too large')) return 'The file exceeds the maximum download size (Max 50MB video / 20MB audio).';
  return 'The source did not provide downloadable audio/video.';
}

import { formatUsageError, formatFailed } from '../core/response-formatter';

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
    examples: [`${platform.name} bohemian rhapsody`, `${platform.name} https://...`],
    inputs: 'Song title, artist name, or platform track URL',
    limits: 'Max 20MB audio stream, max 30m duration',
    async execute(ctx) {
      const query = ctx.args.join(' ').trim();
      if (!query) {
        await ctx.reply(
          formatUsageError({
            command: platform.name,
            reason: 'Song name or URL is required.',
            examples: [`${platform.name} blinding lights`, `${platform.name} https://...`],
            hint: `Search tracks specifically on ${platform.name}.`,
          })
        );
        return;
      }

      try {
        await ctx.reply(`🎵 Finding and streaming ${platform.name} audio...`);
        await playMusic(ctx, query, platform);
      } catch (err) {
        await ctx.reply(
          formatFailed({
            title: `${platform.name} Audio`,
            reason: playFailure(err),
            tryHint: 'Try another search query or use .play <title>',
          })
        );
      }
    },
  };
}

export const PlayCommand: Command = {
  name: 'play',
  aliases: ['song', 'music'],
  category: CommandCategory.DOWNLOADER,
  description: 'Search and stream the best matching music audio across platforms',
  usage: 'play [youtube|spotify|soundcloud|newgrounds] <song name|url>',
  examples: ['play bohemian rhapsody', 'play spotify starboy', 'play https://youtu.be/...'],
  inputs: 'Song title, artist name, or direct music URL',
  limits: 'Max 20MB audio stream, max 30m duration',
  async execute(ctx) {
    const { query, platform } = parsePlayArgs(ctx.args);
    if (!query) {
      await ctx.reply(
        formatUsageError({
          command: 'play',
          reason: 'Song name or music URL is required.',
          customUsage: 'play [platform] <song name|url>',
          examples: ['play lofi hip hop', 'play spotify stay with me', 'play https://youtu.be/...'],
          hint: 'Searches YouTube Music, Spotify, SoundCloud, and Newgrounds automatically.',
        })
      );
      return;
    }

    try {
      await ctx.reply(platform ? `🎵 Finding ${platform.name} audio...` : '🎵 Finding the best matching audio result...');
      await playMusic(ctx, query, platform);
    } catch (err) {
      await ctx.reply(
        formatFailed({
          title: 'Music Playback',
          reason: playFailure(err),
          tryHint: 'Check the spelling of the song name or provide a direct video/track link.',
        })
      );
    }
  },
};

export const YouTubeCommand = createMusicCommand(platforms.youtube);
export const SpotifyCommand = createMusicCommand(platforms.spotify);
export const SoundCloudCommand = createMusicCommand(platforms.soundcloud);
export const NewgroundsCommand = createMusicCommand(platforms.newgrounds);

export const YouTubeVideoCommand: Command = {
  name: 'ytvideo',
  aliases: ['ytmp4', 'youtubevideo', 'ytdl', 'ytv'],
  category: CommandCategory.DOWNLOADER,
  description: 'Download YouTube video as high-quality MP4',
  usage: 'ytvideo <song/video name|url>',
  examples: ['ytvideo lofi hip hop radio', 'ytvideo https://www.youtube.com/watch?v=...'],
  inputs: 'Video title or YouTube URL',
  limits: 'Max 50MB video file, max 15m duration',
  async execute(ctx) {
    const input = ctx.args.join(' ').trim();
    if (!input) {
      await ctx.reply(
        formatUsageError({
          command: 'ytvideo',
          reason: 'Video title or YouTube URL is required.',
          examples: ['ytvideo lofi hip hop', 'ytvideo https://youtu.be/...'],
          hint: 'Downloads the video directly in MP4 format (Max 15 minutes).',
        })
      );
      return;
    }

    try {
      await ctx.reply('🎬 Downloading YouTube video, please wait...');
      let targetUrl = input;
      if (!/^https?:\/\//i.test(input)) {
        const results = await searchYtDlp(`ytsearch1:${input}`, 1);
        targetUrl = results[0]?.webpageUrl || results[0]?.url || input;
      }

      const video = await downloadYtDlpVideoFile(targetUrl);
      const lines = [
        `🎬 *YouTube Video: ${video.info?.title || 'Video'}*`,
        video.info?.uploader ? `📺 *Channel:* ${video.info.uploader}` : undefined,
        video.info?.duration ? `⏱️ *Duration:* ${video.info.duration}` : undefined,
        `📦 *Quality:* 720p HD MP4`,
        `💾 *Size:* ${formatBytes(video.buffer.byteLength)}${video.fromCache ? ' ⚡ (Instant Cache)' : ''}`,
        video.info?.webpageUrl ? `🔗 *Link:* ${video.info.webpageUrl}` : undefined,
      ].filter(Boolean);

      await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
        video: video.buffer,
        mimetype: 'video/mp4',
        caption: lines.join('\n'),
      });
    } catch (err) {
      await ctx.reply(
        formatFailed({
          title: 'YouTube Video Download',
          reason: playFailure(err),
          tryHint: 'Ensure the video is public and under 15 minutes in duration.',
        })
      );
    }
  },
};

