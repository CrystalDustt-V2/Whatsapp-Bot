import AudioProcessor from './audio-processor';
import type {
  AudioConversionOptions,
  AudioEffectOptions,
  AudioInfo,
} from './audio-types';
import MediaCompressor from './compression';
import MediaConverter from './conversion';
import GifProcessor from './gif-processor';
import type {
  GifCreationOptions,
  ImageToGifOptions,
} from './gif-types';
import type { ImageEditOptions } from './image-editor';
import ImageEditor from './image-editor';
import MetadataProcessor from './metadata-processor';
import type {
  MediaMetadata,
  MetadataEditOptions,
} from './metadata-types';
import type { CompressionOptions, ConversionOptions } from './types';
import VideoProcessor from './video-processor';
import type {
  AudioExtractionOptions,
  VideoConversionOptions,
  VideoInfo,
  VideoSpeedOptions,
  VideoTrimOptions,
} from './video-types';

export class MediaEngine {
  private compressor: MediaCompressor;
  private converter: MediaConverter;
  private videoProcessor: VideoProcessor;
  private audioProcessor: AudioProcessor;
  private gifProcessor: GifProcessor;
  private metadataProcessor: MetadataProcessor;
  private imageEditor: ImageEditor;

  constructor() {
    this.compressor = new MediaCompressor();
    this.converter = new MediaConverter();
    this.videoProcessor = new VideoProcessor();
    this.audioProcessor = new AudioProcessor();
    this.gifProcessor = new GifProcessor();
    this.metadataProcessor = new MetadataProcessor();
    this.imageEditor = new ImageEditor();
  }

  async compressImage(buffer: Buffer, options?: CompressionOptions): Promise<Buffer> {
    return this.compressor.compressImage(buffer, options);
  }

  async convertImage(buffer: Buffer, options: ConversionOptions): Promise<Buffer> {
    return this.converter.convertImage(buffer, options);
  }

  async imageToWebP(buffer: Buffer, options?: CompressionOptions): Promise<Buffer> {
    return this.compressor.convertToWebP(buffer, options);
  }

  async getVideoInfo(buffer: Buffer): Promise<VideoInfo> {
    return this.videoProcessor.getVideoInfo(buffer);
  }

  async convertVideo(buffer: Buffer, options: VideoConversionOptions): Promise<Buffer> {
    return this.videoProcessor.convert(buffer, options);
  }

  async trimVideo(buffer: Buffer, options: VideoTrimOptions): Promise<Buffer> {
    return this.videoProcessor.trim(buffer, options);
  }

  async changeVideoSpeed(buffer: Buffer, options: VideoSpeedOptions): Promise<Buffer> {
    return this.videoProcessor.changeSpeed(buffer, options);
  }

  async extractAudio(buffer: Buffer, options: AudioExtractionOptions): Promise<Buffer> {
    return this.videoProcessor.extractAudio(buffer, options);
  }

  getCompressor(): MediaCompressor {
    return this.compressor;
  }

  getConverter(): MediaConverter {
    return this.converter;
  }

  getVideoProcessor(): VideoProcessor {
    return this.videoProcessor;
  }

  async getAudioInfo(buffer: Buffer): Promise<AudioInfo> {
    return this.audioProcessor.getAudioInfo(buffer);
  }

  async convertAudio(buffer: Buffer, options: AudioConversionOptions): Promise<Buffer> {
    return this.audioProcessor.convert(buffer, options);
  }

  async applyAudioEffect(buffer: Buffer, options: AudioEffectOptions): Promise<Buffer> {
    return this.audioProcessor.applyEffect(buffer, options);
  }

  async bassBoost(buffer: Buffer, options?: { gain?: number; frequency?: number }): Promise<Buffer> {
    return this.audioProcessor.bassBoost(buffer, {
      effect: 'bass_boost',
      ...options,
    } as any);
  }

  async nightcore(buffer: Buffer, options?: { speed?: number; pitch?: number }): Promise<Buffer> {
    return this.audioProcessor.nightcore(buffer, {
      effect: 'nightcore',
      ...options,
    } as any);
  }

  async reverb(buffer: Buffer, options?: { delay?: number; decay?: number }): Promise<Buffer> {
    return this.audioProcessor.reverb(buffer, {
      effect: 'reverb',
      ...options,
    } as any);
  }

  async echo(buffer: Buffer, options?: { delay?: number; decay?: number }): Promise<Buffer> {
    return this.audioProcessor.echo(buffer, {
      effect: 'echo',
      ...options,
    } as any);
  }

  async compressAudio(buffer: Buffer, options?: { threshold?: number; ratio?: number; attack?: number; release?: number }): Promise<Buffer> {
    return this.audioProcessor.compressor(buffer, {
      effect: 'compressor',
      ...options,
    } as any);
  }

  async vocalRemover(buffer: Buffer): Promise<Buffer> {
    return this.audioProcessor.vocalRemover(buffer);
  }

  getAudioProcessor(): AudioProcessor {
    return this.audioProcessor;
  }

  async imageToGif(buffer: Buffer, options?: ImageToGifOptions): Promise<Buffer> {
    return this.gifProcessor.imageToGif(buffer, options);
  }

  async multipleImagesToGif(buffers: Buffer[], options?: GifCreationOptions): Promise<Buffer> {
    return this.gifProcessor.multipleImagesToGif(buffers, options);
  }

  async videoToGif(buffer: Buffer, options?: GifCreationOptions): Promise<Buffer> {
    return this.gifProcessor.videoToGif(buffer, options);
  }

  getGifProcessor(): GifProcessor {
    return this.gifProcessor;
  }

  async extractMetadata(buffer: Buffer, ext?: string): Promise<MediaMetadata> {
    return this.metadataProcessor.extract(buffer, ext);
  }

  async editMetadata(
    buffer: Buffer,
    ext: string,
    options: MetadataEditOptions
  ): Promise<Buffer> {
    return this.metadataProcessor.edit(buffer, ext, options);
  }

  async removeMetadata(buffer: Buffer, ext: string): Promise<Buffer> {
    return this.metadataProcessor.removeMetadata(buffer, ext);
  }

  getMetadataProcessor(): MetadataProcessor {
    return this.metadataProcessor;
  }

  async editImage(buffer: Buffer, options: ImageEditOptions): Promise<Buffer> {
    return this.imageEditor.edit(buffer, options);
  }

  async blurImage(buffer: Buffer, amount?: number): Promise<Buffer> {
    return this.imageEditor.blur(buffer, amount);
  }

  async sharpenImage(buffer: Buffer): Promise<Buffer> {
    return this.imageEditor.sharpen(buffer);
  }

  async grayscaleImage(buffer: Buffer): Promise<Buffer> {
    return this.imageEditor.grayscale(buffer);
  }

  async sepiaImage(buffer: Buffer): Promise<Buffer> {
    return this.imageEditor.sepia(buffer);
  }

  async resizeImage(buffer: Buffer, width: number, height?: number): Promise<Buffer> {
    return this.imageEditor.resize(buffer, width, height);
  }

  async rotateImage(buffer: Buffer, degrees: number): Promise<Buffer> {
    return this.imageEditor.rotate(buffer, degrees);
  }

  async flipImageHorizontal(buffer: Buffer): Promise<Buffer> {
    return this.imageEditor.flipHorizontal(buffer);
  }

  async flipImageVertical(buffer: Buffer): Promise<Buffer> {
    return this.imageEditor.flipVertical(buffer);
  }

  getImageEditor(): ImageEditor {
    return this.imageEditor;
  }
}

export const mediaEngine = new MediaEngine();
export default mediaEngine;
