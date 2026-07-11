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
const MAX_FONT_SIZE = 75;
const MIN_FONT_SIZE = 18;
const MAX_TEXT_WIDTH = CANVAS_SIZE - 24;

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
  return Array.from(text).reduce((width, char) => width + fontSize * (/[\s]/.test(char) ? 0.26 : /[il.,'`]/i.test(char) ? 0.24 : 0.48), 0);
}

function fontSizeFor(text: string): number {
  for (let size = MAX_FONT_SIZE; size >= MIN_FONT_SIZE; size -= 1) {
    if (textWidth(text, size) <= MAX_TEXT_WIDTH) return size;
  }
  return MIN_FONT_SIZE;
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

async function createSbratSticker(text: string, background: BratBackground): Promise<Buffer> {
  const fontSize = fontSizeFor(text);
  const svg = Buffer.from(`
    <svg width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" viewBox="0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${BACKGROUNDS[background]}"/>
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
        font-family="Arial Narrow, Arial, Helvetica, sans-serif"
        font-size="${fontSize}" font-weight="500" fill="#000000"
        filter="url(#softBlur)">${escapeXml(text)}</text>
      <defs>
        <filter id="softBlur"><feGaussianBlur stdDeviation="2"/></filter>
      </defs>
    </svg>
  `);

  return sharp(svg).webp({ quality: 90 }).toBuffer();
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
