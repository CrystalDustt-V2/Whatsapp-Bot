import sharp from 'sharp';
import { Command, CommandCategory } from '../../types';

const CANVAS_SIZE = 512;
const PADDING = 48;
const MAX_CONTENT_WIDTH = CANVAS_SIZE - PADDING * 2;
const MAX_CONTENT_HEIGHT = CANVAS_SIZE - PADDING * 2;

const THEMES = {
  green: { bg: '#8ACF00', text: '#000000', blur: 1.2 },
  white: { bg: '#FFFFFF', text: '#000000', blur: 1.2 },
  black: { bg: '#000000', text: '#FFFFFF', blur: 1.2 },
  blue: { bg: '#0000FF', text: '#DE0100', blur: 0 },
} as const;

type BratTheme = keyof typeof THEMES;

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getGraphemes(text: string): string[] {
  return [...segmenter.segment(text)].map((s) => s.segment);
}

function measureGraphemeWidth(char: string, fontSize: number): number {
  if (/\p{Extended_Pictographic}/u.test(char)) {
    return fontSize * 1.05;
  }
  if (/\s/.test(char)) {
    return fontSize * 0.28;
  }
  if (/^[iljIt!.,:;'|`1]$/.test(char)) {
    return fontSize * 0.28;
  }
  if (/^[WM]$/.test(char)) {
    return fontSize * 0.85;
  }
  if (/^[wm]$/.test(char)) {
    return fontSize * 0.72;
  }
  if (/^[A-Z]$/.test(char)) {
    return fontSize * 0.58;
  }
  if (/^[—–@%#&+=]$/.test(char)) {
    return fontSize * 0.7;
  }
  return fontSize * 0.46;
}

function measureLineWidth(text: string, fontSize: number): number {
  const graphemes = getGraphemes(text);
  return graphemes.reduce((acc, g) => acc + measureGraphemeWidth(g, fontSize), 0);
}

function wrapText(text: string, fontSize: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (!currentLine) {
      if (measureLineWidth(word, fontSize) > MAX_CONTENT_WIDTH) {
        const graphemes = getGraphemes(word);
        let partial = '';
        for (const g of graphemes) {
          if (measureLineWidth(partial + g, fontSize) > MAX_CONTENT_WIDTH && partial) {
            lines.push(partial);
            partial = g;
          } else {
            partial += g;
          }
        }
        if (partial) currentLine = partial;
      } else {
        currentLine = word;
      }
      continue;
    }

    const testLine = `${currentLine} ${word}`;
    if (measureLineWidth(testLine, fontSize) <= MAX_CONTENT_WIDTH) {
      currentLine = testLine;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

function createTextSvg(text: string, themeName: BratTheme): Buffer {
  const theme = THEMES[themeName] || THEMES.green;
  const rawText = text.trim();

  let low = 14;
  let high = 140;
  let optimalSize = 14;
  let optimalLines = [rawText];

  while (low <= high) {
    const testSize = Math.floor((low + high) / 2);
    const lines = wrapText(rawText, testSize);
    const lineHeight = testSize * 1.06;
    const totalHeight = lines.length * lineHeight;
    const maxLineWidth = Math.max(...lines.map((l) => measureLineWidth(l, testSize)), 0);

    if (totalHeight <= MAX_CONTENT_HEIGHT && maxLineWidth <= MAX_CONTENT_WIDTH && lines.length <= 8) {
      optimalSize = testSize;
      optimalLines = lines;
      low = testSize + 1;
    } else {
      high = testSize - 1;
    }
  }

  const lineHeight = optimalSize * 1.06;
  const totalTextHeight = optimalLines.length * lineHeight;
  const startY = (CANVAS_SIZE - totalTextHeight) / 2 + lineHeight * 0.78;

  const tspans = optimalLines
    .map((line, idx) => {
      const y = startY + idx * lineHeight;
      return `<tspan x="256" y="${y.toFixed(1)}">${escapeXml(line)}</tspan>`;
    })
    .join('\n');

  const filterDef =
    theme.blur > 0
      ? `<defs>
          <filter id="bratBlur" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="${theme.blur}"/>
          </filter>
        </defs>`
      : '';

  const filterAttr = theme.blur > 0 ? 'filter="url(#bratBlur)"' : '';

  const svg = `
    <svg width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" viewBox="0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${theme.bg}"/>
      <text x="256" y="${startY.toFixed(1)}" text-anchor="middle"
        font-family="'Arial Narrow', Arial, 'Helvetica Neue', Helvetica, 'Segoe UI Emoji', 'Noto Color Emoji', 'Apple Color Emoji', sans-serif"
        font-size="${optimalSize}" font-weight="500" fill="${theme.text}"
        letter-spacing="-0.02em"
        ${filterAttr}>
        ${tspans}
      </text>
      ${filterDef}
    </svg>
  `;

  return Buffer.from(svg);
}

function parseArgs(raw: string): { theme: BratTheme; text: string } {
  const normalized = raw.trim();
  const match = normalized.match(/^(green|white|black|blue)\s+([\s\S]+)$/i);
  if (match) {
    const theme = match[1].toLowerCase() as BratTheme;
    return {
      theme,
      text: match[2].trim(),
    };
  }
  return {
    theme: 'green',
    text: normalized,
  };
}

async function createSbratSticker(text: string, theme: BratTheme): Promise<Buffer> {
  const svgBuffer = createTextSvg(text, theme);
  return sharp(svgBuffer).webp({ quality: 95 }).toBuffer();
}

export const SbratStickerCommand: Command = {
  name: 'sbrat',
  aliases: ['brat', 'bratsticker'],
  category: CommandCategory.STICKER,
  description: 'Create an authentic brat album cover text sticker',
  usage: 'sbrat [green|white|black|blue] <text>',
  async execute(ctx) {
    const { theme, text } = parseArgs(ctx.rawArgs || ctx.args.join(' '));
    if (!text) {
      await ctx.reply('Usage: .sbrat [green|white|black|blue] <text>\nExample: .sbrat 365 party girl 💅\nExample: .sbrat white deluxe edition');
      return;
    }

    try {
      const sticker = await createSbratSticker(text, theme);
      await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
        sticker,
        mimetype: 'image/webp',
      });
    } catch {
      await ctx.reply('Failed to create brat sticker.');
    }
  },
};

export default SbratStickerCommand;
