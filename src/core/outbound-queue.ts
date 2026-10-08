import { Queue, Worker, DelayedError, UnrecoverableError, type Job } from 'bullmq';
import crypto from 'crypto';
import type { WAMessage } from '@whiskeysockets/baileys';
import config from '../config';
import logger from './logger';

export interface OutboundMessage {
  chatJid: string;
  accountJid: string;
  text: string;
  messageId: string;
  queuedAt: string;
  mentionAll?: boolean;
  quoted?: WAMessage;
  delivered?: boolean;
}

const queueName = 'dashboard-outbound';

export class OutboundQueue {
  private queue?: Queue<OutboundMessage>;
  private worker?: Worker<OutboundMessage>;
  private lastErrorAt = 0;

  constructor(private deliver: (message: OutboundMessage) => Promise<boolean>) {}

  private connection() {
    return { host: config.REDIS_HOST, port: config.REDIS_PORT, password: config.REDIS_PASSWORD, connectTimeout: 3000 };
  }

  private logError = (err: Error): void => {
    if (Date.now() - this.lastErrorAt < 60_000) return;
    this.lastErrorAt = Date.now();
    logger.warn({ err: err.message }, 'Outbound queue Redis connection failed');
  };

  private getQueue(): Queue<OutboundMessage> {
    if (!this.queue) {
      this.queue = new Queue(queueName, { connection: { ...this.connection(), maxRetriesPerRequest: 1, enableOfflineQueue: false } });
      this.queue.on('error', this.logError);
    }
    return this.queue;
  }

  start(): void {
    if (this.worker) return;
    this.worker = new Worker(queueName, (job, token) => this.process(job, token), {
      connection: { ...this.connection(), maxRetriesPerRequest: null }, concurrency: 1,
    });
    this.worker.on('error', this.logError);
    this.worker.on('failed', (job, err) => logger.warn({ jobId: job?.id, err: err.message }, 'Queued outbound message failed'));
  }

  async enqueue(message: Omit<OutboundMessage, 'messageId' | 'queuedAt'>, requestId: string = crypto.randomUUID()): Promise<string> {
    if (!message.accountJid) throw new Error('Link WhatsApp before queueing messages.');
    const id = crypto.createHash('sha256').update(`${message.accountJid}\0${requestId}`).digest('hex');
    const queue = this.getQueue();
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([queue.waitUntilReady(), new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Redis is unavailable; message was not queued.')), 4000);
      })]);
      await queue.add('send', { ...message, messageId: id.slice(0, 32).toUpperCase(), queuedAt: new Date().toISOString() }, {
        jobId: id, attempts: 5, backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 86400 }, removeOnFail: false,
      });
      this.start();
      return id;
    } finally { if (timeout) clearTimeout(timeout); }
  }

  async process(job: Job<OutboundMessage>, token?: string): Promise<void> {
    if (job.data.delivered) return;
    if (!await this.deliver(job.data)) {
      await job.moveToDelayed(Date.now() + 15_000, token);
      throw new DelayedError();
    }
    await job.updateData({ ...job.data, delivered: true });
  }

  async list(): Promise<Array<OutboundMessage & { jobId: string; state: string; error?: string }>> {
    const jobs = await this.getQueue().getJobs(['waiting', 'active', 'delayed', 'failed'], 0, 99);
    return Promise.all(jobs.map(async (job) => ({ ...job.data, jobId: job.id!, state: await job.getState(), error: job.failedReason || undefined })));
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  async retry(id: string): Promise<void> {
    const job = await this.getQueue().getJob(id);
    if (!job || await job.getState() !== 'failed') throw new Error('Only failed queued messages can be retried.');
    await job.retry();
  }

  async cancel(id: string): Promise<void> {
    const job = await this.getQueue().getJob(id);
    if (!job) throw new Error('Queued message not found.');
    await job.remove();
  }
}

export { UnrecoverableError };
