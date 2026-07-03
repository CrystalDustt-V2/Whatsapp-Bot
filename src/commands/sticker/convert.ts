import sharp from 'sharp';
import { Command, CommandCategory } from '../../types';
import { downloadMediaFromContext } from '../media/helpers';

export const StickerImageCommand: Command = {
  name: 'stickerimage',
  aliases: ['stickertoimg', 'stickerpng', 'stimg'],
  category: CommandCategory.STICKER,
  description: 'Convert a sticker to a PNG image',
  usage: 'stickerimage',
  async execute(ctx) {
    const media = await downloadMediaFromContext(ctx, ['sticker', 'image', 'document']);
    if (!media) {
      await ctx.reply('Please reply to a sticker with .stickerimage');
      return;
    }

    try {
      const image = await sharp(media.buffer).png().toBuffer();
      await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
        image,
        mimetype: 'image/png',
        caption: 'Sticker converted to image.',
      });
    } catch (err) {
      await ctx.reply('Failed to convert this sticker to an image.');
    }
  },
};
