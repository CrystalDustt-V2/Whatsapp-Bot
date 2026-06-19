import sharp from 'sharp';
import { Readable } from 'stream';
import { CompressionOptions } from './types';

export class MediaCompressor {
  async compressImage(
    buffer: Buffer,
    options: CompressionOptions = {}
  ): Promise<Buffer> {
    const {
      quality = 80,
      maxWidth = 1920,
      maxHeight = 1080,
    } = options;

    let pipeline = sharp(buffer).resize(maxWidth, maxHeight, {
      fit: 'inside',
      withoutEnlargement: true,
    });

    const metadata = await sharp(buffer).metadata();
    if (metadata.format === 'jpeg' || metadata.format === 'jpg') {
      pipeline = pipeline.jpeg({ quality });
    } else if (metadata.format === 'png') {
      pipeline = pipeline.png({ quality });
    } else {
      pipeline = pipeline.webp({ quality });
    }

    return pipeline.toBuffer();
  }

  async convertToWebP(
    buffer: Buffer,
    options: CompressionOptions = {}
  ): Promise<Buffer> {
    const { quality = 80, maxWidth = 512, maxHeight = 512 } = options;

    return sharp(buffer)
      .resize(maxWidth, maxHeight, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .webp({ quality })
      .toBuffer();
  }

  async getBufferFromStream(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    return new Promise((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }
}

export default MediaCompressor;
