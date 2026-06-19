export interface MediaMetadata {
  format: string;
  size?: number;
  duration?: number;
  width?: number;
  height?: number;
  bitrate?: number;
  fps?: number;
  audio?: {
    codec: string;
    sampleRate: number;
    channels: number;
    bitrate?: number;
  };
  video?: {
    codec: string;
    width: number;
    height: number;
    fps: number;
    bitrate?: number;
  };
  exif?: Record<string, any>;
  tags?: Record<string, string>;
}

export interface MetadataEditOptions {
  tags?: Record<string, string>;
  removeAllTags?: boolean;
  exif?: Record<string, any>;
}
