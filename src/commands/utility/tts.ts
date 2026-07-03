import config from '../../config';
import { Command, CommandCategory } from '../../types';

const AI_API_BASE_URL = (config.AI_API_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
const AI_API_KEY = config.AI_API_KEY || config.OPENROUTER_API_KEY;
const AI_TTS_API_BASE_URL = (config.AI_TTS_API_BASE_URL || AI_API_BASE_URL).replace(/\/$/, '');
const AI_TTS_API_KEY = config.AI_TTS_API_KEY || AI_API_KEY;
const IS_TTS_POLLINATIONS = AI_TTS_API_BASE_URL.includes('pollinations.ai');
const AI_TTS_MODEL = config.AI_TTS_MODEL || (IS_TTS_POLLINATIONS ? 'openai-audio' : config.OPENROUTER_TTS_MODEL);
const AI_TTS_VOICE = config.AI_TTS_VOICE || (IS_TTS_POLLINATIONS ? 'nova' : config.OPENROUTER_TTS_VOICE);

function headers(): Record<string, string> {
  const result: Record<string, string> = { 'Content-Type': 'application/json' };
  if (AI_TTS_API_KEY) result.Authorization = `Bearer ${AI_TTS_API_KEY}`;
  if (AI_TTS_API_BASE_URL.includes('openrouter.ai')) {
    result['HTTP-Referer'] = config.DASHBOARD_URL;
    result['X-Title'] = 'WhatsApp Hybrid Bot';
  }
  return result;
}

async function generateSpeech(text: string): Promise<{ buffer: Buffer; mimetype: string }> {
  if (!AI_TTS_MODEL) throw new Error('missing-model');
  if (!AI_TTS_API_KEY && !IS_TTS_POLLINATIONS) throw new Error('missing-key');

  if (IS_TTS_POLLINATIONS) {
    const params = new URLSearchParams({ model: AI_TTS_MODEL, voice: AI_TTS_VOICE });
    const response = await fetch(`https://gen.pollinations.ai/audio/${encodeURIComponent(text.slice(0, 4000))}?${params}`, {
      headers: headers(),
    });
    if (!response.ok) throw new Error('provider-failed');
    const mimetype = response.headers.get('content-type')?.split(';')[0] || 'audio/mpeg';
    return { buffer: Buffer.from(await response.arrayBuffer()), mimetype };
  }

  const response = await fetch(`${AI_TTS_API_BASE_URL}/audio/speech`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      model: AI_TTS_MODEL,
      input: text.slice(0, 4000),
      voice: AI_TTS_VOICE,
      response_format: 'mp3',
    }),
  });
  if (!response.ok) throw new Error('provider-failed');
  return { buffer: Buffer.from(await response.arrayBuffer()), mimetype: 'audio/mpeg' };
}

export const TextToSpeechCommand: Command = {
  name: 'tts',
  aliases: ['say', 'voice', 'texttospeech'],
  category: CommandCategory.UTILITY,
  description: 'Convert text to speech audio',
  usage: 'tts <text>',
  async execute(ctx) {
    const text = (ctx.rawArgs || ctx.args.join(' ')).trim();
    if (!text) {
      await ctx.reply('Usage: .tts <text>');
      return;
    }

    try {
      const audio = await generateSpeech(text);
      await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
        audio: audio.buffer,
        mimetype: audio.mimetype.startsWith('audio/') ? audio.mimetype : 'audio/mpeg',
        ptt: true,
      });
    } catch (err) {
      const message = err instanceof Error && err.message === 'missing-key'
        ? 'Set AI_TTS_API_KEY or AI_API_KEY first to use .tts.'
        : err instanceof Error && err.message === 'missing-model'
          ? 'Set AI_TTS_MODEL first to use .tts.'
          : 'Failed to generate speech.';
      await ctx.reply(message);
    }
  },
};

export default TextToSpeechCommand;
