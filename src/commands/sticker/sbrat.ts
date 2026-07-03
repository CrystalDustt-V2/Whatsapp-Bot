import sharp from 'sharp';
import { Command, CommandCategory } from '../../types';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getLines(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, 180)
    .split('\n')
    .flatMap((line) => line.trim().match(/.{1,42}/g) || [''])
    .slice(0, 6);
}

async function createSbratSticker(text: string): Promise<Buffer> {
  const lines = getLines(text);
  const longest = Math.max(...lines.map((line) => line.length), 1);
  const fontSize = Math.max(
    4,
    Math.min(20, Math.floor(112 / (longest * 0.58)), Math.floor(94 / (lines.length * 1.15)))
  );
  const x = 8;
  const startY = 20;

  const svg = `
    <svg width="128" height="128" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
      <rect width="128" height="128" fill="#f2f2f2"/>
      <text x="${x}" y="${startY}" text-anchor="start" dominant-baseline="hanging" xml:space="preserve"
        font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="400" fill="#111">
        ${lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : fontSize * 1.12}">${escapeXml(line)}</tspan>`).join('')}
      </text>
    </svg>
  `;

  return sharp(Buffer.from(svg))
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
