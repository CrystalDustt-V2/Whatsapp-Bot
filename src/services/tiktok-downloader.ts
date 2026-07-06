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

async function runYtDlp(args: string[]): Promise<string> {
  const cookiesPath = process.env.YT_DLP_COOKIES_PATH?.trim();
  const jsRuntime = process.env.YT_DLP_JS_RUNTIME?.trim();
  const remoteComponents = process.env.YT_DLP_REMOTE_COMPONENTS?.trim();
  const finalArgs = [
    ...(cookiesPath ? ['--cookies', cookiesPath] : []),
    ...(jsRuntime ? ['--js-runtimes', jsRuntime] : []),
    ...(remoteComponents ? ['--remote-components', remoteComponents] : []),
    ...args,
  ];

  if (cookiesPath && !(await fileExists(cookiesPath))) {
    throw new Error('yt-dlp cookies file was not found on this server');
  }

  try {
    const { stdout } = await execFileAsync(await ytDlpBinary(), finalArgs, { maxBuffer: YTDLP_MAX_BUFFER });
    return stdout;
  } catch (err) {
    const code = typeof err === 'object' && err && 'code' in err ? String(err.code) : '';
    const stderr = tail(typeof err === 'object' && err && 'stderr' in err ? err.stderr : '');
    const stdout = tail(typeof err === 'object' && err && 'stdout' in err ? err.stdout : '');
    if (code === 'ENOENT') throw new Error('yt-dlp is not installed on this server');
    if (code === 'EACCES') throw new Error('yt-dlp is not executable on this server');
    if (code === 'ENOEXEC' || /syntax error|exec format|cannot execute binary/i.test(`${stderr}\n${stdout}`)) {
      throw new Error('yt-dlp binary cannot run on this server');
    }
    if (/does not look like a netscape|cookies file/i.test(stderr)) throw new Error('yt-dlp cookies file is invalid');
    if (/sign in to confirm|cookies/i.test(stderr)) throw new Error('YouTube requires cookies on this server');
    if (/signature solving failed|challenge solving failed|requested format is not available/i.test(stderr)) {
      throw new Error('YouTube needs a JS runtime/EJS solver on this server');
    }
    if (/known to use DRM|DRM protection/i.test(stderr)) throw new Error('Source uses DRM and cannot be downloaded');
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

function audioMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.m4a' || ext === '.mp4') return 'audio/mp4';
  if (ext === '.webm') return 'audio/webm';
  if (ext === '.ogg' || ext === '.opus') return 'audio/ogg';
  if (ext === '.wav') return 'audio/wav';
  return 'audio/mpeg';
}

export async function downloadYtDlpVideo(url: string): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'media-video-'));
  const output = path.join(dir, 'video.%(ext)s');

  try {
    await runYtDlp([
      '--no-playlist',
      '--max-filesize',
      `${MAX_VIDEO_BYTES}`,
      '-f',
      'bestvideo*+bestaudio/best',
      '--merge-output-format',
      'mp4',
      '-o',
      output,
      url,
    ]);

    return (await readDownloadedFile(dir, 'video.', MAX_VIDEO_BYTES, 'Video')).buffer;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function downloadYtDlpAudioFile(url: string): Promise<DownloadedAudio> {
  const dir = await mkdtemp(path.join(tmpdir(), 'media-audio-'));
  const output = path.join(dir, 'audio.%(ext)s');

  try {
    const stdout = await runYtDlp([
      '--no-playlist',
      '--max-filesize',
      `${MAX_AUDIO_BYTES}`,
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
    return { buffer: file.buffer, mimetype: audioMimeType(file.name), info: parseYtDlpInfo(stdout) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function downloadYtDlpAudio(url: string): Promise<Buffer> {
  return (await downloadYtDlpAudioFile(url)).buffer;
}

export const downloadTikTokVideo = downloadYtDlpVideo;
export const downloadTikTokAudio = downloadYtDlpAudio;
export const downloadTikTokAudioFile = downloadYtDlpAudioFile;
