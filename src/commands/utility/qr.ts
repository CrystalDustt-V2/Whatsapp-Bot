import { Command, CommandCategory } from '../../types';
import textUtils from '../../services/text-utils';
import sharp from 'sharp';
import jsQR from 'jsqr';
import { downloadMediaFromContext, MediaSizeError } from '../media/helpers';

export async function decodeQRCode(buffer: Buffer): Promise<string | null> {
  const { data, info } = await sharp(buffer, { limitInputPixels: 16_777_216 })
    .rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
    .toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return jsQR(new Uint8ClampedArray(data), info.width, info.height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
}

export const QRReaderCommand: Command = {
  name: 'qrread',
  aliases: ['readqr', 'scanqr', 'qrreader'],
  category: CommandCategory.UTILITY,
  description: 'Read QR code text from an image or sticker',
  usage: 'qrread (reply to an image or sticker)',
  inputs: 'Attached or quoted image, sticker, or image document',
  limits: '20 MB input; 16 megapixels; reads one QR code locally',
  cooldown: 5,
  async execute(ctx) {
    try {
      const media = await downloadMediaFromContext(ctx, ['image', 'sticker', 'document'], 20 * 1024 * 1024);
      if (!media || (media.kind === 'document' && !media.mimetype.startsWith('image/'))) {
        await ctx.reply('Send an image with .qrread in its caption, or reply to an image/sticker with .qrread.');
        return;
      }
      const text = await decodeQRCode(media.buffer);
      if (text === null) {
        await ctx.reply('No readable QR code found. Try a clearer image.'); return;
      }
      await ctx.socket.sendMessage(ctx.message.key.remoteJid!, { text: `QR code text:\n${text}`, linkPreview: null },
        ctx.message.key.fromMe ? undefined : { quoted: ctx.message });
    } catch (err) {
      await ctx.reply(err instanceof MediaSizeError ? err.message : 'Could not read that image. Use a clear image under 20 MB and 16 megapixels.');
    }
  },
};

export const QRCommand: Command = {
  name: 'qr',
  aliases: ['qrcode'],
  category: CommandCategory.UTILITY,
  description: 'Generate QR code from text',
  usage: 'qr <text>',
  async execute(ctx) {
    if (!ctx.args.length) {
      await ctx.socket.sendMessage(ctx.message.key.remoteJid!, { text: 'Usage: .qr <text>' });
      return;
    }

    const text = ctx.args.join(' ');
    const qrBuffer = await textUtils.generateQRCode(text);

    await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
      image: qrBuffer,
      caption: 'Here is your QR code!',
    });
  },
};

export default QRCommand;
