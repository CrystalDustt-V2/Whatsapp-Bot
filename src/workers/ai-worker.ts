import type { Job } from 'bullmq';
import type { AIJobData } from './types';
import logger from '../core/logger';

export class AIWorker {
  async process(job: Job<AIJobData>): Promise<void> {
    logger.info({ jobId: job.id }, 'Processing AI job');

    try {
      await job.updateProgress(30);
      
      logger.info({ jobId: job.id }, 'AI job completed');
      await job.updateProgress(100);
    } catch (err) {
      logger.error({ err, jobId: job.id }, 'Error processing AI job');
      throw err;
    }
  }
}

export default AIWorker;
