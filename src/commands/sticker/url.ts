import { normalizeHttpUrl } from '../../services/network-tools';
import stickerEngine from '../../services/sticker-engine';
import { Command, CommandCategory } from '../../types';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function isBlockedHost(url: string): boolean {
  const host = new URL(url).hostname.toLowerCase();
  return (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    /^169\.254\./.test(host)
  );
}

async function readLimitedResponse(response: Response): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.from(await response.arrayBuffer());

  const chunks: Buffer[] = [];
  let size = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    size += value.byteLength;
    if (size > MAX_IMAGE_BYTES) {
      throw new Error('Image is too large');
    }

    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks);
}

async function fetchImage(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { accept: 'image/*' },
    });
    const contentLength = Number(response.headers.get('content-length') || 0);
    const contentType = response.headers.get('content-type') || '';

    if (!response.ok || (contentType && !contentType.startsWith('image/'))) {
      throw new Error('URL did not return an image');
    }

    if (contentLength > MAX_IMAGE_BYTES) {
      throw new Error('Image is too large');
    }

    return readLimitedResponse(response);
  } finally {
    clearTimeout(timeout);
  }
}

export const UrlStickerCommand: Command = {
  name: 'urlsticker',
  aliases: ['stickurl', 'linksticker'],
  category: CommandCategory.STICKER,
  description: 'Create a sticker from a direct image URL',
  usage: 'urlsticker <image-url>',
  async execute(ctx) {
    const url = normalizeHttpUrl(ctx.args[0] || '');
    if (!url || isBlockedHost(url)) {
      await ctx.reply('Usage: .urlsticker <direct image url>');
      return;
    }

    try {
      const image = await fetchImage(url);
      const sticker = await stickerEngine.createSticker(image, { quality: 90 });

      await ctx.socket.sendMessage(
        ctx.message.key.remoteJid!,
        { sticker, mimetype: 'image/webp' },
        { quoted: ctx.message }
      );
    } catch {
      await ctx.reply('Could not create a sticker from that image URL.');
    }
  },
};
