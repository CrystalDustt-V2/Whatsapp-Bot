import ffmpeg from 'fluent-ffmpeg';
import sharp from 'sharp';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { promisify } from 'util';
import type { GifCreationOptions, ImageToGifOptions } from './gif-types';
import logger from '../../core/logger';

const unlink = promisify(fs.unlink);
const writeFile = promisify(fs.writeFile);

export class GifProcessor {
  private tempDir: string;

  constructor() {
    this.tempDir = path.join(os.tmpdir(), 'whatsapp-bot-gifs');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  private getTempPath(ext: string): string {
    return path.join(this.tempDir, `${Date.now()}-${Math.random().toString(36).substr(2, 9)}.${ext}`);
  }

  async imageToGif(
    buffer: Buffer,
    options?: ImageToGifOptions
  ): Promise<Buffer> {
    const tempInput = this.getTempPath('png');
    const tempOutput = this.getTempPath('gif');
    
    await writeFile(tempInput, buffer);

    let processedBuffer = buffer;
    if (options?.width || options?.height) {
      processedBuffer = await sharp(buffer)
        .resize(options.width || options.height || 512, options.height || options.width || 512, {
          fit: 'cover',
        })
        .png()
        .toBuffer();
      await writeFile(tempInput, processedBuffer);
    }

    return new Promise((resolve, reject) => {
      ffmpeg(tempInput)
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
          logger.error({ err }, 'Image to GIF failed');
          reject(err);
        })
        .run();
    });
  }

  async multipleImagesToGif(
    buffers: Buffer[],
    options?: GifCreationOptions
  ): Promise<Buffer> {
    const tempDir = this.getTempPath('dir');
    const tempOutput = this.getTempPath('gif');

    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    try {
      const fps = options?.fps || 10;
      
      for (let i = 0; i < buffers.length; i++) {
        const imgPath = path.join(tempDir, `frame-${String(i).padStart(4, '0')}.png`);
        let processedBuffer = buffers[i];
        
        if (options?.width || options?.height) {
          processedBuffer = await sharp(buffers[i])
            .resize(options.width || 512, options.height || 512, {
              fit: 'cover',
            })
            .png()
            .toBuffer();
        }
        
        await writeFile(imgPath, processedBuffer);
      }

      return new Promise((resolve, reject) => {
        ffmpeg(path.join(tempDir, 'frame-%04d.png'))
          .inputFPS(fps)
          .output(tempOutput)
          .loop(options?.loop !== undefined ? options.loop : 0)
          .on('end', async () => {
            const outputBuffer = fs.readFileSync(tempOutput);
            await this.cleanupTempDir(tempDir);
            await this.cleanupTempFile(tempOutput);
            resolve(outputBuffer);
          })
          .on('error', async (err) => {
            await this.cleanupTempDir(tempDir);
            await this.cleanupTempFile(tempOutput);
            logger.error({ err }, 'Multiple images to GIF failed');
            reject(err);
          })
          .run();
      });
    } catch (err) {
      await this.cleanupTempDir(tempDir);
      throw err;
    }
  }

  async videoToGif(
    buffer: Buffer,
    options?: GifCreationOptions
  ): Promise<Buffer> {
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
      } else if (options?.height) {
        command = command.size(`?x${options.height}`);
      }

      if (options?.loop !== undefined) {
        command = command.loop(options.loop);
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

  private async cleanupTempDir(dirPath: string): Promise<void> {
    try {
      if (fs.existsSync(dirPath)) {
        const files = fs.readdirSync(dirPath);
        for (const file of files) {
          const filePath = path.join(dirPath, file);
          if (fs.statSync(filePath).isDirectory()) {
            await this.cleanupTempDir(filePath);
          } else {
            await unlink(filePath);
          }
        }
        fs.rmdirSync(dirPath);
      }
    } catch (err) {
      logger.warn({ err, dirPath }, 'Failed to cleanup temp dir');
    }
  }
}

export default GifProcessor;
