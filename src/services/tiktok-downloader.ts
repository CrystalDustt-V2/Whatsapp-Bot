import { execFile } from 'node:child_process';
import { access, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const YTDLP_MAX_BUFFER = 4 * 1024 * 1024;

export type DownloadedAudio = {
  buffer: Buffer;
  mimetype: string;
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

async function readDownloadedFile(dir: string, prefix: string, maxBytes: number, label: string): Promise<{ buffer: Buffer; name: string }> {
  const files = await readdir(dir);
  const file = files.find((name) => name.startsWith(prefix));
  if (!file) throw new Error(`${label} download produced no file`);

  const filePath = path.join(dir, file);
  const info = await stat(filePath);
  if (info.size > maxBytes) throw new Error(`${label} is too large`);

  return { buffer: await readFile(filePath), name: file };
}

async function runYtDlp(args: string[]): Promise<void> {
  try {
    await execFileAsync(await ytDlpBinary(), args, { maxBuffer: YTDLP_MAX_BUFFER });
  } catch (err) {
    const code = typeof err === 'object' && err && 'code' in err ? String(err.code) : '';
    if (code === 'ENOENT') throw new Error('yt-dlp is not installed on this server');
    throw err;
  }
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
    await runYtDlp([
      '--no-playlist',
      '--max-filesize',
      `${MAX_AUDIO_BYTES}`,
      '-f',
      'bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio',
      '-o',
      output,
      url,
    ]);

    const file = await readDownloadedFile(dir, 'audio.', MAX_AUDIO_BYTES, 'Audio');
    return { buffer: file.buffer, mimetype: audioMimeType(file.name) };
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
