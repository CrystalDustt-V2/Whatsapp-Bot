import sharp from 'sharp';
import { Command, CommandCategory } from '../../types';
import { downloadMediaFromContext } from '../media/helpers';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapText(value: string, maxChars: number, maxLines: number): string[] {
  const words = value.replace(/\s+/g, ' ').trim().slice(0, 180).split(' ');
  const lines: string[] = [];

  for (const word of words) {
    if (!lines.length) {
      lines.push(word);
      continue;
    }

    const current = lines[lines.length - 1] || '';
    const next = current ? `${current} ${word}` : word;

    if (next.length <= maxChars) {
      lines[lines.length - 1] = next;
    } else {
      lines.push(word);
    }
  }

  return lines.slice(0, maxLines);
}

function memeOverlay(top: string, bottom: string): Buffer {
  const topLines = wrapText(top, 20, 3);
  const bottomLines = wrapText(bottom, 20, 3);
  const topText = topLines
    .map((line, index) => `<tspan x="256" y="${42 + index * 54}">${escapeXml(line.toUpperCase())}</tspan>`)
    .join('');
  const bottomStart = 470 - (bottomLines.length - 1) * 54;
  const bottomText = bottomLines
    .map((line, index) => `<tspan x="256" y="${bottomStart + index * 54}">${escapeXml(line.toUpperCase())}</tspan>`)
    .join('');

  return Buffer.from(`
    <svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
      <style>
        text { font-family: Impact, "Arial Black", sans-serif; font-size: 48px; font-weight: 900; fill: white; stroke: black; stroke-width: 8px; paint-order: stroke; text-anchor: middle; dominant-baseline: middle; }
      </style>
      <text>${topText}</text>
      <text>${bottomText}</text>
    </svg>
  `);
}

async function makeQuoteSticker(author: string, quote: string): Promise<Buffer> {
  const quoteLines = wrapText(quote, 26, 7);
  const fontSize = quoteLines.length > 4 ? 28 : 34;
  const text = quoteLines
    .map((line, index) => `<tspan x="46" dy="${index === 0 ? 0 : fontSize * 1.22}">${escapeXml(line)}</tspan>`)
    .join('');

  const svg = `
    <svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
      <rect width="512" height="512" rx="54" fill="#111827"/>
      <rect x="32" y="32" width="448" height="448" rx="42" fill="#f8fafc"/>
      <text x="48" y="92" font-family="Georgia, serif" font-size="74" fill="#94a3b8">"</text>
      <text x="46" y="158" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" fill="#111827">
        ${text}
      </text>
      <text x="46" y="438" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="700" fill="#475569">- ${escapeXml(author.slice(0, 42))}</text>
    </svg>
  `;

  return sharp(Buffer.from(svg)).webp({ quality: 90 }).toBuffer();
}

export const MemeStickerCommand: Command = {
  name: 'memesticker',
  aliases: ['mstick', 'memestick'],
  category: CommandCategory.STICKER,
  description: 'Add meme text to an image sticker',
  usage: 'memesticker <top text>|<bottom text>',
  async execute(ctx) {
    const text = (ctx.rawArgs || ctx.args.join(' ')).trim();
    const [top = '', bottom = ''] = text.split('|').map((part) => part.trim());

    if (!top && !bottom) {
      await ctx.reply('Usage: .memesticker <top text>|<bottom text>');
      return;
    }

    const media = await downloadMediaFromContext(ctx, ['image']);
    if (!media) {
      await ctx.reply('Please send or reply to an image with .memesticker <top>|<bottom>');
      return;
    }

    try {
      const sticker = await sharp(media.buffer)
        .resize(512, 512, { fit: 'cover' })
        .composite([{ input: memeOverlay(top, bottom), gravity: 'center' }])
        .webp({ quality: 90 })
        .toBuffer();

      await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
        sticker,
        mimetype: 'image/webp',
      });
    } catch (err) {
      await ctx.reply('Failed to create meme sticker.');
    }
  },
};

export const QuoteStickerCommand: Command = {
  name: 'quotesticker',
  aliases: ['qstick', 'quote2sticker'],
  category: CommandCategory.STICKER,
  description: 'Create a quote sticker',
  usage: 'quotesticker [author]|<quote>',
  async execute(ctx) {
    const text = (ctx.rawArgs || ctx.args.join(' ')).trim();
    if (!text) {
      await ctx.reply('Usage: .quotesticker [author]|<quote>');
      return;
    }

    const parts = text.split('|').map((part) => part.trim());
    const author = parts.length > 1 ? parts[0] || 'Anonymous' : 'Anonymous';
    const quote = parts.length > 1 ? parts.slice(1).join(' | ') : parts[0];

    const sticker = await makeQuoteSticker(author, quote);
    await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
      sticker,
      mimetype: 'image/webp',
    });
  },
};
