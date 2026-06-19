import ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';
import { promisify } from 'util';
import logger from '../../core/logger';
import type { MediaMetadata, MetadataEditOptions } from './metadata-types';

const unlink = promisify(fs.unlink);
const writeFile = promisify(fs.writeFile);

export class MetadataProcessor {
  private tempDir: string;

  constructor() {
    this.tempDir = path.join(os.tmpdir(), 'whatsapp-bot-metadata');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  private getTempPath(ext: string): string {
    return path.join(this.tempDir, `${Date.now()}-${Math.random().toString(36).substr(2, 9)}.${ext}`);
  }

  async extract(buffer: Buffer, ext: string = 'jpg'): Promise<MediaMetadata> {
    const tempInput = this.getTempPath(ext);
    await writeFile(tempInput, buffer);

    try {
      const metadata: MediaMetadata = {
        format: ext,
        size: buffer.length,
      };

      if (['mp4', 'webm', 'avi', 'mov', 'mkv'].includes(ext.toLowerCase())) {
        const videoMeta = await this.extractVideoMetadata(tempInput);
        Object.assign(metadata, videoMeta);
      } else if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext.toLowerCase())) {
        const imageMeta = await this.extractImageMetadata(buffer);
        Object.assign(metadata, imageMeta);
      } else if (['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext.toLowerCase())) {
        const audioMeta = await this.extractAudioMetadata(tempInput);
        Object.assign(metadata, audioMeta);
      }

      return metadata;
    } finally {
      await this.cleanupTempFile(tempInput);
    }
  }

  private async extractImageMetadata(buffer: Buffer): Promise<Partial<MediaMetadata>> {
    try {
      const imageInfo = await sharp(buffer).metadata();
      return {
        width: imageInfo.width,
        height: imageInfo.height,
        format: imageInfo.format,
        exif: imageInfo.exif,
      };
    } catch (err) {
      logger.warn({ err }, 'Failed to extract image EXIF');
      return {};
    }
  }

  private async extractVideoMetadata(filePath: string): Promise<Partial<MediaMetadata>> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          reject(err);
          return;
        }

        const videoStream = metadata.streams.find(s => s.codec_type === 'video');
        const audioStream = metadata.streams.find(s => s.codec_type === 'audio');

        resolve({
          duration: metadata.format.duration,
          bitrate: typeof metadata.format.bit_rate === 'string' ? parseInt(metadata.format.bit_rate) : undefined,
          format: metadata.format.format_name,
          video: videoStream ? {
            codec: videoStream.codec_name || 'unknown',
            width: videoStream.width || 0,
            height: videoStream.height || 0,
            fps: videoStream.r_frame_rate ? parseInt(videoStream.r_frame_rate.split('/')[0]) / parseInt(videoStream.r_frame_rate.split('/')[1]) : 30,
            bitrate: videoStream.bit_rate ? parseInt(videoStream.bit_rate) : undefined,
          } : undefined,
          audio: audioStream ? {
            codec: audioStream.codec_name || 'unknown',
            sampleRate: audioStream.sample_rate || 44100,
            channels: audioStream.channels || 2,
            bitrate: audioStream.bit_rate ? parseInt(audioStream.bit_rate) : undefined,
          } : undefined,
        });
      });
    });
  }

  private async extractAudioMetadata(filePath: string): Promise<Partial<MediaMetadata>> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          reject(err);
          return;
        }

        const audioStream = metadata.streams.find(s => s.codec_type === 'audio');

        resolve({
          duration: metadata.format.duration,
          bitrate: typeof metadata.format.bit_rate === 'string' ? parseInt(metadata.format.bit_rate) : undefined,
          format: metadata.format.format_name,
          audio: audioStream ? {
            codec: audioStream.codec_name || 'unknown',
            sampleRate: audioStream.sample_rate || 44100,
            channels: audioStream.channels || 2,
            bitrate: audioStream.bit_rate ? parseInt(audioStream.bit_rate) : undefined,
          } : undefined,
        });
      });
    });
  }

  async edit(
    buffer: Buffer,
    ext: string,
    options: MetadataEditOptions
  ): Promise<Buffer> {
    const tempInput = this.getTempPath(ext);
    const tempOutput = this.getTempPath(ext);

    await writeFile(tempInput, buffer);

    try {
      if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext.toLowerCase())) {
        return await this.editImageMetadata(buffer, options);
      }

      return buffer;
    } finally {
      await this.cleanupTempFile(tempInput);
      await this.cleanupTempFile(tempOutput);
    }
  }

  private async editImageMetadata(
    buffer: Buffer,
    options: MetadataEditOptions
  ): Promise<Buffer> {
    let pipeline = sharp(buffer);

    if (options.removeAllTags) {
      pipeline = pipeline.withMetadata({});
    } else if (options.exif) {
      pipeline = pipeline.withMetadata({
        exif: options.exif as any,
      });
    }

    return pipeline.toBuffer();
  }

  async removeMetadata(buffer: Buffer, ext: string): Promise<Buffer> {
    if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext.toLowerCase())) {
      return sharp(buffer).withMetadata({}).toBuffer();
    }
    return buffer;
  }

  private async cleanupTempFile(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
    } catch (err) {
      logger.warn({ err, filePath }, 'Failed to cleanup temp file');
    }
  }
}

export default MetadataProcessor;
