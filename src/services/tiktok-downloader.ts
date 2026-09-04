import { execFile } from 'node:child_process';
import { access, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import logger from '../core/logger';

const execFileAsync = promisify(execFile);
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const YTDLP_MAX_BUFFER = 4 * 1024 * 1024;

export type DownloadedAudio = {
  buffer: Buffer;
  mimetype: string;
  info?: DownloadedMediaInfo;
};

export type DownloadedMediaInfo = {
  title?: string;
  uploader?: string;
  duration?: string;
  webpageUrl?: string;
  extractor?: string;
};

export type YtDlpSearchResult = DownloadedMediaInfo & {
  id?: string;
  url?: string;
  durationSeconds?: number;
};

export function isTikTokUrl(input: string): boolean {
  try {
    const host = new URL(input).hostname.toLowerCase();
    return host === 'tiktok.com' || host.endsWith('.tiktok.com') || host === 'vm.tiktok.com' || host === 'vt.tiktok.com';
  } catch {
    return false;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ytDlpBinary(): Promise<string> {
  const candidates = [
    process.env.YT_DLP_PATH,
    path.join(process.cwd(), '.local', 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'),
    path.join(process.cwd(), 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'),
    '/home/container/.local/bin/yt-dlp',
    '/home/container/bin/yt-dlp',
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }

  return 'yt-dlp';
}

function tail(value: unknown, max = 1200): string {
  return String(value || '').replace(/https?:\/\/[^\s]+/g, (url) => {
    try {
      const parsed = new URL(url);
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return url;
    }
  }).slice(-max);
}

async function readDownloadedFile(dir: string, prefix: string, maxBytes: number, label: string): Promise<{ buffer: Buffer; name: string }> {
  const files = await readdir(dir);
  const file = files.find((name) => name.startsWith(prefix));
  if (!file) throw new Error(`${label} download produced no file`);

  const filePath = path.join(dir, file);
  const info = await stat(filePath);
  if (info.size > maxBytes) throw new Error(`${label} is too large`);

  return { buffer: await readFile(filePath), name: file };
}

import mediaCache from './media-cache';
import { downloadCobaltVideo, downloadCobaltAudio, isCobaltFallbackEnabled } from './cobalt-service';

async function executeYtDlpOnce(args: string[], options: { useCookies?: boolean; playerClient?: string } = {}): Promise<string> {
  const cookiesPath = options.useCookies !== false ? process.env.YT_DLP_COOKIES_PATH?.trim() : undefined;
  const jsRuntime = process.env.YT_DLP_JS_RUNTIME?.trim();
  const remoteComponents = process.env.YT_DLP_REMOTE_COMPONENTS?.trim();
  const customExtractorArgs = process.env.YT_DLP_EXTRACTOR_ARGS?.trim();

  const extractorArg = customExtractorArgs || (options.playerClient ? `youtube:player-client=${options.playerClient}` : 'youtube:player-client=android,web,mweb,ios');

  const finalArgs = [
    ...(cookiesPath ? ['--cookies', cookiesPath] : []),
    ...(jsRuntime ? ['--js-runtimes', jsRuntime] : []),
    ...(remoteComponents ? ['--remote-components', remoteComponents] : []),
    '--extractor-args', extractorArg,
    ...args,
  ];

  if (cookiesPath && !(await fileExists(cookiesPath))) {
    throw new Error('yt-dlp cookies file was not found on this server');
  }

  const { stdout } = await execFileAsync(await ytDlpBinary(), finalArgs, { maxBuffer: YTDLP_MAX_BUFFER });
  return stdout;
}

async function runYtDlp(args: string[]): Promise<string> {
  // Strategy 1: Default execution with configured cookies and mobile/web player client emulation
  try {
    return await executeYtDlpOnce(args);
  } catch (err: any) {
    const stderr = tail(err?.stderr || '');
    const stdout = tail(err?.stdout || '');
    const fullErr = `${stderr}\n${stdout}`;

    // Strategy 2: If YouTube returned "The page needs to be reloaded" or JS signature failure, retry with web_embedded/web_safari
    if (/The page needs to be reloaded|signature solving failed|challenge solving failed/i.test(fullErr)) {
      logger.info('yt-dlp encountered YouTube player reload challenge, retrying with alternative player clients...');
      try {
        return await executeYtDlpOnce(args, { playerClient: 'web_embedded,web_safari,mweb' });
      } catch {
        // Strategy 3: Try without cookies in case authenticated session was flagged
        if (process.env.YT_DLP_COOKIES_PATH?.trim()) {
          logger.info('Retrying yt-dlp without cookies...');
          try {
            return await executeYtDlpOnce(args, { useCookies: false, playerClient: 'android,web,mweb' });
          } catch {
            // fall through to error classification
          }
        }
      }
    }

    const code = typeof err === 'object' && err && 'code' in err ? String(err.code) : '';
    if (code === 'ENOENT') throw new Error('yt-dlp is not installed on this server');
    if (code === 'EACCES') throw new Error('yt-dlp is not executable on this server');
    if (code === 'ENOEXEC' || /syntax error|exec format|cannot execute binary/i.test(fullErr)) {
      throw new Error('yt-dlp binary cannot run on this server');
    }
    if (/does not look like a netscape|cookies file/i.test(stderr)) throw new Error('yt-dlp cookies file is invalid');
    if (/sign in to confirm|cookies/i.test(stderr)) throw new Error('YouTube requires cookies on this server');
    if (/The page needs to be reloaded/i.test(stderr)) {
      throw new Error('YouTube returned "The page needs to be reloaded". Please update yt-dlp on the server with "yt-dlp -U".');
    }
    if (/signature solving failed|challenge solving failed|requested format is not available/i.test(stderr)) {
      throw new Error('YouTube needs a JS runtime/EJS solver on this server');
    }
    if (/known to use DRM|DRM protection/i.test(stderr)) throw new Error('Source uses DRM and cannot be downloaded');
    if (/does not pass filter.*duration|duration\s*<=/i.test(stderr)) {
      throw new Error('Media duration exceeds the allowable limit (Max 15m video / 30m audio).');
    }

    logger.warn(
      {
        code,
        stderr,
        stdout,
      },
      'yt-dlp command failed',
    );
    throw err;
  }
}

function parseYtDlpInfo(stdout: string): DownloadedMediaInfo {
  const labels = {
    title: '__BOT_INFO_TITLE__',
    uploader: '__BOT_INFO_UPLOADER__',
    duration: '__BOT_INFO_DURATION__',
    webpageUrl: '__BOT_INFO_URL__',
    extractor: '__BOT_INFO_EXTRACTOR__',
  } as const;
  const info: DownloadedMediaInfo = {};

  for (const [key, label] of Object.entries(labels) as [keyof DownloadedMediaInfo, string][]) {
    const value = stdout
      .split(/\r?\n/)
      .find((line) => line.startsWith(label))
      ?.slice(label.length)
      .trim();
    if (value && value !== 'NA') info[key] = value;
  }

  return info;
}

function parseJsonLines(stdout: string): YtDlpSearchResult[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      id: typeof item.id === 'string' ? item.id : undefined,
      title: typeof item.title === 'string' ? item.title : undefined,
      uploader: typeof item.uploader === 'string' ? item.uploader : undefined,
      duration: typeof item.duration_string === 'string' ? item.duration_string : undefined,
      durationSeconds: typeof item.duration === 'number' ? item.duration : undefined,
      webpageUrl: typeof item.webpage_url === 'string' ? item.webpage_url : undefined,
      extractor: typeof item.extractor_key === 'string' ? item.extractor_key : undefined,
      url: typeof item.url === 'string' ? item.url : undefined,
    }));
}

export async function searchYtDlp(input: string, limit = 5): Promise<YtDlpSearchResult[]> {
  const stdout = await runYtDlp([
    '--dump-json',
    '--flat-playlist',
    '--playlist-end',
    String(limit),
    input,
  ]);

  return parseJsonLines(stdout);
}

function audioMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.m4a' || ext === '.mp4') return 'audio/mp4';
  if (ext === '.webm') return 'audio/webm';
  if (ext === '.ogg' || ext === '.opus') return 'audio/ogg';
  if (ext === '.wav') return 'audio/wav';
  return 'audio/mpeg';
}

export type DownloadedVideo = {
  buffer: Buffer;
  mimetype: string;
  info?: DownloadedMediaInfo;
  fromCache?: boolean;
};

export async function downloadYtDlpVideoFile(url: string): Promise<DownloadedVideo> {
  const cached = mediaCache.getVideo(url);
  if (cached) {
    return { ...cached, fromCache: true };
  }

  const dir = await mkdtemp(path.join(tmpdir(), 'media-video-'));
  const output = path.join(dir, 'video.%(ext)s');

  try {
    const stdout = await runYtDlp([
      '--no-playlist',
      '--max-filesize',
      `${MAX_VIDEO_BYTES}`,
      '--match-filter',
      'duration <= 900',
      '-f',
      'bestvideo[height<=720]+bestaudio/best[height<=720]/best',
      '--merge-output-format',
      'mp4',
      '--print',
      'after_move:__BOT_INFO_TITLE__%(title)s',
      '--print',
      'after_move:__BOT_INFO_UPLOADER__%(uploader)s',
      '--print',
      'after_move:__BOT_INFO_DURATION__%(duration_string)s',
      '--print',
      'after_move:__BOT_INFO_URL__%(webpage_url)s',
      '--print',
      'after_move:__BOT_INFO_EXTRACTOR__%(extractor_key)s',
      '-o',
      output,
      url,
    ]);

    const file = await readDownloadedFile(dir, 'video.', MAX_VIDEO_BYTES, 'Video');
    const result: DownloadedVideo = { buffer: file.buffer, mimetype: 'video/mp4', info: parseYtDlpInfo(stdout) };
    mediaCache.setVideo(url, result);
    return result;
  } catch (err: any) {
    if (isCobaltFallbackEnabled()) {
      logger.info({ url, error: err?.message }, 'yt-dlp video download failed, attempting Cobalt fallback...');
      try {
        const cobaltResult = await downloadCobaltVideo(url);
        if (cobaltResult) {
          mediaCache.setVideo(url, cobaltResult);
          return cobaltResult;
        }
      } catch (cobaltErr: any) {
        logger.warn({ url, error: cobaltErr?.message }, 'Cobalt video fallback failed');
      }
    }
    throw err;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function downloadYtDlpVideo(url: string): Promise<Buffer> {
  return (await downloadYtDlpVideoFile(url)).buffer;
}

export async function downloadYtDlpAudioFile(url: string): Promise<DownloadedAudio & { fromCache?: boolean }> {
  const cached = mediaCache.getAudio(url);
  if (cached) {
    return { ...cached, fromCache: true };
  }

  const dir = await mkdtemp(path.join(tmpdir(), 'media-audio-'));
  const output = path.join(dir, 'audio.%(ext)s');

  try {
    const stdout = await runYtDlp([
      '--no-playlist',
      '--max-filesize',
      `${MAX_AUDIO_BYTES}`,
      '--match-filter',
      'duration <= 1800',
      '-f',
      'bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio',
      '--print',
      'after_move:__BOT_INFO_TITLE__%(title)s',
      '--print',
      'after_move:__BOT_INFO_UPLOADER__%(uploader)s',
      '--print',
      'after_move:__BOT_INFO_DURATION__%(duration_string)s',
      '--print',
      'after_move:__BOT_INFO_URL__%(webpage_url)s',
      '--print',
      'after_move:__BOT_INFO_EXTRACTOR__%(extractor_key)s',
      '-o',
      output,
      url,
    ]);

    const file = await readDownloadedFile(dir, 'audio.', MAX_AUDIO_BYTES, 'Audio');
    const result: DownloadedAudio = { buffer: file.buffer, mimetype: audioMimeType(file.name), info: parseYtDlpInfo(stdout) };
    mediaCache.setAudio(url, result);
    return result;
  } catch (err: any) {
    if (isCobaltFallbackEnabled()) {
      logger.info({ url, error: err?.message }, 'yt-dlp audio download failed, attempting Cobalt fallback...');
      try {
        const cobaltResult = await downloadCobaltAudio(url);
        if (cobaltResult) {
          mediaCache.setAudio(url, cobaltResult);
          return cobaltResult;
        }
      } catch (cobaltErr: any) {
        logger.warn({ url, error: cobaltErr?.message }, 'Cobalt audio fallback failed');
      }
    }
    throw err;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function downloadYtDlpAudio(url: string): Promise<Buffer> {
  return (await downloadYtDlpAudioFile(url)).buffer;
}

export const downloadTikTokVideo = downloadYtDlpVideo;
export const downloadTikTokVideoFile = downloadYtDlpVideoFile;
export const downloadTikTokAudio = downloadYtDlpAudio;
export const downloadTikTokAudioFile = downloadYtDlpAudioFile;
export { downloadCobaltVideo, downloadCobaltAudio, isCobaltFallbackEnabled };
