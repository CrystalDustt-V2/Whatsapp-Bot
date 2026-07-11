import sharp from 'sharp';
import type { StickerOptions } from '../types';

const BLANK_TRIM_THRESHOLD = 12;
const ANALYSIS_SIZE = 256;
const BACKGROUND_DISTANCE_THRESHOLD = 30;
const CONTENT_PADDING_RATIO = 0.06;
const MAX_FULL_FRAME_COVERAGE = 0.94;

type Bounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type Rgba = {
  r: number;
  g: number;
  b: number;
  a: number;
};

export class StickerRenderer {
  async processImage(
    buffer: Buffer,
    options: StickerOptions = {}
  ): Promise<Buffer> {
    const width = options.width || 512;
    const height = options.height || 512;
    const quality = options.quality || 100;

    if (options.smartCrop) {
      return this.processSmartCrop(buffer, width, height, quality);
    }

    return sharp(buffer)
      .resize(width, height, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .webp({ quality })
      .toBuffer();
  }

  private async processSmartCrop(buffer: Buffer, width: number, height: number, quality: number): Promise<Buffer> {
    try {
      const content = await this.extractContentBounds(buffer);
      return await sharp(content)
        .trim({ threshold: BLANK_TRIM_THRESHOLD })
        .resize(width, height, {
          fit: 'cover',
          position: sharp.strategy.attention,
        })
        .webp({ quality })
        .toBuffer();
    } catch {
      return sharp(buffer)
        .rotate()
        .resize(width, height, {
          fit: 'cover',
          position: sharp.strategy.attention,
        })
        .webp({ quality })
        .toBuffer();
    }
  }

  private async extractContentBounds(buffer: Buffer): Promise<Buffer> {
    const normalized = await sharp(buffer).rotate().png().toBuffer();
    const metadata = await sharp(normalized).metadata();
    const sourceWidth = metadata.width || 0;
    const sourceHeight = metadata.height || 0;
    if (!sourceWidth || !sourceHeight) return normalized;

    const { data, info } = await sharp(normalized)
      .resize(ANALYSIS_SIZE, ANALYSIS_SIZE, { fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const background = this.getEdgeBackground(data, info.width, info.height, info.channels);
    const bounds = this.findForegroundBounds(data, info.width, info.height, info.channels, background);
    if (!bounds) return normalized;

    const coverageX = bounds.width / info.width;
    const coverageY = bounds.height / info.height;
    if (coverageX >= MAX_FULL_FRAME_COVERAGE && coverageY >= MAX_FULL_FRAME_COVERAGE) return normalized;

    const pad = Math.max(2, Math.round(Math.max(bounds.width, bounds.height) * CONTENT_PADDING_RATIO));
    const padded = {
      left: Math.max(0, bounds.left - pad),
      top: Math.max(0, bounds.top - pad),
      right: Math.min(info.width - 1, bounds.left + bounds.width - 1 + pad),
      bottom: Math.min(info.height - 1, bounds.top + bounds.height - 1 + pad),
    };
    const scaleX = sourceWidth / info.width;
    const scaleY = sourceHeight / info.height;
    const extract: Bounds = {
      left: Math.floor(padded.left * scaleX),
      top: Math.floor(padded.top * scaleY),
      width: Math.min(sourceWidth, Math.ceil((padded.right - padded.left + 1) * scaleX)),
      height: Math.min(sourceHeight, Math.ceil((padded.bottom - padded.top + 1) * scaleY)),
    };

    return sharp(normalized).extract(extract).toBuffer();
  }

  private getEdgeBackground(data: Buffer, width: number, height: number, channels: number): Rgba {
    const sampleSize = Math.max(2, Math.min(10, Math.floor(Math.min(width, height) * 0.06)));
    const samples: Rgba[] = [];

    for (const [startX, startY] of [
      [0, 0],
      [width - sampleSize, 0],
      [0, height - sampleSize],
      [width - sampleSize, height - sampleSize],
    ]) {
      for (let y = startY; y < startY + sampleSize; y += 1) {
        for (let x = startX; x < startX + sampleSize; x += 1) {
          const offset = (y * width + x) * channels;
          samples.push({ r: data[offset], g: data[offset + 1], b: data[offset + 2], a: data[offset + 3] });
        }
      }
    }

    return samples.reduce(
      (sum, pixel) => ({
        r: sum.r + pixel.r / samples.length,
        g: sum.g + pixel.g / samples.length,
        b: sum.b + pixel.b / samples.length,
        a: sum.a + pixel.a / samples.length,
      }),
      { r: 0, g: 0, b: 0, a: 0 }
    );
  }

  private findForegroundBounds(data: Buffer, width: number, height: number, channels: number, background: Rgba): Bounds | null {
    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * channels;
        const distance =
          Math.abs(data[offset] - background.r) +
          Math.abs(data[offset + 1] - background.g) +
          Math.abs(data[offset + 2] - background.b) +
          Math.abs(data[offset + 3] - background.a);
        if (distance <= BACKGROUND_DISTANCE_THRESHOLD) continue;

        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }

    if (right < left || bottom < top) return null;
    return { left, top, width: right - left + 1, height: bottom - top + 1 };
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
