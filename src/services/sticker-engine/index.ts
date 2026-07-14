import StickerRenderer from './rendering';
import StickerOptimizer from './optimization';
import StickerMetadataManager from './metadata';
import type { StickerOptions } from './types';

export class StickerEngine {
  private renderer: StickerRenderer;
  private optimizer: StickerOptimizer;
  private metadataManager: StickerMetadataManager;

  constructor() {
    this.renderer = new StickerRenderer();
    this.optimizer = new StickerOptimizer();
    this.metadataManager = new StickerMetadataManager();
  }

  async createSticker(
    buffer: Buffer,
    options: StickerOptions = {}
  ): Promise<Buffer> {
    let sticker = await this.renderer.processImage(buffer, options);
    sticker = await this.optimizer.optimize(sticker, options.quality || 80);
    sticker = await this.withMetadata(sticker, options);
    return sticker;
  }

  async createShapedSticker(
    buffer: Buffer,
    shape: 'circle' | 'rounded' = 'rounded',
    options: StickerOptions = {}
  ): Promise<Buffer> {
    let sticker = await this.renderer.applyShape(buffer, shape, 50);
    sticker = await this.optimizer.optimize(sticker, options.quality || 80);
    sticker = await this.withMetadata(sticker, options);
    return sticker;
  }

  private async withMetadata(sticker: Buffer, options: StickerOptions): Promise<Buffer> {
    if (options.packName === undefined && options.author === undefined) return sticker;
    return this.metadataManager.addMetadata(sticker, options.packName || '', options.author || '');
  }

  async createBlackAndWhiteSticker(buffer: Buffer): Promise<Buffer> {
    let sticker = await this.renderer.applyBlackAndWhite(buffer);
    sticker = await this.optimizer.optimize(sticker, 80);
    return sticker;
  }

  async createSepiaSticker(buffer: Buffer): Promise<Buffer> {
    let sticker = await this.renderer.applySepia(buffer);
    sticker = await this.optimizer.optimize(sticker, 80);
    return sticker;
  }

  async createVintageSticker(buffer: Buffer): Promise<Buffer> {
    let sticker = await this.renderer.applyVintage(buffer);
    sticker = await this.optimizer.optimize(sticker, 80);
    return sticker;
  }

  async createCartoonSticker(buffer: Buffer): Promise<Buffer> {
    let sticker = await this.renderer.applyCartoon(buffer);
    sticker = await this.optimizer.optimize(sticker, 80);
    return sticker;
  }

  async createGlitchSticker(buffer: Buffer): Promise<Buffer> {
    let sticker = await this.renderer.applyGlitch(buffer);
    sticker = await this.optimizer.optimize(sticker, 80);
    return sticker;
  }

  getRenderer(): StickerRenderer {
    return this.renderer;
  }

  getOptimizer(): StickerOptimizer {
    return this.optimizer;
  }

  getMetadataManager(): StickerMetadataManager {
    return this.metadataManager;
  }
}

export const stickerEngine = new StickerEngine();
export default stickerEngine;
