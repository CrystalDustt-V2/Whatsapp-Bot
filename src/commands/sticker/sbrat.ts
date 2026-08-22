import sharp from 'sharp';
import { Command, CommandCategory } from '../../types';

const CANVAS_SIZE = 512;
const PADDING = 44;
const MAX_CONTENT_WIDTH = CANVAS_SIZE - PADDING * 2;
const MAX_CONTENT_HEIGHT = CANVAS_SIZE - PADDING * 2;

const THEMES = {
  green: { bg: '#8ACF00', text: '#000000', blur: 1.6 },
  white: { bg: '#FFFFFF', text: '#000000', blur: 1.6 },
  black: { bg: '#000000', text: '#FFFFFF', blur: 1.6 },
  blue: { bg: '#0000FF', text: '#DE0100', blur: 0 },
} as const;

type BratTheme = keyof typeof THEMES;

type Token =
  | { type: 'text'; value: string }
  | { type: 'space'; value: string }
  | { type: 'emoji'; value: string };

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
const emojiBase64Cache = new Map<string, string>();

function isEmojiChar(char: string): boolean {
  return /\p{Extended_Pictographic}/u.test(char);
}

function emojiToCodePoints(emoji: string): string {
  return [...emoji].map((c) => c.codePointAt(0)!.toString(16).toLowerCase()).join('-');
}

async function getEmojiBase64(emoji: string): Promise<string | null> {
  const codePoints = emojiToCodePoints(emoji);
  if (emojiBase64Cache.has(codePoints)) {
    return emojiBase64Cache.get(codePoints) || null;
  }

  const url = `https://cdn.jsdelivr.net/gh/jdecked/twemoji@main/assets/72x72/${codePoints}.png`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      // Retry without 0xfe0f variation selector if needed
      const simplified = [...emoji]
        .map((c) => c.codePointAt(0)!.toString(16).toLowerCase())
        .filter((c) => c !== 'fe0f')
        .join('-');
      if (simplified !== codePoints) {
        const res2 = await fetch(`https://cdn.jsdelivr.net/gh/jdecked/twemoji@main/assets/72x72/${simplified}.png`);
        if (res2.ok) {
          const ab = await res2.arrayBuffer();
          const b64 = `data:image/png;base64,${Buffer.from(ab).toString('base64')}`;
          emojiBase64Cache.set(codePoints, b64);
          return b64;
        }
      }
      return null;
    }
    const arrayBuffer = await res.arrayBuffer();
    const b64 = `data:image/png;base64,${Buffer.from(arrayBuffer).toString('base64')}`;
    emojiBase64Cache.set(codePoints, b64);
    return b64;
  } catch {
    return null;
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function measureCharWidth(char: string, fontSize: number): number {
  if (isEmojiChar(char)) return fontSize * 1.05;
  if (/\s/.test(char)) return fontSize * 0.28;
  if (/^[iljIt!.,:;'|`1]$/.test(char)) return fontSize * 0.28;
  if (/^[WM]$/.test(char)) return fontSize * 0.85;
  if (/^[wm]$/.test(char)) return fontSize * 0.72;
  if (/^[A-Z]$/.test(char)) return fontSize * 0.58;
  if (/^[—–@%#&+=]$/.test(char)) return fontSize * 0.7;
  return fontSize * 0.46;
}

function tokenize(text: string): Token[] {
  const graphemes = [...segmenter.segment(text)].map((s) => s.segment);
  const tokens: Token[] = [];
  let currentWord = '';

  for (const g of graphemes) {
    if (isEmojiChar(g)) {
      if (currentWord) {
        tokens.push({ type: 'text', value: currentWord });
        currentWord = '';
      }
      tokens.push({ type: 'emoji', value: g });
    } else if (/\s/.test(g)) {
      if (currentWord) {
        tokens.push({ type: 'text', value: currentWord });
        currentWord = '';
      }
      tokens.push({ type: 'space', value: ' ' });
    } else {
      currentWord += g;
    }
  }

  if (currentWord) {
    tokens.push({ type: 'text', value: currentWord });
  }

  return tokens;
}

function tokenWidth(token: Token, fontSize: number): number {
  if (token.type === 'emoji') return fontSize * 1.05;
  if (token.type === 'space') return fontSize * 0.28;
  return [...segmenter.segment(token.value)].reduce((acc, s) => acc + measureCharWidth(s.segment, fontSize), 0);
}

function wrapTokens(tokens: Token[], fontSize: number): Token[][] {
  const lines: Token[][] = [];
  let currentLine: Token[] = [];
  let currentWidth = 0;

  for (const token of tokens) {
    const w = tokenWidth(token, fontSize);
    if (token.type === 'space' && currentLine.length === 0) continue;

    if (currentWidth + w <= MAX_CONTENT_WIDTH || currentLine.length === 0) {
      currentLine.push(token);
      currentWidth += w;
    } else {
      while (currentLine.length && currentLine[currentLine.length - 1].type === 'space') {
        currentLine.pop();
      }
      if (currentLine.length) lines.push(currentLine);
      if (token.type === 'space') {
        currentLine = [];
        currentWidth = 0;
      } else {
        currentLine = [token];
        currentWidth = w;
      }
    }
  }

  while (currentLine.length && currentLine[currentLine.length - 1].type === 'space') {
    currentLine.pop();
  }
  if (currentLine.length) lines.push(currentLine);

  return lines;
}

async function createTextSvg(text: string, themeName: BratTheme): Promise<{ svg: Buffer; blur: number }> {
  const theme = THEMES[themeName] || THEMES.green;
  const rawText = text.trim();
  const tokens = tokenize(rawText);

  // Pre-fetch all emojis concurrently
  await Promise.all(
    tokens.filter((t): t is { type: 'emoji'; value: string } => t.type === 'emoji').map((t) => getEmojiBase64(t.value))
  );

  let low = 16;
  let high = 140;
  let optimalSize = 16;
  let optimalLines: Token[][] = [tokens];

  while (low <= high) {
    const testSize = Math.floor((low + high) / 2);
    const lines = wrapTokens(tokens, testSize);
    const lineHeight = testSize * 1.08;
    const totalHeight = lines.length * lineHeight;
    const maxLineWidth = Math.max(
      ...lines.map((line) => line.reduce((acc, tok) => acc + tokenWidth(tok, testSize), 0)),
      0
    );

    if (totalHeight <= MAX_CONTENT_HEIGHT && maxLineWidth <= MAX_CONTENT_WIDTH && lines.length <= 8) {
      optimalSize = testSize;
      optimalLines = lines;
      low = testSize + 1;
    } else {
      high = testSize - 1;
    }
  }

  const lineHeight = optimalSize * 1.08;
  const totalTextHeight = optimalLines.length * lineHeight;
  const startY = (CANVAS_SIZE - totalTextHeight) / 2;

  const svgElements: string[] = [];

  optimalLines.forEach((line, lineIdx) => {
    const lineWidth = line.reduce((acc, tok) => acc + tokenWidth(tok, optimalSize), 0);
    let currentX = (CANVAS_SIZE - lineWidth) / 2;
    const lineY = startY + lineIdx * lineHeight;

    for (const token of line) {
      const w = tokenWidth(token, optimalSize);
      if (token.type === 'emoji') {
        const b64 = emojiBase64Cache.get(emojiToCodePoints(token.value));
        const emojiSize = optimalSize * 0.95;
        const emojiY = lineY + (lineHeight - emojiSize) / 2;
        if (b64) {
          svgElements.push(
            `<image href="${b64}" x="${currentX.toFixed(1)}" y="${emojiY.toFixed(1)}" width="${emojiSize.toFixed(1)}" height="${emojiSize.toFixed(1)}" />`
          );
        } else {
          svgElements.push(
            `<text x="${(currentX + w / 2).toFixed(1)}" y="${(lineY + lineHeight * 0.8).toFixed(1)}" text-anchor="middle" font-family="'Segoe UI Emoji', 'Noto Color Emoji', sans-serif" font-size="${optimalSize}" fill="${theme.text}">${escapeXml(token.value)}</text>`
          );
        }
      } else if (token.type === 'text') {
        const textY = lineY + lineHeight * 0.8;
        svgElements.push(
          `<text x="${currentX.toFixed(1)}" y="${textY.toFixed(1)}" text-anchor="start" font-family="'Arial Narrow', Arial, 'Helvetica Neue', Helvetica, sans-serif" font-size="${optimalSize}" font-weight="500" fill="${theme.text}" letter-spacing="-0.02em">${escapeXml(token.value)}</text>`
        );
      }
      currentX += w;
    }
  });

  const svg = `
    <svg width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" viewBox="0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${theme.bg}"/>
      ${svgElements.join('\n')}
    </svg>
  `;

  return { svg: Buffer.from(svg), blur: theme.blur };
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
  const { svg, blur } = await createTextSvg(text, theme);
  let sharpInstance = sharp(svg);
  if (blur > 0) {
    sharpInstance = sharpInstance.blur(blur);
  }
  return sharpInstance.webp({ quality: 92 }).toBuffer();
}

export const SbratStickerCommand: Command = {
  name: 'sbrat',
  aliases: ['brat', 'bratsticker'],
  category: CommandCategory.STICKER,
  description: 'Create an authentic brat album cover text sticker with native emojis and blur',
  usage: 'sbrat [green|white|black|blue] <text>',
  async execute(ctx) {
    const { theme, text } = parseArgs(ctx.rawArgs || ctx.args.join(' '));
    if (!text) {
      await ctx.reply('Usage: .sbrat [green|white|black|blue] <text>\nExample: .sbrat 365 party girl 🔥 💅\nExample: .sbrat white deluxe edition');
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
