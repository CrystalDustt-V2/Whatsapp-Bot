import path from 'node:path';
import config from '../config';
import logger from '../core/logger';
import type { DownloadedAudio, DownloadedVideo } from './tiktok-downloader';

const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50MB
const MAX_AUDIO_BYTES = 20 * 1024 * 1024; // 20MB

interface CobaltApiResponse {
  status: 'tunnel' | 'redirect' | 'picker' | 'error' | 'stream';
  url?: string;
  filename?: string;
  picker?: Array<{
    type: 'photo' | 'video';
    url: string;
    thumb?: string;
  }>;
  audio?: string;
  error?: {
    code: string;
    context?: Record<string, unknown>;
  };
}

export function isCobaltFallbackEnabled(): boolean {
  return config.COBALT_FALLBACK_ENABLED !== false;
}

export function getCobaltInstances(): string[] {
  const raw = config.COBALT_INSTANCES || 'https://cobaltapi.cjs.nz';
  return raw
    .split(',')
    .map((url) => url.trim().replace(/\/+$/, ''))
    .filter((url) => url.length > 0 && /^https?:\/\//i.test(url));
}

function inferMimeType(filename: string | undefined, mode: 'video' | 'audio'): string {
  if (!filename) return mode === 'video' ? 'video/mp4' : 'audio/mpeg';
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return mode === 'audio' ? 'audio/webm' : 'video/webm';
    case '.m4a':
      return 'audio/mp4';
    case '.mp3':
      return 'audio/mpeg';
    case '.ogg':
    case '.opus':
      return 'audio/ogg';
    case '.wav':
      return 'audio/wav';
    default:
      return mode === 'video' ? 'video/mp4' : 'audio/mpeg';
  }
}

function cleanTitle(filename?: string): string | undefined {
  if (!filename) return undefined;
  const base = path.parse(filename).name;
  return base.replace(/\s*\((?:\d+p|[a-zA-Z0-9,\s]+)\)$/i, '').trim() || base;
}

export async function fetchCobaltMedia(
  url: string,
  mode: 'video' | 'audio',
  options: { quality?: string; audioFormat?: string } = {},
): Promise<DownloadedVideo | null> {
  if (!isCobaltFallbackEnabled()) {
    return null;
  }

  const instances = getCobaltInstances();
  if (instances.length === 0) {
    logger.warn('Cobalt fallback requested but no instances are configured');
    return null;
  }

  const maxBytes = mode === 'video' ? MAX_VIDEO_BYTES : MAX_AUDIO_BYTES;
  const timeoutMs = config.COBALT_TIMEOUT_MS || 30000;

  const payload: Record<string, unknown> = {
    url,
    downloadMode: mode === 'audio' ? 'audio' : 'auto',
  };

  if (mode === 'audio') {
    payload.audioFormat = options.audioFormat || 'mp3';
  } else {
    payload.videoQuality = options.quality || '720';
  }

  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  };

  if (config.COBALT_API_KEY?.trim()) {
    headers['Authorization'] = `Api-Key ${config.COBALT_API_KEY.trim()}`;
  }

  for (const instance of instances) {
    try {
      logger.info({ instance, url, mode }, 'Attempting download via Cobalt instance...');

      const response = await fetch(`${instance}/`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        logger.warn(
          { instance, status: response.status, errorText: errorText.slice(0, 200) },
          'Cobalt instance returned non-200 HTTP response',
        );
        continue;
      }

      const data = (await response.json()) as CobaltApiResponse;

      if (data.status === 'error') {
        logger.warn(
          { instance, errorCode: data.error?.code, context: data.error?.context },
          'Cobalt instance returned error status',
        );
        continue;
      }

      let downloadUrl: string | undefined;
      let filename = data.filename;

      if (data.status === 'tunnel' || data.status === 'redirect' || data.status === 'stream' || data.url) {
        downloadUrl = data.url;
      } else if (data.status === 'picker' && Array.isArray(data.picker) && data.picker.length > 0) {
        if (mode === 'audio' && data.audio) {
          downloadUrl = data.audio;
        } else if (mode === 'video') {
          const videoItem = data.picker.find((item) => item.type === 'video') || data.picker[0];
          downloadUrl = videoItem.url;
        } else {
          downloadUrl = data.picker[0].url;
        }
      }

      if (!downloadUrl) {
        logger.warn({ instance, data }, 'Cobalt response contained no download URL');
        continue;
      }

      logger.info({ instance, downloadUrl: downloadUrl.slice(0, 100), filename }, 'Fetching media file stream from Cobalt...');

      const mediaRes = await fetch(downloadUrl, {
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!mediaRes.ok) {
        logger.warn({ instance, downloadUrl, status: mediaRes.status }, 'Failed to stream media from Cobalt URL');
        continue;
      }

      const contentLengthHeader = mediaRes.headers.get('content-length');
      if (contentLengthHeader) {
        const declaredLength = Number(contentLengthHeader);
        if (!Number.isNaN(declaredLength) && declaredLength > maxBytes) {
          throw new Error(`Media from Cobalt exceeds maximum allowed size (${(maxBytes / (1024 * 1024)).toFixed(0)}MB limit)`);
        }
      }

      const arrayBuffer = await mediaRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (buffer.length > maxBytes) {
        throw new Error(`Downloaded media from Cobalt exceeds maximum allowed size (${(maxBytes / (1024 * 1024)).toFixed(0)}MB limit)`);
      }

      let mimetype = mediaRes.headers.get('content-type') || '';
      if (!mimetype || mimetype.includes('octet-stream')) {
        mimetype = inferMimeType(filename, mode);
      }

      const title = cleanTitle(filename) || (mode === 'video' ? 'Video' : 'Audio');

      logger.info(
        { instance, sizeBytes: buffer.length, mimetype, title },
        'Successfully downloaded media via Cobalt fallback',
      );

      return {
        buffer,
        mimetype,
        info: {
          title,
          uploader: 'Cobalt Fallback',
          webpageUrl: url,
          extractor: 'cobalt',
        },
      };
    } catch (err: any) {
      logger.warn(
        { instance, url, error: err?.message },
        'Cobalt download attempt failed for instance',
      );
    }
  }

  return null;
}

export async function downloadCobaltVideo(url: string, quality?: string): Promise<DownloadedVideo | null> {
  return fetchCobaltMedia(url, 'video', { quality });
}

export async function downloadCobaltAudio(url: string, audioFormat?: string): Promise<DownloadedAudio | null> {
  return fetchCobaltMedia(url, 'audio', { audioFormat });
}
