import sharp from 'sharp';
import { Command, CommandCategory } from '../../types';
import { downloadMediaFromContext } from '../media/helpers';

export const StickerRevertCommand: Command = {
  name: 'srevert',
  aliases: ['stickerimage', 'stickertoimg', 'stickerpng', 'stimg', 'stickertogif', 'stgif'],
  category: CommandCategory.STICKER,
  description: 'Convert a sticker back to PNG or GIF',
  usage: 'srevert',
  async execute(ctx) {
    const media = await downloadMediaFromContext(ctx, ['sticker']);
    if (!media) {
      await ctx.reply('Please reply to a sticker with .srevert');
      return;
    }

    try {
      const metadata = await sharp(media.buffer, { animated: true }).metadata();
      if ((metadata.pages || 1) > 1) {
        const gif = await sharp(media.buffer, { animated: true }).gif().toBuffer();
        await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
          document: gif,
          mimetype: 'image/gif',
          fileName: 'sticker.gif',
        });
        return;
      }

      const image = await sharp(media.buffer).png().toBuffer();
      await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
        image,
        mimetype: 'image/png',
        caption: 'Sticker converted to image.',
      });
    } catch (err) {
      await ctx.reply('Failed to revert this sticker.');
    }
  },
};
