import ffmpeg from 'fluent-ffmpeg';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { promisify } from 'util';
import type {
  VideoConversionOptions,
  VideoTrimOptions,
  VideoSpeedOptions,
  AudioExtractionOptions,
  VideoInfo,
} from './video-types';
import logger from '../../core/logger';

const unlink = promisify(fs.unlink);
const writeFile = promisify(fs.writeFile);

export class VideoProcessor {
  private tempDir: string;

  constructor() {
    this.tempDir = path.join(os.tmpdir(), 'whatsapp-bot-videos');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  private getTempPath(ext: string): string {
    return path.join(this.tempDir, `${Date.now()}-${Math.random().toString(36).substr(2, 9)}.${ext}`);
  }

  async getVideoInfo(buffer: Buffer): Promise<VideoInfo> {
    const tempInput = this.getTempPath('mp4');
    await writeFile(tempInput, buffer);

    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(tempInput, (err, metadata) => {
        this.cleanupTempFile(tempInput).catch(() => {});
        if (err) {
          reject(err);
          return;
        }

        const videoStream = metadata.streams.find(s => s.codec_type === 'video');
        const audioStream = metadata.streams.find(s => s.codec_type === 'audio');

        resolve({
          duration: metadata.format.duration || 0,
          width: videoStream?.width || 0,
          height: videoStream?.height || 0,
          fps: videoStream?.r_frame_rate ? parseInt(videoStream.r_frame_rate.split('/')[0]) / parseInt(videoStream.r_frame_rate.split('/')[1]) : 30,
          bitrate: metadata.format.bit_rate || 0,
          format: metadata.format.format_name || 'unknown',
          hasAudio: !!audioStream,
        });
      });
    });
  }

  async convert(
    buffer: Buffer,
    options: VideoConversionOptions
  ): Promise<Buffer> {
    const tempInput = this.getTempPath('mp4');
    const tempOutput = this.getTempPath(options.format);

    await writeFile(tempInput, buffer);

    return new Promise((resolve, reject) => {
      let command = ffmpeg(tempInput);

      if (options.width || options.height) {
        command = command.size(`${options.width || '?'}x${options.height || '?'}`);
      }

      if (options.fps) {
        command = command.fps(options.fps);
      }

      command
        .output(tempOutput)
        .on('end', async () => {
          const outputBuffer = fs.readFileSync(tempOutput);
          await this.cleanupTempFile(tempInput);
          await this.cleanupTempFile(tempOutput);
          resolve(outputBuffer);
        })
        .on('error', async (err) => {
          await this.cleanupTempFile(tempInput);
          await this.cleanupTempFile(tempOutput);
          logger.error({ err }, 'Video conversion failed');
          reject(err);
        })
        .run();
    });
  }

  async trim(buffer: Buffer, options: VideoTrimOptions): Promise<Buffer> {
    const tempInput = this.getTempPath('mp4');
    const tempOutput = this.getTempPath('mp4');

    await writeFile(tempInput, buffer);

    return new Promise((resolve, reject) => {
      ffmpeg(tempInput)
        .setStartTime(options.startTime)
        .setDuration(options.duration)
        .output(tempOutput)
        .on('end', async () => {
          const outputBuffer = fs.readFileSync(tempOutput);
          await this.cleanupTempFile(tempInput);
          await this.cleanupTempFile(tempOutput);
          resolve(outputBuffer);
        })
        .on('error', async (err) => {
          await this.cleanupTempFile(tempInput);
          await this.cleanupTempFile(tempOutput);
          logger.error({ err }, 'Video trim failed');
          reject(err);
        })
        .run();
    });
  }

  async changeSpeed(buffer: Buffer, options: VideoSpeedOptions): Promise<Buffer> {
    const tempInput = this.getTempPath('mp4');
    const tempOutput = this.getTempPath('mp4');

    await writeFile(tempInput, buffer);

    return new Promise((resolve, reject) => {
      const speed = options.speed;
      
      ffmpeg(tempInput)
        .videoFilters(`setpts=${1/speed}*PTS`)
        .audioFilters(`atempo=${speed}`)
        .output(tempOutput)
        .on('end', async () => {
          const outputBuffer = fs.readFileSync(tempOutput);
          await this.cleanupTempFile(tempInput);
          await this.cleanupTempFile(tempOutput);
          resolve(outputBuffer);
        })
        .on('error', async (err) => {
          await this.cleanupTempFile(tempInput);
          await this.cleanupTempFile(tempOutput);
          logger.error({ err }, 'Video speed change failed');
          reject(err);
        })
        .run();
    });
  }

  async extractAudio(buffer: Buffer, options: AudioExtractionOptions): Promise<Buffer> {
    const tempInput = this.getTempPath('mp4');
    const tempOutput = this.getTempPath(options.format);

    await writeFile(tempInput, buffer);

    return new Promise((resolve, reject) => {
      let command = ffmpeg(tempInput).noVideo();

      if (options.bitrate) {
        command = command.audioBitrate(options.bitrate);
      }

      command
        .output(tempOutput)
        .on('end', async () => {
          const outputBuffer = fs.readFileSync(tempOutput);
          await this.cleanupTempFile(tempInput);
          await this.cleanupTempFile(tempOutput);
          resolve(outputBuffer);
        })
        .on('error', async (err) => {
          await this.cleanupTempFile(tempInput);
          await this.cleanupTempFile(tempOutput);
          logger.error({ err }, 'Audio extraction failed');
          reject(err);
        })
        .run();
    });
  }

  async toGif(buffer: Buffer, options?: { fps?: number; width?: number }): Promise<Buffer> {
    const tempInput = this.getTempPath('mp4');
    const tempOutput = this.getTempPath('gif');

    await writeFile(tempInput, buffer);

    return new Promise((resolve, reject) => {
      let command = ffmpeg(tempInput);

      if (options?.fps) {
        command = command.fps(options.fps);
      }

      if (options?.width) {
        command = command.size(`${options.width}x?`);
      }

      command
        .output(tempOutput)
        .on('end', async () => {
          const outputBuffer = fs.readFileSync(tempOutput);
          await this.cleanupTempFile(tempInput);
          await this.cleanupTempFile(tempOutput);
          resolve(outputBuffer);
        })
        .on('error', async (err) => {
          await this.cleanupTempFile(tempInput);
          await this.cleanupTempFile(tempOutput);
          logger.error({ err }, 'Video to GIF failed');
          reject(err);
        })
        .run();
    });
  }

  private async cleanupTempFile(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
    } catch (err) {
      logger.warn({ err, filePath }, 'Failed to cleanup temp file');
    }
  }
}

export default VideoProcessor;
