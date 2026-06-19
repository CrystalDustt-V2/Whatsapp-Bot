import sharp from 'sharp';
import { ConversionOptions, ImageFormat } from './types';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export class MediaConverter {
  async convertImage(
    buffer: Buffer,
    options: ConversionOptions
  ): Promise<Buffer> {
    const { format, quality = 80, width, height } = options;
    let pipeline = sharp(buffer);

    if (width || height) {
      pipeline = pipeline.resize(width || null, height || null, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      });
    }

    switch (format.toLowerCase()) {
      case ImageFormat.JPG:
      case ImageFormat.JPEG:
        return pipeline.jpeg({ quality }).toBuffer();
      case ImageFormat.PNG:
        return pipeline.png({ quality }).toBuffer();
      case ImageFormat.WEBP:
        return pipeline.webp({ quality }).toBuffer();
      default:
        throw new Error(`Unsupported image format: ${format}`);
    }
  }

  async imageToPDF(
    images: Buffer[],
    outputPath?: string
  ): Promise<Buffer | string> {
    const tempDir = os.tmpdir();
    const tempFiles: string[] = [];

    try {
      for (let i = 0; i < images.length; i++) {
        const tempFile = path.join(tempDir, `pdf-img-${i}.png`);
        await sharp(images[i]).png().toFile(tempFile);
        tempFiles.push(tempFile);
      }

      const pdfBuffer = await sharp(images[0])
        .png()
        .toBuffer();

      return pdfBuffer;
    } finally {
      for (const file of tempFiles) {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      }
    }
  }
}

export default MediaConverter;
