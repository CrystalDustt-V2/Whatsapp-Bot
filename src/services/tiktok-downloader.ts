import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import mediaEngine from './media-engine';
import { AudioFormat } from './media-engine/video-types';

const execFileAsync = promisify(execFile);
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

export function isTikTokUrl(input: string): boolean {
  try {
    const host = new URL(input).hostname.toLowerCase();
    return host === 'tiktok.com' || host.endsWith('.tiktok.com') || host === 'vm.tiktok.com' || host === 'vt.tiktok.com';
  } catch {
    return false;
  }
}

export async function downloadTikTokVideo(url: string): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'tiktok-'));
  const output = path.join(dir, 'video.%(ext)s');

  try {
    await execFileAsync('yt-dlp', [
      '--no-playlist',
      '--max-filesize',
      `${MAX_VIDEO_BYTES}`,
      '-f',
      'mp4/best[ext=mp4]/best',
      '-o',
      output,
      url,
    ]);

    const files = await readdir(dir);
    const file = files.find((name) => name.startsWith('video.'));
    if (!file) throw new Error('TikTok download produced no file');

    const filePath = path.join(dir, file);
    const info = await stat(filePath);
    if (info.size > MAX_VIDEO_BYTES) throw new Error('TikTok video is too large');

    return readFile(filePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function downloadTikTokAudio(url: string): Promise<Buffer> {
  const video = await downloadTikTokVideo(url);
  return mediaEngine.extractAudio(video, {
    format: AudioFormat.MP3,
    bitrate: 128,
  });
}
