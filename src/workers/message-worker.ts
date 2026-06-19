import type { Job } from 'bullmq';
import type { MessageJobData } from './types';
import logger from '../core/logger';

export class MessageWorker {
  async process(job: Job<MessageJobData>): Promise<void> {
    logger.info({ jobId: job.id, jid: job.data.jid }, 'Processing message job');

    try {
      await job.updateProgress(50);
      
      logger.info({ jobId: job.id }, 'Message job completed');
      await job.updateProgress(100);
    } catch (err) {
      logger.error({ err, jobId: job.id }, 'Error processing message job');
      throw err;
    }
  }
}

export default MessageWorker;
