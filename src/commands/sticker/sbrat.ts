import sharp from 'sharp';
import { Command, CommandCategory } from '../../types';

const CANVAS_SIZE = 128;
const PADDING_X = 8;
const START_Y = 20;
const MAX_TEXT_WIDTH = 112;
const MAX_TEXT_HEIGHT = 94;
const MAX_INPUT_LENGTH = 180;
const MAX_LINES = 6;
const EMOJI_ASSET_BASE_URL = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@17.0.3/assets/svg';
const EMOJI_FETCH_TIMEOUT_MS = 2500;

type SegmenterLike = new (
  locales?: string | string[],
  options?: { granularity: 'grapheme' }
) => {
  segment(input: string): Iterable<{ segment: string }>;
};

type LayoutToken = {
  value: string;
  isEmoji: boolean;
  width: number;
};

type PositionedToken = LayoutToken & {
  x: number;
  y: number;
};

type TextRun = {
  text: string;
  x: number;
  y: number;
};

type StickerLayout = {
  fontSize: number;
  lineHeight: number;
  lines: LayoutToken[][];
};

const emojiSvgCache = new Map<string, Promise<Buffer | null>>();

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getGraphemes(value: string): string[] {
  const Segmenter = (Intl as typeof Intl & { Segmenter?: SegmenterLike }).Segmenter;
  if (!Segmenter) {
    return Array.from(value);
  }

  return Array.from(new Segmenter('en', { granularity: 'grapheme' }).segment(value), (part) => part.segment);
}

function normalizeInput(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
    .slice(0, MAX_INPUT_LENGTH)
    .split('\n')
    .map((line) => line.trim());
}

function isEmojiCluster(value: string): boolean {
  return (
    /\p{Extended_Pictographic}/u.test(value) ||
    /[\u{1f1e6}-\u{1f1ff}]/u.test(value) ||
    /[0-9#*]\ufe0f?\u20e3/u.test(value) ||
    /[\u00a9\u00ae\u203c\u2049\u2122\u2139\u3030\u303d\u3297\u3299]\ufe0f?/u.test(value)
  );
}

function getTokenWidth(value: string, isEmoji: boolean, fontSize: number): number {
  if (isEmoji) {
    return fontSize * 1.12;
  }

  if (/^\s+$/.test(value)) {
    return fontSize * 0.35;
  }

  return fontSize * 0.58;
}

function trimTrailingSpaces(tokens: LayoutToken[]): LayoutToken[] {
  let end = tokens.length;
  while (end > 0 && /^\s+$/.test(tokens[end - 1].value)) {
    end -= 1;
  }

  return tokens.slice(0, end);
}

function layoutAtFontSize(text: string, fontSize: number): { lines: LayoutToken[][]; truncated: boolean } {
  const lines: LayoutToken[][] = [];
  let truncated = false;

  for (const rawLine of normalizeInput(text)) {
    let currentLine: LayoutToken[] = [];
    let currentWidth = 0;

    for (const grapheme of getGraphemes(rawLine)) {
      const isEmoji = isEmojiCluster(grapheme);
      const token = {
        value: grapheme,
        isEmoji,
        width: getTokenWidth(grapheme, isEmoji, fontSize),
      };

      if (!currentLine.length && /^\s+$/.test(token.value)) {
        continue;
      }

      if (currentLine.length && currentWidth + token.width > MAX_TEXT_WIDTH) {
        lines.push(trimTrailingSpaces(currentLine));
        if (lines.length >= MAX_LINES) {
          truncated = true;
          return { lines, truncated };
        }

        currentLine = /^\s+$/.test(token.value) ? [] : [token];
        currentWidth = currentLine.length ? token.width : 0;
        continue;
      }

      currentLine.push(token);
      currentWidth += token.width;
    }

    lines.push(trimTrailingSpaces(currentLine));
    if (lines.length >= MAX_LINES) {
      truncated = true;
      return { lines, truncated };
    }
  }

  return { lines, truncated };
}

function getLayout(text: string): StickerLayout {
  for (let fontSize = 20; fontSize >= 5; fontSize -= 1) {
    const { lines, truncated } = layoutAtFontSize(text, fontSize);
    const lineHeight = fontSize * 1.18;
    if (!truncated && lines.length * lineHeight <= MAX_TEXT_HEIGHT) {
      return { fontSize, lineHeight, lines };
    }
  }

  const fontSize = 5;
  return {
    fontSize,
    lineHeight: fontSize * 1.18,
    lines: layoutAtFontSize(text, fontSize).lines,
  };
}

function getPositionedTokens(layout: StickerLayout): PositionedToken[] {
  const positioned: PositionedToken[] = [];

  layout.lines.forEach((line, lineIndex) => {
    let x = PADDING_X;
    const y = START_Y + lineIndex * layout.lineHeight;

    line.forEach((token) => {
      positioned.push({ ...token, x, y });
      x += token.width;
    });
  });

  return positioned;
}

function getEmojiCodepointCandidates(emoji: string): string[] {
  const codepoints = Array.from(emoji, (char) => char.codePointAt(0)?.toString(16)).filter(
    (codepoint): codepoint is string => Boolean(codepoint)
  );
  const withoutVariationSelectors = codepoints.filter((codepoint) => codepoint !== 'fe0f' && codepoint !== 'fe0e');

  return Array.from(new Set([codepoints.join('-'), withoutVariationSelectors.join('-')].filter(Boolean)));
}

async function fetchEmojiSvg(emoji: string): Promise<Buffer | null> {
  const cached = emojiSvgCache.get(emoji);
  if (cached) {
    return cached;
  }

  const promise = (async () => {
    for (const codepoints of getEmojiCodepointCandidates(emoji)) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), EMOJI_FETCH_TIMEOUT_MS);

      try {
        const response = await fetch(`${EMOJI_ASSET_BASE_URL}/${codepoints}.svg`, {
          signal: controller.signal,
        });

        if (response.ok) {
          return Buffer.from(await response.arrayBuffer());
        }
      } catch {
        // Fall back to system font rendering if the emoji asset cannot be fetched.
      } finally {
        clearTimeout(timeout);
      }
    }

    return null;
  })();

  emojiSvgCache.set(emoji, promise);
  return promise;
}

async function renderEmoji(emoji: string, size: number): Promise<Buffer | null> {
  const svg = await fetchEmojiSvg(emoji);
  if (!svg) {
    return null;
  }

  return sharp(svg).resize(size, size, { fit: 'contain' }).png().toBuffer();
}

function buildTextSvg(runs: TextRun[], fontSize: number): Buffer {
  const text = runs
    .map(
      (run) => `<text x="${run.x.toFixed(2)}" y="${run.y.toFixed(2)}">${escapeXml(run.text)}</text>`
    )
    .join('');

  return Buffer.from(`
    <svg width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" viewBox="0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}" xmlns="http://www.w3.org/2000/svg">
      <g xml:space="preserve" text-anchor="start" dominant-baseline="hanging"
        font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="400" fill="#111">
        ${text}
      </g>
    </svg>
  `);
}

async function createSbratSticker(text: string): Promise<Buffer> {
  const layout = getLayout(text);
  const tokens = getPositionedTokens(layout);
  const emojiSize = Math.ceil(layout.fontSize * 1.14);
  const uniqueEmoji = Array.from(new Set(tokens.filter((token) => token.isEmoji).map((token) => token.value)));
  const renderedEmoji = new Map<string, Buffer | null>();

  await Promise.all(
    uniqueEmoji.map(async (emoji) => {
      renderedEmoji.set(emoji, await renderEmoji(emoji, emojiSize));
    })
  );

  const textRuns: TextRun[] = [];
  const emojiOverlays: sharp.OverlayOptions[] = [];
  let currentRun: TextRun | null = null;

  for (const token of tokens) {
    const emojiImage = token.isEmoji ? renderedEmoji.get(token.value) : null;

    if (emojiImage) {
      currentRun = null;
      emojiOverlays.push({
        input: emojiImage,
        left: Math.round(token.x),
        top: Math.round(token.y - layout.fontSize * 0.06),
      });
      continue;
    }

    if (!currentRun || Math.abs(currentRun.y - token.y) > 0.01) {
      currentRun = { text: '', x: token.x, y: token.y };
      textRuns.push(currentRun);
    }

    currentRun.text += token.value;
  }

  return sharp({
    create: {
      width: CANVAS_SIZE,
      height: CANVAS_SIZE,
      channels: 4,
      background: '#f2f2f2',
    },
  })
    .composite([{ input: buildTextSvg(textRuns, layout.fontSize), left: 0, top: 0 }, ...emojiOverlays])
    .resize(512, 512, { kernel: 'nearest' })
    .webp({ quality: 60 })
    .toBuffer();
}

export const SbratStickerCommand: Command = {
  name: 'sbrat',
  aliases: ['brat'],
  category: CommandCategory.STICKER,
  description: 'Create a pixelated text meme sticker',
  usage: 'sbrat <text>',
  async execute(ctx) {
    const text = (ctx.rawArgs || ctx.args.join(' ')).trim();
    if (!text) {
      await ctx.reply('Usage: .sbrat <text>');
      return;
    }

    const sticker = await createSbratSticker(text);
    await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
      sticker,
      mimetype: 'image/webp',
    });
  },
};
