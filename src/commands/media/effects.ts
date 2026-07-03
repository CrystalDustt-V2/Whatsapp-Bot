import sharp from 'sharp';
import { Command, CommandCategory } from '../../types';
import { downloadMediaFromContext } from './helpers';

type ImageEffect = {
  name: string;
  aliases: string[];
  description: string;
  usage: string;
  caption: string;
  process(buffer: Buffer, args: string[]): Promise<Buffer>;
};

function numberArg(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

async function pixelate(buffer: Buffer, args: string[]): Promise<Buffer> {
  const amount = Math.round(numberArg(args[0], 12, 2, 64));
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width || 512;
  const height = metadata.height || 512;
  const smallWidth = Math.max(1, Math.round(width / amount));
  const smallHeight = Math.max(1, Math.round(height / amount));

  return sharp(buffer)
    .resize(smallWidth, smallHeight, { kernel: 'nearest' })
    .resize(width, height, { kernel: 'nearest' })
    .png()
    .toBuffer();
}

async function enhance(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .normalize()
    .sharpen(1.2)
    .modulate({ brightness: 1.03, saturation: 1.08 })
    .png()
    .toBuffer();
}

async function denoise(buffer: Buffer, args: string[]): Promise<Buffer> {
  const size = Math.round(numberArg(args[0], 2, 1, 5));
  return sharp(buffer).median(size).png().toBuffer();
}

function createImageEffectCommand(effect: ImageEffect): Command {
  return {
    name: effect.name,
    aliases: effect.aliases,
    category: CommandCategory.MEDIA,
    description: effect.description,
    usage: effect.usage,
    async execute(ctx) {
      const media = await downloadMediaFromContext(ctx, ['image']);
      if (!media) {
        await ctx.reply(`Please send or reply to an image with .${effect.usage}`);
        return;
      }

      try {
        const image = await effect.process(media.buffer, ctx.args);
        await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
          image,
          mimetype: 'image/png',
          caption: effect.caption,
        });
      } catch {
        await ctx.reply(`Failed to run .${effect.name} on this image.`);
      }
    },
  };
}

export const PixelateCommand = createImageEffectCommand({
  name: 'pixelate',
  aliases: ['pixel'],
  description: 'Pixelate an image',
  usage: 'pixelate [2-64]',
  caption: 'Image pixelated.',
  process: pixelate,
});

export const EnhanceCommand = createImageEffectCommand({
  name: 'enhance',
  aliases: ['improve'],
  description: 'Auto-enhance an image',
  usage: 'enhance',
  caption: 'Image enhanced.',
  process: enhance,
});

export const DenoiseCommand = createImageEffectCommand({
  name: 'denoise',
  aliases: ['smooth'],
  description: 'Reduce image noise',
  usage: 'denoise [1-5]',
  caption: 'Image denoised.',
  process: denoise,
});
