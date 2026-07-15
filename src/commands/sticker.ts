import { BotContext, Command, CommandCategory } from '../types';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import type { proto } from '@whiskeysockets/baileys';
import { stickerEngine } from '../services/sticker-engine';
import { StickerRevertCommand } from './sticker/convert';
import { MemeStickerCommand, QuoteStickerCommand, StickerTextCommand } from './sticker/meme';
import { BorderStickerCommand } from './sticker/shape';
import { SbratStickerCommand } from './sticker/sbrat';
import { UrlStickerCommand } from './sticker/url';
import { downloadMediaFromContext } from './media/helpers';

const STICKER_WATERMARK = 'Created with CrystalDust V0 Bot';
const SHAPES = new Set(['circle', 'rounded']);
const EFFECTS: Record<string, { label: string; run(buffer: Buffer): Promise<Buffer> }> = {
  bw: { label: 'black and white', run: (buffer) => stickerEngine.createBlackAndWhiteSticker(buffer) },
  blackwhite: { label: 'black and white', run: (buffer) => stickerEngine.createBlackAndWhiteSticker(buffer) },
  sepia: { label: 'sepia', run: (buffer) => stickerEngine.createSepiaSticker(buffer) },
  vintage: { label: 'vintage', run: (buffer) => stickerEngine.createVintageSticker(buffer) },
  retro: { label: 'vintage', run: (buffer) => stickerEngine.createVintageSticker(buffer) },
  cartoon: { label: 'cartoon', run: (buffer) => stickerEngine.createCartoonSticker(buffer) },
  toon: { label: 'cartoon', run: (buffer) => stickerEngine.createCartoonSticker(buffer) },
  glitch: { label: 'glitch', run: (buffer) => stickerEngine.createGlitchSticker(buffer) },
  glitchy: { label: 'glitch', run: (buffer) => stickerEngine.createGlitchSticker(buffer) },
};
const SUBCOMMANDS: Record<string, Command> = {
  border: BorderStickerCommand,
  text: StickerTextCommand,
  stext: StickerTextCommand,
  meme: MemeStickerCommand,
  memesticker: MemeStickerCommand,
  quote: QuoteStickerCommand,
  quotesticker: QuoteStickerCommand,
  url: UrlStickerCommand,
  link: UrlStickerCommand,
  revert: StickerRevertCommand,
  srevert: StickerRevertCommand,
  brat: SbratStickerCommand,
  sbrat: SbratStickerCommand,
};

function parseStickerArgs(rawArgs = ''): { shape?: 'circle' | 'rounded'; metadata: string } {
  const trimmed = rawArgs.trim();
  const [first = ''] = trimmed.split(/\s+/, 1);
  const shape = SHAPES.has(first.toLowerCase()) ? first.toLowerCase() as 'circle' | 'rounded' : undefined;
  const metadata = (shape ? trimmed.slice(first.length) : trimmed).trim().replace(/\s+/g, ' ').slice(0, 64);
  return { shape, metadata };
}

function subcommandContext(ctx: BotContext, rawArgs: string): BotContext {
  return {
    ...ctx,
    args: rawArgs ? rawArgs.split(/\s+/).filter(Boolean) : [],
    rawArgs,
  };
}

async function runSubcommand(ctx: BotContext): Promise<boolean> {
  const raw = (ctx.rawArgs || ctx.args.join(' ')).trim();
  const [first = ''] = raw.split(/\s+/, 1);
  const effect = EFFECTS[first.toLowerCase()];
  if (effect) {
    const media = await downloadMediaFromContext(ctx, ['image', 'sticker']);
    if (!media) {
      await ctx.reply(`Please send or reply to an image/sticker with .s ${first} [metadata]`);
      return true;
    }

    try {
      const metadata = raw.slice(first.length).trim().replace(/\s+/g, ' ').slice(0, 64);
      const sticker = await stickerEngine
        .getMetadataManager()
        .addMetadata(await effect.run(media.buffer), metadata, STICKER_WATERMARK);
      await ctx.socket.sendMessage(ctx.message.key.remoteJid!, { sticker, mimetype: 'image/webp' }, { quoted: ctx.message });
    } catch {
      await ctx.reply(`Failed to create ${effect.label} sticker.`);
    }
    return true;
  }

  const command = SUBCOMMANDS[first.toLowerCase()];
  if (!command) return false;

  await command.execute(subcommandContext(ctx, raw.slice(first.length).trim()));
  return true;
}

export const StickerCommand: Command = {
  name: 'sticker',
  aliases: ['s', 'stiker'],
  category: CommandCategory.STICKER,
  description: 'Create stickers and run sticker effects',
  usage: 'sticker [metadata]|<bw|sepia|vintage|cartoon|glitch|border|text|meme|url|revert|brat> ...',
  async execute(ctx) {
    if (await runSubcommand(ctx)) return;

    const msg = ctx.message.message;
    if (!msg) return;

    let media: proto.Message.IImageMessage | proto.Message.IVideoMessage | null = null;

    if (msg.imageMessage) {
      media = msg.imageMessage;
    } else if (msg.videoMessage) {
      media = msg.videoMessage;
    } else if (msg.extendedTextMessage?.contextInfo?.quotedMessage) {
      const quoted = msg.extendedTextMessage.contextInfo.quotedMessage;
      if (quoted.imageMessage) {
        media = quoted.imageMessage;
      } else if (quoted.videoMessage) {
        media = quoted.videoMessage;
      }
    }

    if (!media) {
      await ctx.socket.sendMessage(
        ctx.message.key.remoteJid!,
        { text: 'Please send or reply to an image or video!' },
        { quoted: ctx.message }
      );
      return;
    }

    try {
      const stream = await downloadContentFromMessage(media as any, media.mimetype?.startsWith('image/') ? 'image' : 'video');
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      let processedBuffer: Buffer;
      const { shape, metadata } = parseStickerArgs(ctx.rawArgs);
      const options = { packName: metadata, author: STICKER_WATERMARK };

      if ('mimetype' in media && media.mimetype?.startsWith('image/')) {
        if (shape) {
          processedBuffer = await stickerEngine.createShapedSticker(buffer, shape, options);
        } else {
          processedBuffer = await stickerEngine.createSticker(buffer, { ...options, smartCrop: true });
        }
      } else {
        processedBuffer = buffer;
      }

      await ctx.socket.sendMessage(
        ctx.message.key.remoteJid!,
        {
          sticker: processedBuffer,
          mimetype: 'image/webp',
          isAnimated: 'mimetype' in media ? media.mimetype?.startsWith('video/') : false,
        },
        { quoted: ctx.message }
      );
    } catch (err) {
      console.error(err);
      await ctx.socket.sendMessage(
        ctx.message.key.remoteJid!,
        { text: 'Failed to create sticker!' },
        { quoted: ctx.message }
      );
    }
  },
};

export default StickerCommand;
