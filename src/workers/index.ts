import { queueManager, QueueName } from '../core/queue-manager';
import { MessageWorker } from './message-worker';
import { StickerWorker } from './sticker-worker';
import { DownloaderWorker } from './downloader-worker';
import { AIWorker } from './ai-worker';
import logger from '../core/logger';

const messageWorker = new MessageWorker();
const stickerWorker = new StickerWorker();
const downloaderWorker = new DownloaderWorker();
const aiWorker = new AIWorker();

export function registerWorkers(): void {
  logger.info('Registering workers...');

  queueManager.registerWorker(QueueName.MESSAGE, messageWorker.process.bind(messageWorker));
  queueManager.registerWorker(QueueName.STICKER, stickerWorker.process.bind(stickerWorker));
  queueManager.registerWorker(QueueName.DOWNLOADER, downloaderWorker.process.bind(downloaderWorker));
  queueManager.registerWorker(QueueName.AI, aiWorker.process.bind(aiWorker));

  logger.info('All workers registered');
}

export default registerWorkers;
