export interface StickerOptions {
  packName?: string;
  author?: string;
  width?: number;
  height?: number;
  quality?: number;
}

export interface TextOptions {
  text: string;
  x?: number;
  y?: number;
  fontSize?: number;
  font?: string;
  color?: string;
  outlineColor?: string;
  outlineWidth?: number;
  shadow?: boolean;
}

export enum FilterType {
  BLACK_WHITE = 'blackWhite',
  SEPIA = 'sepia',
  VINTAGE = 'vintage',
  CARTOON = 'cartoon',
  PIXELATE = 'pixelate',
  BLUR = 'blur',
  SHARPEN = 'sharpen',
  GLITCH = 'glitch',
}

export interface FilterOptions {
  type: FilterType;
  intensity?: number;
}

export enum ShapeType {
  CIRCLE = 'circle',
  ROUNDED = 'rounded',
  HEART = 'heart',
  STAR = 'star',
}

export interface ShapeOptions {
  type: ShapeType;
  radius?: number;
}

export interface StickerEngineConfig {
  tempDir: string;
  maxFileSize: number;
}
