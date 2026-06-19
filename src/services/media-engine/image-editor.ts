import sharp from 'sharp';

export interface ImageEditOptions {
  blur?: number;
  sharpen?: boolean;
  grayscale?: boolean;
  sepia?: boolean;
  width?: number;
  height?: number;
  rotate?: number;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
  brightness?: number;
  saturation?: number;
  contrast?: number;
}

export class ImageEditor {
  async edit(buffer: Buffer, options: ImageEditOptions): Promise<Buffer> {
    let pipeline = sharp(buffer);

    if (options.width || options.height) {
      pipeline = pipeline.resize(options.width || null, options.height || null, {
        fit: 'cover',
      });
    }

    if (options.blur && options.blur > 0) {
      pipeline = pipeline.blur(options.blur);
    }

    if (options.sharpen) {
      pipeline = pipeline.sharpen();
    }

    if (options.grayscale) {
      pipeline = pipeline.grayscale();
    }

    if (options.sepia) {
      pipeline = pipeline.modulate({ saturation: 0.8 }).tint({ r: 112, g: 66, b: 20 });
    }

    if (options.rotate) {
      pipeline = pipeline.rotate(options.rotate);
    }

    if (options.flipHorizontal) {
      pipeline = pipeline.flop();
    }

    if (options.flipVertical) {
      pipeline = pipeline.flip();
    }

    if (options.brightness) {
      pipeline = pipeline.modulate({ brightness: options.brightness });
    }

    if (options.saturation) {
      pipeline = pipeline.modulate({ saturation: options.saturation });
    }

    if (options.contrast) {
      pipeline = pipeline.modulate({ lightness: options.contrast });
    }

    return pipeline.toBuffer();
  }

  async blur(buffer: Buffer, amount: number = 5): Promise<Buffer> {
    return this.edit(buffer, { blur: amount });
  }

  async sharpen(buffer: Buffer): Promise<Buffer> {
    return this.edit(buffer, { sharpen: true });
  }

  async grayscale(buffer: Buffer): Promise<Buffer> {
    return this.edit(buffer, { grayscale: true });
  }

  async sepia(buffer: Buffer): Promise<Buffer> {
    return this.edit(buffer, { sepia: true });
  }



  async resize(buffer: Buffer, width: number, height?: number): Promise<Buffer> {
    return this.edit(buffer, { width, height });
  }

  async rotate(buffer: Buffer, degrees: number): Promise<Buffer> {
    return this.edit(buffer, { rotate: degrees });
  }

  async flipHorizontal(buffer: Buffer): Promise<Buffer> {
    return this.edit(buffer, { flipHorizontal: true });
  }

  async flipVertical(buffer: Buffer): Promise<Buffer> {
    return this.edit(buffer, { flipVertical: true });
  }

  async adjustBrightness(buffer: Buffer, amount: number): Promise<Buffer> {
    return this.edit(buffer, { brightness: amount });
  }

  async adjustSaturation(buffer: Buffer, amount: number): Promise<Buffer> {
    return this.edit(buffer, { saturation: amount });
  }

  async adjustContrast(buffer: Buffer, amount: number): Promise<Buffer> {
    return this.edit(buffer, { contrast: amount });
  }
}

export default ImageEditor;
