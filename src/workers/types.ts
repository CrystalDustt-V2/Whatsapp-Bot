import type { Job } from 'bullmq';

export interface BaseJobData {
  id: string;
  timestamp: number;
}

export interface MessageJobData extends BaseJobData {
  jid: string;
  text: string;
  options?: Record<string, any>;
}

export interface StickerJobData extends BaseJobData {
  mediaBuffer: Buffer;
  mediaType: 'image' | 'video';
  packName?: string;
  author?: string;
  outputJid: string;
}

export interface DownloaderJobData extends BaseJobData {
  url: string;
  format?: string;
  outputJid: string;
}

export interface AIJobData extends BaseJobData {
  prompt: string;
  context?: string;
  outputJid: string;
}

export interface WorkerHandler<T extends BaseJobData> {
  (job: Job<T>): Promise<void>;
}
