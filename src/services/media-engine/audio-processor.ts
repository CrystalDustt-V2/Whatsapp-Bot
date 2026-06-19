import ffmpeg from 'fluent-ffmpeg';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { promisify } from 'util';
import { AudioEffect } from './audio-types';
import type {
  AudioConversionOptions,
  AudioEffectOptions,
  AudioInfo,
  BassBoostOptions,
  NightcoreOptions,
  ReverbOptions,
  EchoOptions,
  CompressorOptions,
  AudioFormat,
} from './audio-types';
import logger from '../../core/logger';

const unlink = promisify(fs.unlink);
const writeFile = promisify(fs.writeFile);

export class AudioProcessor {
  private tempDir: string;

  constructor() {
    this.tempDir = path.join(os.tmpdir(), 'whatsapp-bot-audio');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  private getTempPath(ext: string): string {
    return path.join(this.tempDir, `${Date.now()}-${Math.random().toString(36).substr(2, 9)}.${ext}`);
  }

  async getAudioInfo(buffer: Buffer): Promise<AudioInfo> {
    const tempInput = this.getTempPath('mp3');
    await writeFile(tempInput, buffer);

    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(tempInput, (err, metadata) => {
        this.cleanupTempFile(tempInput).catch(() => {});
        if (err) {
          reject(err);
          return;
        }

        const audioStream = metadata.streams.find(s => s.codec_type === 'audio');

        resolve({
          duration: metadata.format.duration || 0,
          bitrate: metadata.format.bit_rate || 0,
          sampleRate: audioStream?.sample_rate || 44100,
          channels: audioStream?.channels || 2,
          format: metadata.format.format_name || 'unknown',
        });
      });
    });
  }

  async convert(buffer: Buffer, options: AudioConversionOptions): Promise<Buffer> {
    const tempInput = this.getTempPath('mp3');
    const tempOutput = this.getTempPath(options.format);

    await writeFile(tempInput, buffer);

    return new Promise((resolve, reject) => {
      let command = ffmpeg(tempInput);

      if (options.bitrate) {
        command = command.audioBitrate(options.bitrate);
      }

      if (options.sampleRate) {
        command = command.audioFrequency(options.sampleRate);
      }

      if (options.channels) {
        command = command.audioChannels(options.channels);
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
          logger.error({ err }, 'Audio conversion failed');
          reject(err);
        })
        .run();
    });
  }

  async applyEffect(buffer: Buffer, options: AudioEffectOptions): Promise<Buffer> {
    switch (options.effect) {
      case AudioEffect.BASS_BOOST:
        return this.bassBoost(buffer, options as BassBoostOptions);
      case AudioEffect.NIGHTCORE:
        return this.nightcore(buffer, options as NightcoreOptions);
      case AudioEffect.REVERB:
        return this.reverb(buffer, options as ReverbOptions);
      case AudioEffect.ECHO:
        return this.echo(buffer, options as EchoOptions);
      case AudioEffect.COMPRESSOR:
        return this.compressor(buffer, options as CompressorOptions);
      case AudioEffect.VOCAL_REMOVER:
        return this.vocalRemover(buffer);
      default:
        throw new Error(`Unknown effect: ${options.effect}`);
    }
  }

  async bassBoost(buffer: Buffer, options: BassBoostOptions): Promise<Buffer> {
    const gain = options.gain || 15;
    const frequency = options.frequency || 100;

    const tempInput = this.getTempPath('mp3');
    const tempOutput = this.getTempPath('mp3');

    await writeFile(tempInput, buffer);

    return new Promise((resolve, reject) => {
      ffmpeg(tempInput)
        .audioFilters(`bass=g=${gain}:f=${frequency}`)
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
          logger.error({ err }, 'Bass boost failed');
          reject(err);
        })
        .run();
    });
  }

  async nightcore(buffer: Buffer, options: NightcoreOptions): Promise<Buffer> {
    const speed = options.speed || 1.25;
    const pitch = options.pitch || 1.25;

    const tempInput = this.getTempPath('mp3');
    const tempOutput = this.getTempPath('mp3');

    await writeFile(tempInput, buffer);

    return new Promise((resolve, reject) => {
      ffmpeg(tempInput)
        .audioFilters([
          `atempo=${speed}`,
          `asetrate=44100*${pitch}`,
          'aresample=44100'
        ])
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
          logger.error({ err }, 'Nightcore failed');
          reject(err);
        })
        .run();
    });
  }

  async reverb(buffer: Buffer, options: ReverbOptions): Promise<Buffer> {
    const delay = options.delay || 500;
    const decay = options.decay || 0.5;

    const tempInput = this.getTempPath('mp3');
    const tempOutput = this.getTempPath('mp3');

    await writeFile(tempInput, buffer);

    return new Promise((resolve, reject) => {
      ffmpeg(tempInput)
        .audioFilters(`aecho=0.8:0.9:${delay}:${decay}`)
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
          logger.error({ err }, 'Reverb failed');
          reject(err);
        })
        .run();
    });
  }

  async echo(buffer: Buffer, options: EchoOptions): Promise<Buffer> {
    const delay = options.delay || 500;
    const decay = options.decay || 0.5;

    const tempInput = this.getTempPath('mp3');
    const tempOutput = this.getTempPath('mp3');

    await writeFile(tempInput, buffer);

    return new Promise((resolve, reject) => {
      ffmpeg(tempInput)
        .audioFilters(`aecho=0.8:0.88:${delay}:${decay}`)
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
          logger.error({ err }, 'Echo failed');
          reject(err);
        })
        .run();
    });
  }

  async compressor(buffer: Buffer, options: CompressorOptions): Promise<Buffer> {
    const threshold = options.threshold || -20;
    const ratio = options.ratio || 4;
    const attack = options.attack || 5;
    const release = options.release || 50;

    const tempInput = this.getTempPath('mp3');
    const tempOutput = this.getTempPath('mp3');

    await writeFile(tempInput, buffer);

    return new Promise((resolve, reject) => {
      ffmpeg(tempInput)
        .audioFilters(`acompressor=threshold=${threshold}dB:ratio=${ratio}:attack=${attack}:release=${release}`)
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
          logger.error({ err }, 'Compressor failed');
          reject(err);
        })
        .run();
    });
  }

  async vocalRemover(buffer: Buffer): Promise<Buffer> {
    const tempInput = this.getTempPath('mp3');
    const tempOutput = this.getTempPath('mp3');

    await writeFile(tempInput, buffer);

    return new Promise((resolve, reject) => {
      ffmpeg(tempInput)
        .audioFilters('afftdn=nf=-20')
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
          logger.error({ err }, 'Vocal remover failed');
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
}

export default AudioProcessor;
