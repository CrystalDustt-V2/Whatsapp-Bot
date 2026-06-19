import mediaEngine from '../../services/media-engine';
import { Command, CommandCategory } from '../../types';
import { downloadMediaFromContext } from './helpers';

function parseDimension(value: string | undefined): { width: number; height?: number } | null {
  if (!value) return null;

  const match = value.toLowerCase().match(/^(\d{1,4})(?:x(\d{1,4}))?$/);
  if (!match) return null;

  const width = Number(match[1]);
  const height = match[2] ? Number(match[2]) : undefined;

  if (width < 1 || width > 4096 || (height !== undefined && (height < 1 || height > 4096))) {
    return null;
  }

  return { width, height };
}

function parseQuality(value: string | undefined): number {
  const quality = Number(value || 80);
  if (!Number.isFinite(quality)) return 80;
  return Math.min(100, Math.max(10, Math.round(quality)));
}

export const ResizeCommand: Command = {
  name: 'resize',
  aliases: ['scale'],
  category: CommandCategory.MEDIA,
  description: 'Resize an image',
  usage: 'resize <width|widthxheight>',
  async execute(ctx) {
    const dimensions = parseDimension(ctx.args[0]);
    if (!dimensions) {
      await ctx.reply('Usage: .resize <width|widthxheight>\nExample: .resize 512x512');
      return;
    }

    const media = await downloadMediaFromContext(ctx, ['image']);
    if (!media) {
      await ctx.reply('Please send or reply to an image with .resize <width|widthxheight>');
      return;
    }

    try {
      const resized = await mediaEngine.resizeImage(media.buffer, dimensions.width, dimensions.height);
      await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
        image: resized,
        caption: 'Image resized.',
      });
    } catch (err) {
      await ctx.reply('Failed to resize this image.');
    }
  },
};

export const RotateCommand: Command = {
  name: 'rotate',
  aliases: ['rot'],
  category: CommandCategory.MEDIA,
  description: 'Rotate an image',
  usage: 'rotate <degrees>',
  async execute(ctx) {
    const degrees = Number(ctx.args[0] || 90);
    if (!Number.isFinite(degrees) || Math.abs(degrees) > 3600) {
      await ctx.reply('Usage: .rotate <degrees>');
      return;
    }

    const media = await downloadMediaFromContext(ctx, ['image']);
    if (!media) {
      await ctx.reply('Please send or reply to an image with .rotate <degrees>');
      return;
    }

    try {
      const rotated = await mediaEngine.rotateImage(media.buffer, degrees);
      await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
        image: rotated,
        caption: 'Image rotated.',
      });
    } catch (err) {
      await ctx.reply('Failed to rotate this image.');
    }
  },
};

export const FlipCommand: Command = {
  name: 'flip',
  aliases: ['mirror'],
  category: CommandCategory.MEDIA,
  description: 'Flip an image horizontally or vertically',
  usage: 'flip <h|v>',
  async execute(ctx) {
    const direction = (ctx.args[0] || 'h').toLowerCase();
    if (!['h', 'horizontal', 'v', 'vertical'].includes(direction)) {
      await ctx.reply('Usage: .flip <h|v>');
      return;
    }

    const media = await downloadMediaFromContext(ctx, ['image']);
    if (!media) {
      await ctx.reply('Please send or reply to an image with .flip <h|v>');
      return;
    }

    try {
      const flipped = direction.startsWith('v')
        ? await mediaEngine.flipImageVertical(media.buffer)
        : await mediaEngine.flipImageHorizontal(media.buffer);

      await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
        image: flipped,
        caption: 'Image flipped.',
      });
    } catch (err) {
      await ctx.reply('Failed to flip this image.');
    }
  },
};

export const CompressImageCommand: Command = {
  name: 'compressimage',
  aliases: ['compressimg', 'imgcompress'],
  category: CommandCategory.MEDIA,
  description: 'Compress an image',
  usage: 'compressimage [quality]',
  async execute(ctx) {
    const media = await downloadMediaFromContext(ctx, ['image']);
    if (!media) {
      await ctx.reply('Please send or reply to an image with .compressimage [quality]');
      return;
    }

    try {
      const quality = parseQuality(ctx.args[0]);
      const compressed = await mediaEngine.compressImage(media.buffer, { quality });
      await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
        image: compressed,
        caption: `Image compressed at ${quality}% quality.`,
      });
    } catch (err) {
      await ctx.reply('Failed to compress this image.');
    }
  },
};
