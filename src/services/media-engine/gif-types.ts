export interface GifCreationOptions {
  fps?: number;
  width?: number;
  height?: number;
  loop?: number;
  quality?: number;
}

export interface ImageToGifOptions extends GifCreationOptions {
  delay?: number;
}
