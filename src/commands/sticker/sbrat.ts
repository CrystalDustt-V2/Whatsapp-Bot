import sharp from 'sharp';
import { Command, CommandCategory } from '../../types';

const CANVAS_SIZE = 512;
const BRAT_GREEN = '#8ACF00';
const BACKGROUNDS = {
  green: BRAT_GREEN,
  white: '#ffffff',
} as const;
const GREEN_INPUT_LENGTH = 20;
const WHITE_INPUT_LENGTH = 160;
const MAX_FONT_SIZE = 170;
const MIN_FONT_SIZE = 8;
const TEXT_PADDING = 20;
const MAX_TEXT_WIDTH = CANVAS_SIZE - TEXT_PADDING * 2;
const TEXT_ALPHA_THRESHOLD = 8;

type BratBackground = keyof typeof BACKGROUNDS;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeText(value: string, background: BratBackground): string {
  const maxLength = background === 'green' ? GREEN_INPUT_LENGTH : WHITE_INPUT_LENGTH;
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function textWidth(text: string, fontSize: number): number {
  return Array.from(text).reduce((width, char) => width + fontSize * (/[\s]/.test(char) ? 0.28 : /[il.,'`]/i.test(char) ? 0.3 : 0.55), 0);
}

function parseArgs(raw: string): { background: BratBackground; text: string } {
  const normalized = raw.trim();
  const match = normalized.match(/^(green|white)\s+([\s\S]+)$/i);
  const background = (match?.[1]?.toLowerCase() as BratBackground | undefined) || 'green';
  return {
    background,
    text: normalizeText(match?.[2] || normalized, background),
  };
}

function createTextSvg(text: string, fontSize: number, background?: BratBackground): Buffer {
  return Buffer.from(`
    <svg width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" viewBox="0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}" xmlns="http://www.w3.org/2000/svg">
      ${background ? `<rect width="100%" height="100%" fill="${BACKGROUNDS[background]}"/>` : ''}
      <text x="${TEXT_PADDING}" y="50%" text-anchor="start" dominant-baseline="central"
        font-family="Arial Narrow, Arial, Helvetica, sans-serif"
        font-size="${fontSize}" font-weight="500" fill="#000000"
        filter="url(#softBlur)">${escapeXml(text)}</text>
      <defs>
        <filter id="softBlur" x="-20%" y="-80%" width="140%" height="260%"><feGaussianBlur stdDeviation="2"/></filter>
      </defs>
    </svg>
  `);
}

async function textFits(text: string, fontSize: number): Promise<boolean> {
  if (textWidth(text, fontSize) > MAX_TEXT_WIDTH * 1.8) return false;

  const { data, info } = await sharp(createTextSvg(text, fontSize))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let maxX = -1;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * info.channels + 3] > TEXT_ALPHA_THRESHOLD && x > maxX) {
        maxX = x;
      }
    }
  }

  return maxX >= 0 && maxX <= CANVAS_SIZE - TEXT_PADDING;
}

async function fontSizeFor(text: string): Promise<number> {
  let low = MIN_FONT_SIZE;
  let high = MAX_FONT_SIZE;
  let best = MIN_FONT_SIZE;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (await textFits(text, mid)) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
}

async function createSbratSticker(text: string, background: BratBackground): Promise<Buffer> {
  const fontSize = await fontSizeFor(text);
  return sharp(createTextSvg(text, fontSize, background)).webp({ quality: 90 }).toBuffer();
}

export const SbratStickerCommand: Command = {
  name: 'sbrat',
  aliases: ['brat'],
  category: CommandCategory.STICKER,
  description: 'Create a brat-style text sticker',
  usage: 'sbrat [green|white] <text>',
  async execute(ctx) {
    const { background, text } = parseArgs(ctx.rawArgs || ctx.args.join(' '));
    if (!text) {
      await ctx.reply('Usage: .sbrat [green|white] <text>');
      return;
    }

    const sticker = await createSbratSticker(text, background);
    await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
      sticker,
      mimetype: 'image/webp',
    });
  },
};
