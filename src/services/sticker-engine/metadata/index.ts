export interface StickerMetadata {
  packName: string;
  author: string;
  publisher?: string;
  tags?: string[];
  categories?: string[];
}

export class StickerMetadataManager {
  createExif(packName: string, author: string): Buffer {
    const exif = {
      'sticker-pack-id': 'com.whatsapp.hybridbot',
      'sticker-pack-name': packName,
      'sticker-pack-publisher': author,
    };
    
    const exifBuffer = Buffer.from(JSON.stringify(exif));
    
    const exifHeader = Buffer.from([
      0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
      0x4D, 0x4D, 0x00, 0x2A, 0x00, 0x00, 0x00, 0x08,
      0x00, 0x01, 0x87, 0x69, 0x00, 0x04, 0x00, 0x00,
      0x00, 0x01, 0x00, 0x00, 0x00, 0x1A, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x1A
    ]);
    
    return Buffer.concat([exifHeader, exifBuffer]);
  }

  parseMetadata(data: any): StickerMetadata {
    return {
      packName: data['sticker-pack-name'] || 'WhatsApp Hybrid Bot',
      author: data['sticker-pack-publisher'] || 'Bot',
      publisher: data['sticker-pack-publisher'],
    };
  }
}

export default StickerMetadataManager;
