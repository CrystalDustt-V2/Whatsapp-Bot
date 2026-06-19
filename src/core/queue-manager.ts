import { Queue, Worker, Job } from 'bullmq';
import getRedisClient from './redis';
import logger from './logger';

export enum QueueName {
  MESSAGE = 'message',
  STICKER = 'sticker',
  DOWNLOADER = 'downloader',
  AI = 'ai',
  BACKUP = 'backup',
  MEDIA_CONVERSION = 'media_conversion',
  OCR = 'ocr',
}

export class QueueManager {
  private queues: Map<QueueName, Queue> = new Map();
  private workers: Map<QueueName, Worker> = new Map();

  constructor() {
    try {
      this.initializeQueues();
    } catch (err) {
      logger.warn({ err }, 'Queue initialization skipped (Redis not available)');
    }
  }

  private initializeQueues() {
    const redis = getRedisClient();
    for (const name of Object.values(QueueName)) {
      const queue = new Queue(name, { connection: redis });
      this.queues.set(name, queue);
      logger.info(`Initialized queue: ${name}`);
    }
  }

  getQueue(name: QueueName): Queue {
    const queue = this.queues.get(name);
    if (!queue) throw new Error(`Queue not found: ${name}`);
    return queue;
  }

  registerWorker<T = any>(
    name: QueueName,
    processor: (job: Job<T>) => Promise<void>
  ): void {
    try {
      const redis = getRedisClient();
      const worker = new Worker(name, processor, { connection: redis });

      worker.on('completed', (job) => {
        logger.debug(`Job ${job.id} completed for queue ${name}`);
      });

      worker.on('failed', (job, err) => {
        logger.error({ err, jobId: job?.id }, `Job failed for queue ${name}`);
      });

      this.workers.set(name, worker);
      logger.info(`Registered worker for queue: ${name}`);
    } catch (err) {
      logger.warn({ err }, `Worker registration skipped for queue: ${name}`);
    }
  }

  async shutdown(): Promise<void> {
    for (const [name, worker] of this.workers) {
      try {
        await worker.close();
        logger.info(`Closed worker: ${name}`);
      } catch (err) {
        logger.warn({ err }, `Failed to close worker: ${name}`);
      }
    }
    for (const [name, queue] of this.queues) {
      try {
        await queue.close();
        logger.info(`Closed queue: ${name}`);
      } catch (err) {
        logger.warn({ err }, `Failed to close queue: ${name}`);
      }
    }
  }
}

export const queueManager = new QueueManager();

export default queueManager;
