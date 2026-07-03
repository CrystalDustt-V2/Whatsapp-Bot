import mediaEngine from '../../services/media-engine';
import { AudioFormat } from '../../services/media-engine/video-types';
import { Command, CommandCategory } from '../../types';
import { downloadMediaFromContext } from './helpers';

function numberArg(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

async function getVideo(ctx: Parameters<Command['execute']>[0]): Promise<Buffer | null> {
  const media = await downloadMediaFromContext(ctx, ['video']);
  if (!media) {
    await ctx.reply('Send or reply to a video with this command.');
    return null;
  }

  return media.buffer;
}

export const TrimVideoCommand: Command = {
  name: 'trimvideo',
  aliases: ['vtrim'],
  category: CommandCategory.MEDIA,
  description: 'Trim a video',
  usage: 'trimvideo <startSeconds> <durationSeconds>',
  async execute(ctx) {
    const video = await getVideo(ctx);
    if (!video) return;

    const startTime = numberArg(ctx.args[0], 0, 0, 3600);
    const duration = numberArg(ctx.args[1], 10, 1, 120);

    try {
      const output = await mediaEngine.trimVideo(video, { startTime, duration });
      await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
        video: output,
        mimetype: 'video/mp4',
        caption: `Trimmed video: ${startTime}s + ${duration}s`,
      });
    } catch (err) {
      await ctx.reply('Failed to trim this video.');
    }
  },
};

export const VideoSpeedCommand: Command = {
  name: 'videospeed',
  aliases: ['vspeed'],
  category: CommandCategory.MEDIA,
  description: 'Speed up or slow down a video',
  usage: 'videospeed <0.5-2>',
  async execute(ctx) {
    const video = await getVideo(ctx);
    if (!video) return;

    const speed = numberArg(ctx.args[0], 1.25, 0.5, 2);

    try {
      const output = await mediaEngine.changeVideoSpeed(video, { speed });
      await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
        video: output,
        mimetype: 'video/mp4',
        caption: `Video speed: ${speed}x`,
      });
    } catch (err) {
      await ctx.reply('Failed to change this video speed.');
    }
  },
};

export const ExtractAudioCommand: Command = {
  name: 'extractaudio',
  aliases: ['toaudio', 'videoaudio'],
  category: CommandCategory.MEDIA,
  description: 'Extract MP3 audio from a video',
  usage: 'extractaudio',
  async execute(ctx) {
    const video = await getVideo(ctx);
    if (!video) return;

    try {
      const audio = await mediaEngine.extractAudio(video, { format: AudioFormat.MP3, bitrate: 128 });
      await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
        audio,
        mimetype: 'audio/mpeg',
      });
    } catch (err) {
      await ctx.reply('Failed to extract audio from this video.');
    }
  },
};

export const VideoToGifCommand: Command = {
  name: 'videogif',
  aliases: ['togif', 'video2gif'],
  category: CommandCategory.MEDIA,
  description: 'Convert a video to GIF',
  usage: 'videogif [fps] [width]',
  async execute(ctx) {
    const video = await getVideo(ctx);
    if (!video) return;

    const fps = numberArg(ctx.args[0], 10, 1, 20);
    const width = numberArg(ctx.args[1], 480, 120, 720);

    try {
      const gif = await mediaEngine.videoToGif(video, { fps, width });
      await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
        document: gif,
        mimetype: 'image/gif',
        fileName: 'video.gif',
      });
    } catch (err) {
      await ctx.reply('Failed to convert this video to GIF.');
    }
  },
};
