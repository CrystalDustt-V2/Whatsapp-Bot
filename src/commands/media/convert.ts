import mediaEngine from '../../services/media-engine';
import { ImageFormat } from '../../services/media-engine/types';
import { Command, CommandCategory } from '../../types';
import { downloadMediaFromContext } from './helpers';

type ImageConversion = {
  name: string;
  aliases: string[];
  format: ImageFormat.JPG | ImageFormat.PNG | ImageFormat.WEBP;
  mimetype: string;
};

function parseQuality(value: string | undefined): number {
  const parsed = Number(value || 90);
  if (!Number.isFinite(parsed)) return 90;
  return Math.min(100, Math.max(10, Math.round(parsed)));
}

function createImageConversionCommand(definition: ImageConversion): Command {
  return {
    name: definition.name,
    aliases: definition.aliases,
    category: CommandCategory.MEDIA,
    description: `Convert an image to ${definition.format.toUpperCase()}`,
    usage: `${definition.name} [quality]`,
    async execute(ctx) {
      const media = await downloadMediaFromContext(ctx, ['image', 'document']);
      if (!media) {
        await ctx.reply(`Please send or reply to an image with .${definition.name} [quality]`);
        return;
      }

      try {
        const quality = parseQuality(ctx.args[0]);
        const output = await mediaEngine.convertImage(media.buffer, {
          format: definition.format,
          quality,
        });

        await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
          document: output,
          mimetype: definition.mimetype,
          fileName: `converted.${definition.format}`,
        });
      } catch (err) {
        await ctx.reply('Failed to convert this image.');
      }
    },
  };
}

export const ToJpgCommand = createImageConversionCommand({
  name: 'tojpg',
  aliases: ['jpg', 'jpeg'],
  format: ImageFormat.JPG,
  mimetype: 'image/jpeg',
});

export const ToPngCommand = createImageConversionCommand({
  name: 'topng',
  aliases: ['png'],
  format: ImageFormat.PNG,
  mimetype: 'image/png',
});

export const ToWebpCommand = createImageConversionCommand({
  name: 'towebp',
  aliases: ['webp'],
  format: ImageFormat.WEBP,
  mimetype: 'image/webp',
});
