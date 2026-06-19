import type { Job } from 'bullmq';
import type { DownloaderJobData } from './types';
import logger from '../core/logger';

export class DownloaderWorker {
  async process(job: Job<DownloaderJobData>): Promise<void> {
    logger.info({ jobId: job.id, url: job.data.url }, 'Processing downloader job');

    try {
      await job.updateProgress(25);
      
      logger.info({ jobId: job.id }, 'Downloader job completed');
      await job.updateProgress(100);
    } catch (err) {
      logger.error({ err, jobId: job.id }, 'Error processing downloader job');
      throw err;
    }
  }
}

export default DownloaderWorker;
