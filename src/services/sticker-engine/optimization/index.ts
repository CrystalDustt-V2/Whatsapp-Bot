import sharp from 'sharp';

export class StickerOptimizer {
  async optimize(buffer: Buffer, quality: number = 80): Promise<Buffer> {
    return sharp(buffer)
      .webp({ quality, effort: 6 })
      .toBuffer();
  }

  async compress(buffer: Buffer, maxSizeKB: number = 500): Promise<Buffer> {
    let result = buffer;
    let quality = 100;
    
    while (result.length > maxSizeKB * 1024 && quality > 10) {
      quality -= 10;
      result = await this.optimize(buffer, quality);
    }
    
    return result;
  }
}

export default StickerOptimizer;
