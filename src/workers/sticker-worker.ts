import type { Job } from 'bullmq';
import type { StickerJobData } from './types';
import logger from '../core/logger';
import { stickerEngine } from '../services/sticker-engine';

export class StickerWorker {
  async process(job: Job<StickerJobData>): Promise<void> {
    logger.info({ jobId: job.id }, 'Processing sticker job');

    try {
      await job.updateProgress(20);
      
      let stickerBuffer: Buffer;
      
      if (job.data.mediaType === 'image') {
        stickerBuffer = await stickerEngine.createSticker(job.data.mediaBuffer, {
          packName: job.data.packName,
          author: job.data.author,
        });
      } else {
        stickerBuffer = job.data.mediaBuffer;
      }

      await job.updateProgress(80);

      logger.info({ jobId: job.id }, 'Sticker job completed');
      await job.updateProgress(100);
    } catch (err) {
      logger.error({ err, jobId: job.id }, 'Error processing sticker job');
      throw err;
    }
  }
}

export default StickerWorker;
