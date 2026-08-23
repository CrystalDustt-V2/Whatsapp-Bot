import config from '../config';
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
import { formatUsageError, formatFailed } from '../core/response-formatter';

const STICKER_WATERMARK = 'Created with CrystalDust V0 Bot';
const SHAPES = new Set(['circle', 'rounded']);

const EFFECTS: Record<string, { label: string; run(buffer: Buffer): Promise<Buffer> }> = {
  bw: { label: 'black and white', run: (buffer) => stickerEngine.createBlackAndWhiteSticker(buffer) },
  blackwhite: { label: 'black and white', run: (buffer) => stickerEngine.createBlackAndWhiteSticker(buffer) },
  grayscale: { label: 'black and white', run: (buffer) => stickerEngine.createBlackAndWhiteSticker(buffer) },
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

interface ParsedStickerOptions {
  noCrop: boolean;
  shape?: 'circle' | 'rounded';
  effect?: string;
  packName?: string;
  author?: string;
  helpRequested: boolean;
  remainingText: string;
}

function parseStickerFlags(rawArgs = ''): ParsedStickerOptions {
  const tokens = rawArgs.trim().split(/\s+/).filter(Boolean);
  let noCrop = false;
  let shape: 'circle' | 'rounded' | undefined;
  let effect: string | undefined;
  let packName: string | undefined;
  let author: string | undefined;
  let helpRequested = false;
  const remainingTokens: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const lower = token.toLowerCase();

    if (lower === '--help' || lower === '-h') {
      helpRequested = true;
    } else if (lower === '--nocrop' || lower === '--no-crop' || lower === '--nobg') {
      noCrop = true;
    } else if (lower === '--circle' || lower === '--round') {
      shape = 'circle';
    } else if (lower === '--rounded') {
      shape = 'rounded';
    } else if (lower === '--bw' || lower === '--grayscale' || lower === '--blackwhite') {
      effect = 'bw';
    } else if (lower === '--sepia') {
      effect = 'sepia';
    } else if (lower === '--vintage' || lower === '--retro') {
      effect = 'vintage';
    } else if (lower === '--glitch') {
      effect = 'glitch';
    } else if (lower === '--cartoon' || lower === '--toon') {
      effect = 'cartoon';
    } else if (lower === '--pack' && tokens[i + 1]) {
      packName = tokens[++i];
    } else if (lower === '--author' && tokens[i + 1]) {
      author = tokens[++i];
    } else if (SHAPES.has(lower) && !shape) {
      shape = lower as 'circle' | 'rounded';
    } else if (EFFECTS[lower] && !effect) {
      effect = lower;
    } else {
      remainingTokens.push(token);
    }
  }

  return {
    noCrop,
    shape,
    effect,
    packName,
    author,
    helpRequested,
    remainingText: remainingTokens.join(' ').slice(0, 64),
  };
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

  const command = SUBCOMMANDS[first.toLowerCase()];
  if (!command) return false;

  await command.execute(subcommandContext(ctx, raw.slice(first.length).trim()));
  return true;
}

export const StickerCommand: Command = {
  name: 'sticker',
  aliases: ['s', 'stiker'],
  category: CommandCategory.STICKER,
  description: 'Convert images/videos into high-quality WhatsApp stickers with shapes, filters, and pack info',
  usage: 'sticker [--circle|--rounded] [--nocrop] [--bw|--sepia|--glitch|--cartoon] [--pack <name>] [--author <name>]',
  examples: [
    'sticker',
    'sticker --circle',
    'sticker --rounded --bw',
    'sticker --nocrop --pack "My Cool Pack"',
    's glitch',
    's sepia',
    's brat hello world',
  ],
  inputs: 'Attached or quoted image, GIF, or short video (<10s)',
  limits: 'Max 10MB media, max 10s video length',
  async execute(ctx) {
    if (await runSubcommand(ctx)) return;

    const parsed = parseStickerFlags(ctx.rawArgs || ctx.args.join(' '));

    if (parsed.helpRequested) {
      const helpText = [
        `🎨 *Sticker Generator Options & Flags*`,
        `\n*Shapes:*`,
        `• \`--circle\` : Crop image into a circle`,
        `• \`--rounded\` : Crop image with rounded corners`,
        `\n*Cropping:*`,
        `• \`--nocrop\` : Preserve original image aspect ratio without smart cropping`,
        `\n*Visual Effects:*`,
        `• \`--bw\` : Black & White grayscale`,
        `• \`--sepia\` : Vintage warm sepia filter`,
        `• \`--glitch\` : Cyberpunk RGB glitch effect`,
        `• \`--cartoon\` : Comic book style filter`,
        `\n*Metadata:*`,
        `• \`--pack <name>\` : Set sticker pack name`,
        `• \`--author <name>\` : Set sticker author name`,
        `\n*Special Subcommands:*`,
        `• \`.s brat <text>\` : Generate brat aesthetic text sticker`,
        `• \`.s meme <top>|<bottom>\` : Generate top/bottom meme sticker`,
        `• \`.s revert\` : Convert sticker back to standard image`,
        `\n*Usage:* Send an image with caption \`.sticker --circle\` or reply to an existing photo.`,
      ];
      await ctx.reply(helpText.join('\n'));
      return;
    }

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
      await ctx.reply(
        formatUsageError({
          command: 'sticker',
          reason: 'No image or video detected in this message or quoted reply.',
          examples: [
            'sticker (send with image)',
            'sticker --circle (reply to image)',
            'sticker --nocrop (reply to image)',
            'sticker --bw --pack "My Pack"',
          ],
          hint: 'Send an image with caption .sticker or reply to an existing image/video. Type .sticker --help for all flags.',
        })
      );
      return;
    }

    try {
      const stream = await downloadContentFromMessage(media as any, media.mimetype?.startsWith('image/') ? 'image' : 'video');
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      let buffer: Buffer = Buffer.concat(chunks);

      // Apply effect filter if requested
      if (parsed.effect && EFFECTS[parsed.effect]) {
        buffer = Buffer.from(await EFFECTS[parsed.effect].run(buffer));
      }

      let processedBuffer: Buffer;
      const options = {
        packName: parsed.packName || parsed.remainingText || config.OWNER_NAME,
        author: parsed.author || STICKER_WATERMARK,
      };

      if ('mimetype' in media && media.mimetype?.startsWith('image/')) {
        if (parsed.shape) {
          processedBuffer = await stickerEngine.createShapedSticker(buffer, parsed.shape, options);
        } else {
          processedBuffer = await stickerEngine.createSticker(buffer, { ...options, smartCrop: !parsed.noCrop });
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
      await ctx.reply(
        formatFailed({
          title: 'Sticker Creation',
          reason: 'Could not process media into a sticker. File format might not be supported or file exceeds 10MB.',
          tryHint: 'Try sending a standard JPEG/PNG image or short MP4 video (<10s).',
        })
      );
    }
  },
};

export default StickerCommand;
