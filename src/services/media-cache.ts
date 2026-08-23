import logger from '../core/logger';
import { DownloadedAudio, DownloadedVideo } from './tiktok-downloader';

interface CacheEntry<T> {
  data: T;
  sizeBytes: number;
  expiresAt: number;
  lastAccessed: number;
}

class MediaCacheManager {
  private audioCache = new Map<string, CacheEntry<DownloadedAudio>>();
  private videoCache = new Map<string, CacheEntry<DownloadedVideo>>();
  private readonly maxMemoryBytes = 80 * 1024 * 1024; // 80 MB limit
  private readonly defaultTtlMs = 45 * 60 * 1000; // 45 minutes

  private normalizeKey(key: string): string {
    return key.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private currentTotalBytes(): number {
    let total = 0;
    for (const entry of this.audioCache.values()) total += entry.sizeBytes;
    for (const entry of this.videoCache.values()) total += entry.sizeBytes;
    return total;
  }

  private evictIfNecessary(incomingBytes: number): void {
    const now = Date.now();

    // 1. Remove expired
    for (const [key, entry] of this.audioCache.entries()) {
      if (entry.expiresAt < now) this.audioCache.delete(key);
    }
    for (const [key, entry] of this.videoCache.entries()) {
      if (entry.expiresAt < now) this.videoCache.delete(key);
    }

    // 2. LRU eviction if over memory limit
    while (this.currentTotalBytes() + incomingBytes > this.maxMemoryBytes) {
      let oldestKey: string | null = null;
      let oldestAccess = Infinity;
      let isAudio = true;

      for (const [key, entry] of this.audioCache.entries()) {
        if (entry.lastAccessed < oldestAccess) {
          oldestAccess = entry.lastAccessed;
          oldestKey = key;
          isAudio = true;
        }
      }

      for (const [key, entry] of this.videoCache.entries()) {
        if (entry.lastAccessed < oldestAccess) {
          oldestAccess = entry.lastAccessed;
          oldestKey = key;
          isAudio = false;
        }
      }

      if (!oldestKey) break;

      if (isAudio) {
        this.audioCache.delete(oldestKey);
      } else {
        this.videoCache.delete(oldestKey);
      }
    }
  }

  public getAudio(key: string): DownloadedAudio | null {
    const normalized = this.normalizeKey(key);
    const entry = this.audioCache.get(normalized);
    if (!entry) return null;

    if (entry.expiresAt < Date.now()) {
      this.audioCache.delete(normalized);
      return null;
    }

    entry.lastAccessed = Date.now();
    logger.debug({ key: normalized }, 'Audio media cache hit');
    return entry.data;
  }

  public setAudio(key: string, data: DownloadedAudio, ttlMs = this.defaultTtlMs): void {
    const normalized = this.normalizeKey(key);
    const sizeBytes = data.buffer.byteLength;
    if (sizeBytes > this.maxMemoryBytes) return;

    this.evictIfNecessary(sizeBytes);
    this.audioCache.set(normalized, {
      data,
      sizeBytes,
      expiresAt: Date.now() + ttlMs,
      lastAccessed: Date.now(),
    });
    logger.debug({ key: normalized, sizeBytes }, 'Cached audio media');
  }

  public getVideo(key: string): DownloadedVideo | null {
    const normalized = this.normalizeKey(key);
    const entry = this.videoCache.get(normalized);
    if (!entry) return null;

    if (entry.expiresAt < Date.now()) {
      this.videoCache.delete(normalized);
      return null;
    }

    entry.lastAccessed = Date.now();
    logger.debug({ key: normalized }, 'Video media cache hit');
    return entry.data;
  }

  public setVideo(key: string, data: DownloadedVideo, ttlMs = this.defaultTtlMs): void {
    const normalized = this.normalizeKey(key);
    const sizeBytes = data.buffer.byteLength;
    if (sizeBytes > this.maxMemoryBytes) return;

    this.evictIfNecessary(sizeBytes);
    this.videoCache.set(normalized, {
      data,
      sizeBytes,
      expiresAt: Date.now() + ttlMs,
      lastAccessed: Date.now(),
    });
    logger.debug({ key: normalized, sizeBytes }, 'Cached video media');
  }
}

export const mediaCache = new MediaCacheManager();
export default mediaCache;
