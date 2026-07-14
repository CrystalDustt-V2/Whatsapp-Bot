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
      emojis: [''],
    };

    const exifBuffer = Buffer.from(JSON.stringify(exif));
    const exifHeader = Buffer.from([
      0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
      0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
    ]);

    exifHeader.writeUIntLE(exifBuffer.length, 14, 4);
    return Buffer.concat([exifHeader, exifBuffer]);
  }

  addMetadata(webp: Buffer, packName: string, author: string): Buffer {
    if (webp.toString('ascii', 0, 4) !== 'RIFF' || webp.toString('ascii', 8, 12) !== 'WEBP') {
      return webp;
    }

    const exif = this.createExif(packName, author);
    const chunks: Buffer[] = [];
    let offset = 12;

    while (offset + 8 <= webp.length) {
      const type = webp.toString('ascii', offset, offset + 4);
      const size = webp.readUInt32LE(offset + 4);
      const end = offset + 8 + size + (size % 2);
      if (end > webp.length) break;
      if (type !== 'EXIF') chunks.push(webp.subarray(offset, end));
      offset = end;
    }

    const exifHeader = Buffer.alloc(8);
    exifHeader.write('EXIF', 0, 4, 'ascii');
    exifHeader.writeUInt32LE(exif.length, 4);
    const body = Buffer.concat([...chunks, exifHeader, exif, ...(exif.length % 2 ? [Buffer.from([0])] : [])]);
    const output = Buffer.concat([webp.subarray(0, 12), body]);
    output.writeUInt32LE(output.length - 8, 4);
    return output;
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
