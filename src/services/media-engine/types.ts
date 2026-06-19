export enum MediaType {
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  GIF = 'gif',
  PDF = 'pdf',
  ZIP = 'zip',
}

export enum ImageFormat {
  JPG = 'jpg',
  JPEG = 'jpeg',
  PNG = 'png',
  WEBP = 'webp',
  GIF = 'gif',
}

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
  OGG = 'ogg',
  M4A = 'm4a',
}

export interface MediaInfo {
  type: MediaType;
  format: string;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
  bitrate?: number;
}

export interface CompressionOptions {
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
  maxSizeKB?: number;
}

export interface ConversionOptions {
  format: string;
  quality?: number;
  width?: number;
  height?: number;
}
