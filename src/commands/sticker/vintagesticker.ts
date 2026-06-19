import { Command, CommandCategory } from '../../types';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import type { proto } from '@whiskeysockets/baileys';
import { stickerEngine } from '../../services/sticker-engine';

export const VintageStickerCommand: Command = {
  name: 'vintagesticker',
  aliases: ['vintage', 'retro'],
  category: CommandCategory.STICKER,
  description: 'Convert image to vintage sticker',
  usage: 'vintagesticker',
  async execute(ctx) {
    const msg = ctx.message.message;
    if (!msg) return;

    let media: proto.Message.IImageMessage | proto.Message.IVideoMessage | null = null;

    if (msg.imageMessage) {
      media = msg.imageMessage;
    } else if (msg.extendedTextMessage?.contextInfo?.quotedMessage) {
      const quoted = msg.extendedTextMessage.contextInfo.quotedMessage;
      if (quoted.imageMessage) {
        media = quoted.imageMessage;
      }
    }

    if (!media) {
      await ctx.socket.sendMessage(
        ctx.message.key.remoteJid!,
        { text: 'Please send or reply to an image!' },
        { quoted: ctx.message }
      );
      return;
    }

    try {
      const stream = await downloadContentFromMessage(media as any, 'image');
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      const processedBuffer = await stickerEngine.createVintageSticker(buffer);

      await ctx.socket.sendMessage(
        ctx.message.key.remoteJid!,
        {
          sticker: processedBuffer,
          mimetype: 'image/webp',
        },
        { quoted: ctx.message }
      );
    } catch (err) {
      console.error(err);
      await ctx.socket.sendMessage(
        ctx.message.key.remoteJid!,
        { text: 'Failed to create vintage sticker!' },
        { quoted: ctx.message }
      );
    }
  },
};

export default VintageStickerCommand;
