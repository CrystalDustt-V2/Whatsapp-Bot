import sharp from 'sharp';
import { Command, CommandCategory } from '../../types';
import { downloadMediaFromContext } from '../media/helpers';

const SIZE = 512;
const COLORS: Record<string, string> = {
  white: '#ffffff',
  black: '#111111',
  red: '#ef4444',
  blue: '#3b82f6',
  green: '#22c55e',
  yellow: '#facc15',
  pink: '#ec4899',
  purple: '#a855f7',
};

function maskSvg(shape: 'circle' | 'rounded'): Buffer {
  const shapeMarkup =
    shape === 'circle'
      ? `<circle cx="256" cy="256" r="256" fill="white"/>`
      : `<rect width="512" height="512" rx="74" fill="white"/>`;

  return Buffer.from(`<svg width="512" height="512" viewBox="0 0 512 512">${shapeMarkup}</svg>`);
}

async function makeShapedSticker(buffer: Buffer, shape: 'circle' | 'rounded'): Promise<Buffer> {
  return sharp(buffer)
    .resize(SIZE, SIZE, { fit: 'cover' })
    .composite([{ input: maskSvg(shape), blend: 'dest-in' }])
    .webp({ quality: 90 })
    .toBuffer();
}

function colorFromArg(value: string | undefined): string | null {
  const color = value?.trim().toLowerCase();
  if (!color) return null;

  if (/^#?[0-9a-f]{6}$/i.test(color)) {
    return color.startsWith('#') ? color : `#${color}`;
  }

  if (/^#?[0-9a-f]{3}$/i.test(color)) {
    const hex = color.replace('#', '');
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
  }

  return COLORS[color] || null;
}

function borderWidthFromArg(value: string | undefined): number {
  const width = Number.parseInt(value || '', 10);
  return Number.isFinite(width) ? Math.min(80, Math.max(4, width)) : 18;
}

async function makeBorderSticker(buffer: Buffer, color: string, borderWidth: number): Promise<Buffer> {
  const innerSize = SIZE - borderWidth * 2;
  const image = await sharp(buffer)
    .resize(innerSize, innerSize, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  const halfBorder = borderWidth / 2;
  const frame = Buffer.from(`
    <svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
      <rect x="${halfBorder}" y="${halfBorder}" width="${SIZE - borderWidth}" height="${SIZE - borderWidth}" rx="72" fill="none" stroke="${color}" stroke-width="${borderWidth}"/>
    </svg>
  `);

  return sharp({
    create: {
      width: SIZE,
      height: SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: image, left: borderWidth, top: borderWidth },
      { input: frame, left: 0, top: 0 },
    ])
    .webp({ quality: 90 })
    .toBuffer();
}

function createShapeCommand(shape: 'circle' | 'rounded'): Command {
  return {
    name: `${shape}sticker`,
    aliases: shape === 'circle' ? ['cstick', 'circlecrop'] : ['roundsticker', 'rsticker'],
    category: CommandCategory.STICKER,
    description: `Create a ${shape} sticker from an image or sticker`,
    usage: `${shape}sticker`,
    async execute(ctx) {
      const media = await downloadMediaFromContext(ctx, ['image', 'sticker']);
      if (!media) {
        await ctx.reply(`Please send or reply to an image/sticker with .${shape}sticker`);
        return;
      }

      try {
        const sticker = await makeShapedSticker(media.buffer, shape);
        await ctx.socket.sendMessage(ctx.message.key.remoteJid!, { sticker, mimetype: 'image/webp' }, { quoted: ctx.message });
      } catch {
        await ctx.reply(`Failed to create ${shape} sticker.`);
      }
    },
  };
}

export const CircleStickerCommand = createShapeCommand('circle');
export const RoundedStickerCommand = createShapeCommand('rounded');

export const BorderStickerCommand: Command = {
  name: 'bordersticker',
  aliases: ['bsticker', 'stickerborder'],
  category: CommandCategory.STICKER,
  description: 'Add a colored border to an image or sticker',
  usage: 'bordersticker [color|#hex] [width]',
  async execute(ctx) {
    const media = await downloadMediaFromContext(ctx, ['image', 'sticker']);
    if (!media) {
      await ctx.reply('Please send or reply to an image/sticker with .bordersticker [color] [width]');
      return;
    }

    const color = colorFromArg(ctx.args[0]) || '#ffffff';
    const widthArg = colorFromArg(ctx.args[0]) ? ctx.args[1] : ctx.args[0];
    const borderWidth = borderWidthFromArg(widthArg);

    try {
      const sticker = await makeBorderSticker(media.buffer, color, borderWidth);
      await ctx.socket.sendMessage(ctx.message.key.remoteJid!, { sticker, mimetype: 'image/webp' }, { quoted: ctx.message });
    } catch {
      await ctx.reply('Failed to add sticker border.');
    }
  },
};
