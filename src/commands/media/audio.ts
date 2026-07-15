import mediaEngine from '../../services/media-engine';
import { AudioFormat as OutputAudioFormat } from '../../services/media-engine/audio-types';
import { AudioFormat } from '../../services/media-engine/video-types';
import { Command, CommandCategory } from '../../types';
import { downloadMediaFromContext } from './helpers';

type AudioEffectCommand = {
  name: string;
  aliases: string[];
  description: string;
  usage: string;
  run(buffer: Buffer, args: string[]): Promise<Buffer>;
};

type AudioConversionCommand = {
  name: string;
  aliases: string[];
  format: OutputAudioFormat;
  mimetype: string;
};

function numberArg(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

async function getAudio(ctx: Parameters<Command['execute']>[0]): Promise<Buffer | null> {
  const media = await downloadMediaFromContext(ctx, ['audio', 'document', 'video']);
  if (!media) {
    await ctx.reply('Send or reply to audio/video with this command.');
    return null;
  }

  return media.kind === 'video'
    ? mediaEngine.extractAudio(media.buffer, { format: AudioFormat.MP3, bitrate: 128 })
    : media.buffer;
}

function createAudioCommand(definition: AudioEffectCommand): Command {
  return {
    name: definition.name,
    aliases: definition.aliases,
    category: CommandCategory.MEDIA,
    description: definition.description,
    usage: definition.usage,
    async execute(ctx) {
      const input = await getAudio(ctx);
      if (!input) return;

      try {
        const audio = await definition.run(input, ctx.args);
        await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
          audio,
          mimetype: 'audio/mpeg',
        });
      } catch (err) {
        await ctx.reply(`Failed to apply ${definition.name}.`);
      }
    },
  };
}

function createAudioConversionCommand(definition: AudioConversionCommand): Command {
  return {
    name: definition.name,
    aliases: definition.aliases,
    category: CommandCategory.MEDIA,
    description: `Convert audio to ${definition.format.toUpperCase()}`,
    usage: `${definition.name} [bitrate]`,
    async execute(ctx) {
      const input = await getAudio(ctx);
      if (!input) return;

      try {
        const bitrate = numberArg(ctx.args[0], 128, 32, 320);
        const audio = await mediaEngine.convertAudio(input, {
          format: definition.format,
          bitrate,
        });
        await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
          document: audio,
          mimetype: definition.mimetype,
          fileName: `audio.${definition.format}`,
        });
      } catch (err) {
        await ctx.reply(`Failed to convert audio to ${definition.format}.`);
      }
    },
  };
}

export const ToAudioCommand: Command = {
  name: 'toaudio',
  aliases: ['convertaudio', 'audioconvert'],
  category: CommandCategory.MEDIA,
  description: 'Convert audio or video to MP3, WAV, or OGG',
  usage: 'toaudio <mp3|wav|ogg> [bitrate]',
  async execute(ctx) {
    const requestedFormat = (ctx.args[0] || '').toLowerCase();
    const formats: Record<string, AudioConversionCommand> = {
      mp3: { name: 'toaudio', aliases: [], format: OutputAudioFormat.MP3, mimetype: 'audio/mpeg' },
      wav: { name: 'toaudio', aliases: [], format: OutputAudioFormat.WAV, mimetype: 'audio/wav' },
      ogg: { name: 'toaudio', aliases: [], format: OutputAudioFormat.OGG, mimetype: 'audio/ogg' },
    };
    const definition = formats[requestedFormat];

    if (!definition) {
      await ctx.reply('Usage: .toaudio <mp3|wav|ogg> [bitrate]');
      return;
    }

    const input = await getAudio(ctx);
    if (!input) return;

    try {
      const audio = await mediaEngine.convertAudio(input, {
        format: definition.format,
        bitrate: numberArg(ctx.args[1], 128, 32, 320),
      });
      await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
        document: audio,
        mimetype: definition.mimetype,
        fileName: `audio.${definition.format}`,
      });
    } catch {
      await ctx.reply(`Failed to convert audio to ${definition.format}.`);
    }
  },
};

export const BassBoostCommand = createAudioCommand({
  name: 'bassboost',
  aliases: ['bass'],
  description: 'Bass boost audio',
  usage: 'bassboost [gain]',
  run: (buffer, args) => mediaEngine.bassBoost(buffer, { gain: numberArg(args[0], 15, 1, 30) }),
});

export const NightcoreCommand = createAudioCommand({
  name: 'nightcore',
  aliases: ['nc'],
  description: 'Apply nightcore effect',
  usage: 'nightcore [speed]',
  run: (buffer, args) => mediaEngine.nightcore(buffer, {
    speed: numberArg(args[0], 1.25, 0.5, 2),
    pitch: numberArg(args[0], 1.25, 0.5, 2),
  }),
});

export const ReverbCommand = createAudioCommand({
  name: 'reverb',
  aliases: [],
  description: 'Apply reverb effect',
  usage: 'reverb [delay]',
  run: (buffer, args) => mediaEngine.reverb(buffer, { delay: numberArg(args[0], 500, 50, 2000) }),
});

export const EchoCommand = createAudioCommand({
  name: 'echo',
  aliases: [],
  description: 'Apply echo effect',
  usage: 'echo [delay]',
  run: (buffer, args) => mediaEngine.echo(buffer, { delay: numberArg(args[0], 500, 50, 2000) }),
});

export const AudioCompressorCommand = createAudioCommand({
  name: 'compressaudio',
  aliases: ['audiocompress'],
  description: 'Compress audio dynamics',
  usage: 'compressaudio',
  run: (buffer) => mediaEngine.compressAudio(buffer),
});

export const VocalRemoverCommand = createAudioCommand({
  name: 'vocalremover',
  aliases: ['removevocal'],
  description: 'Reduce vocals from audio',
  usage: 'vocalremover',
  run: (buffer) => mediaEngine.vocalRemover(buffer),
});

export const ToMp3Command = createAudioConversionCommand({
  name: 'tomp3',
  aliases: ['mp3'],
  format: OutputAudioFormat.MP3,
  mimetype: 'audio/mpeg',
});

export const ToWavCommand = createAudioConversionCommand({
  name: 'towav',
  aliases: ['wav'],
  format: OutputAudioFormat.WAV,
  mimetype: 'audio/wav',
});

export const ToOggCommand = createAudioConversionCommand({
  name: 'toogg',
  aliases: ['ogg'],
  format: OutputAudioFormat.OGG,
  mimetype: 'audio/ogg',
});
