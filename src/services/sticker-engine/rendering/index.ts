import sharp from 'sharp';
import type { StickerOptions } from '../types';

export class StickerRenderer {
  async processImage(
    buffer: Buffer,
    options: StickerOptions = {}
  ): Promise<Buffer> {
    const width = options.width || 512;
    const height = options.height || 512;
    const quality = options.quality || 100;
    const resizeOptions: sharp.ResizeOptions = options.smartCrop
      ? {
          fit: 'cover',
          position: sharp.strategy.attention,
        }
      : {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        };

    return sharp(buffer)
      .resize(width, height, resizeOptions)
      .webp({ quality })
      .toBuffer();
  }

  async applyShape(
    buffer: Buffer,
    type: 'circle' | 'rounded' = 'rounded',
    radius = 50
  ): Promise<Buffer> {
    if (type === 'circle') {
      const { width, height } = await sharp(buffer).metadata();
      const size = Math.min(width || 512, height || 512);
      const circleSvg = `
        <svg width="${size}" height="${size}">
          <circle cx="${size/2}" cy="${size/2}" r="${size/2}"/>
        </svg>
      `;
      return sharp(buffer)
        .resize(size, size, { fit: 'cover' })
        .composite([{ input: Buffer.from(circleSvg), blend: 'dest-in' }])
        .webp({ quality: 100 })
        .toBuffer();
    } else {
      return sharp(buffer)
        .resize(512, 512, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .webp({ quality: 100 })
        .toBuffer();
    }
  }

  async applyBlackAndWhite(buffer: Buffer): Promise<Buffer> {
    return sharp(buffer)
      .resize(512, 512, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .grayscale()
      .webp({ quality: 100 })
      .toBuffer();
  }

  async applySepia(buffer: Buffer): Promise<Buffer> {
    return sharp(buffer)
      .resize(512, 512, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .modulate({
        saturation: 0.3,
        brightness: 1.1
      })
      .tint({ r: 112, g: 66, b: 20 })
      .webp({ quality: 100 })
      .toBuffer();
  }

  async applyVintage(buffer: Buffer): Promise<Buffer> {
    return sharp(buffer)
      .resize(512, 512, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .modulate({
        brightness: 1.05,
        saturation: 0.6
      })
      .tint({ r: 245, g: 200, b: 130 })
      .webp({ quality: 100 })
      .toBuffer();
  }

  async applyCartoon(buffer: Buffer): Promise<Buffer> {
    return sharp(buffer)
      .resize(512, 512, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .modulate({
        saturation: 1.5,
        brightness: 1.1
      })
      .sharpen(2, 1.5, 2)
      .webp({ quality: 100 })
      .toBuffer();
  }

  async applyGlitch(buffer: Buffer): Promise<Buffer> {
    const { width, height } = await sharp(buffer).metadata();
    const w = width || 512;
    const h = height || 512;

    const base = await sharp(buffer)
      .resize(w, h, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .raw()
      .toBuffer();

    const glitchBuffer = Buffer.from(base);
    const glitchAmount = Math.floor(w * 0.05);

    for (let y = 0; y < h; y += Math.floor(Math.random() * 20) + 10) {
      const offset = y * w * 4;
      const shift = Math.floor(Math.random() * glitchAmount) - glitchAmount / 2;
      for (let x = 0; x < w * 4; x++) {
        const srcX = (x + shift * 4 + w * 4) % (w * 4);
        glitchBuffer[offset + x] = base[offset + srcX];
      }
    }

    return sharp(glitchBuffer, { raw: { width: w, height: h, channels: 4 } })
      .webp({ quality: 100 })
      .toBuffer();
  }
}

export default StickerRenderer;
