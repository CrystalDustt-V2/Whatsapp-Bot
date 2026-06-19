export enum AudioFormat {
  MP3 = 'mp3',
  WAV = 'wav',
  OGG = 'ogg',
  M4A = 'm4a',
  FLAC = 'flac',
}

export enum AudioEffect {
  BASS_BOOST = 'bass_boost',
  NIGHTCORE = 'nightcore',
  REVERB = 'reverb',
  ECHO = 'echo',
  VOCAL_REMOVER = 'vocal_remover',
  COMPRESSOR = 'compressor',
}

export interface AudioInfo {
  duration: number;
  bitrate: number;
  sampleRate: number;
  channels: number;
  format: string;
}

export interface AudioConversionOptions {
  format: AudioFormat;
  bitrate?: number;
  sampleRate?: number;
  channels?: number;
}

export interface AudioEffectOptions {
  effect: AudioEffect;
  intensity?: number;
}

export interface BassBoostOptions extends AudioEffectOptions {
  effect: AudioEffect.BASS_BOOST;
  gain?: number;
  frequency?: number;
}

export interface NightcoreOptions extends AudioEffectOptions {
  effect: AudioEffect.NIGHTCORE;
  speed?: number;
  pitch?: number;
}

export interface ReverbOptions extends AudioEffectOptions {
  effect: AudioEffect.REVERB;
  delay?: number;
  decay?: number;
}

export interface EchoOptions extends AudioEffectOptions {
  effect: AudioEffect.ECHO;
  delay?: number;
  decay?: number;
}

export interface CompressorOptions extends AudioEffectOptions {
  effect: AudioEffect.COMPRESSOR;
  threshold?: number;
  ratio?: number;
  attack?: number;
  release?: number;
}
