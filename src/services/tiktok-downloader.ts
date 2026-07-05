import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const YTDLP_MAX_BUFFER = 4 * 1024 * 1024;

export function isTikTokUrl(input: string): boolean {
  try {
    const host = new URL(input).hostname.toLowerCase();
    return host === 'tiktok.com' || host.endsWith('.tiktok.com') || host === 'vm.tiktok.com' || host === 'vt.tiktok.com';
  } catch {
    return false;
  }
}

async function readDownloadedFile(dir: string, prefix: string, maxBytes: number, label: string): Promise<Buffer> {
  const files = await readdir(dir);
  const file = files.find((name) => name.startsWith(prefix));
  if (!file) throw new Error(`${label} download produced no file`);

  const filePath = path.join(dir, file);
  const info = await stat(filePath);
  if (info.size > maxBytes) throw new Error(`${label} is too large`);

  return readFile(filePath);
}

async function runYtDlp(args: string[]): Promise<void> {
  await execFileAsync('yt-dlp', args, { maxBuffer: YTDLP_MAX_BUFFER });
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

    return readDownloadedFile(dir, 'video.', MAX_VIDEO_BYTES, 'Video');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function downloadYtDlpAudio(url: string): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'media-audio-'));
  const output = path.join(dir, 'audio.%(ext)s');

  try {
    await runYtDlp([
      '--no-playlist',
      '--max-filesize',
      `${MAX_AUDIO_BYTES}`,
      '-x',
      '--audio-format',
      'mp3',
      '--audio-quality',
      '128K',
      '-o',
      output,
      url,
    ]);

    return readDownloadedFile(dir, 'audio.', MAX_AUDIO_BYTES, 'Audio');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export const downloadTikTokVideo = downloadYtDlpVideo;
export const downloadTikTokAudio = downloadYtDlpAudio;
