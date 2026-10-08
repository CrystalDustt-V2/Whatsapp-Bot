import sharp from 'sharp';
import config from '../../config';
import aiService from '../../services/ai-service';
import { type BotContext, type Command, CommandCategory } from '../../types';
import { downloadMediaFromContext, MediaSizeError } from '../media/helpers';

async function replyText(ctx: BotContext, text: string, emptyMessage: string): Promise<void> {
  const chunks = text.trim().match(/[\s\S]{1,3500}/gu) || [emptyMessage];
  for (const chunk of chunks) await ctx.reply(chunk);
}

export const OCRCommand: Command = {
  name: 'ocr',
  aliases: ['imagetotext', 'image2text', 'readtext'],
  category: CommandCategory.UTILITY,
  description: 'Extract text from an image using Puter OCR',
  usage: 'ocr (reply to an image)',
  inputs: 'Attached or quoted image, sticker, or image document',
  limits: '20 MB input; 16 megapixels; requires PUTER_AUTH_TOKEN',
  cooldown: 10,
  async execute(ctx) {
    if (!config.PUTER_AUTH_TOKEN?.trim()) {
      await ctx.reply('Set PUTER_AUTH_TOKEN to enable .ocr.'); return;
    }
    try {
      const media = await downloadMediaFromContext(ctx, ['image', 'sticker', 'document'], 20 * 1024 * 1024);
      if (!media || (media.kind === 'document' && !media.mimetype.startsWith('image/'))) {
        await ctx.reply('Send an image with .ocr in its caption, or reply to an image/sticker with .ocr.'); return;
      }
      const image = await sharp(media.buffer, { limitInputPixels: 16_777_216 })
        .rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
        .png().toBuffer();
      const result = await aiService.analyzeImage(image, { mimeType: 'image/png', timeoutMs: config.PUTER_TIMEOUT_MS });
      await replyText(ctx, result.text, 'No readable text found in that image.');
    } catch (err) {
      await ctx.reply(err instanceof MediaSizeError ? err.message : 'OCR failed. Try a clearer image under 20 MB and 16 megapixels, and check your Puter connection.');
    }
  },
};

export const SpeechToTextCommand: Command = {
  name: 'stt',
  aliases: ['transcribe', 'speech2text', 'speechtotext'],
  category: CommandCategory.UTILITY,
  description: 'Transcribe audio or a voice note using Puter',
  usage: 'stt [language code] (reply to audio or a voice note)',
  inputs: 'Attached or quoted audio, voice note, or audio document',
  limits: '20 MB input; requires PUTER_AUTH_TOKEN',
  cooldown: 10,
  async execute(ctx) {
    if (!config.PUTER_AUTH_TOKEN?.trim()) {
      await ctx.reply('Set PUTER_AUTH_TOKEN to enable .stt.'); return;
    }
    const language = ctx.args[0] || config.AI_STT_LANGUAGE;
    if (ctx.args.length > 1 || (language && !/^[a-z]{2,3}(?:-[a-z]{2,4})?$/i.test(language))) {
      await ctx.reply('Usage: .stt [language code] (reply to audio). Example: .stt id'); return;
    }
    try {
      const media = await downloadMediaFromContext(ctx, ['audio', 'document'], 20 * 1024 * 1024);
      if (!media || (media.kind === 'document' && !media.mimetype.startsWith('audio/'))) {
        await ctx.reply('Reply to an audio message or voice note with .stt, optionally followed by a language code.'); return;
      }
      const result = await aiService.speechToText(media.buffer, {
        mimeType: media.mimetype || 'audio/ogg', language, model: config.AI_STT_MODEL || config.PUTER_STT_MODEL,
        timeoutMs: config.AI_STT_TIMEOUT_MS,
      });
      await replyText(ctx, result.text, 'No speech detected in that audio.');
    } catch (err) {
      await ctx.reply(err instanceof MediaSizeError ? err.message : 'Transcription failed. Check the audio format and your Puter connection.');
    }
  },
};
