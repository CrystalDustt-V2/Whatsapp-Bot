export enum VideoFormat {
  MP4 = 'mp4',
  WEBM = 'webm',
  MKV = 'mkv',
  AVI = 'avi',
  MOV = 'mov',
}

export enum AudioFormat {
  MP3 = 'mp3',
  WAV = 'wav',
  M4A = 'm4a',
}

export interface VideoInfo {
  duration: number;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  format: string;
  hasAudio: boolean;
}

export interface VideoConversionOptions {
  format: VideoFormat;
  quality?: number;
  width?: number;
  height?: number;
  fps?: number;
}

export interface VideoTrimOptions {
  startTime: number;
  duration: number;
}

export interface VideoSpeedOptions {
  speed: number;
}

export interface AudioExtractionOptions {
  format: AudioFormat;
  bitrate?: number;
}
