import { Command, CommandCategory } from '../types';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import type { proto } from '@whiskeysockets/baileys';
import { stickerEngine } from '../services/sticker-engine';

const STICKER_WATERMARK = 'Created with CrystalDust V0 Bot';
const SHAPES = new Set(['circle', 'rounded']);

function parseStickerArgs(rawArgs = ''): { shape?: 'circle' | 'rounded'; metadata: string } {
  const trimmed = rawArgs.trim();
  const [first = ''] = trimmed.split(/\s+/, 1);
  const shape = SHAPES.has(first.toLowerCase()) ? first.toLowerCase() as 'circle' | 'rounded' : undefined;
  const metadata = (shape ? trimmed.slice(first.length) : trimmed).trim().replace(/\s+/g, ' ').slice(0, 64);
  return { shape, metadata };
}

export const StickerCommand: Command = {
  name: 'sticker',
  aliases: ['s', 'stiker'],
  category: CommandCategory.STICKER,
  description: 'Convert image/video to sticker',
  usage: 'sticker [circle|rounded] [metadata]',
  async execute(ctx) {
    const msg = ctx.message.message;
    if (!msg) return;

    let media: proto.Message.IImageMessage | proto.Message.IVideoMessage | null = null;

    if (msg.imageMessage) {
      media = msg.imageMessage;
    } else if (msg.videoMessage) {
      media = msg.videoMessage;
    } else if (msg.extendedTextMessage?.contextInfo?.quotedMessage) {
      const quoted = msg.extendedTextMessage.contextInfo.quotedMessage;
      if (quoted.imageMessage) {
        media = quoted.imageMessage;
      } else if (quoted.videoMessage) {
        media = quoted.videoMessage;
      }
    }

    if (!media) {
      await ctx.socket.sendMessage(
        ctx.message.key.remoteJid!,
        { text: 'Please send or reply to an image or video!' },
        { quoted: ctx.message }
      );
      return;
    }

    try {
      const stream = await downloadContentFromMessage(media as any, media.mimetype?.startsWith('image/') ? 'image' : 'video');
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      let processedBuffer: Buffer;
      const { shape, metadata } = parseStickerArgs(ctx.rawArgs);
      const options = { packName: metadata, author: STICKER_WATERMARK };

      if ('mimetype' in media && media.mimetype?.startsWith('image/')) {
        if (shape) {
          processedBuffer = await stickerEngine.createShapedSticker(buffer, shape, options);
        } else {
          processedBuffer = await stickerEngine.createSticker(buffer, { ...options, smartCrop: true });
        }
      } else {
        processedBuffer = buffer;
      }

      await ctx.socket.sendMessage(
        ctx.message.key.remoteJid!,
        {
          sticker: processedBuffer,
          mimetype: 'image/webp',
          isAnimated: 'mimetype' in media ? media.mimetype?.startsWith('video/') : false,
        },
        { quoted: ctx.message }
      );
    } catch (err) {
      console.error(err);
      await ctx.socket.sendMessage(
        ctx.message.key.remoteJid!,
        { text: 'Failed to create sticker!' },
        { quoted: ctx.message }
      );
    }
  },
};

export default StickerCommand;
