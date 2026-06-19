import mediaEngine from '../../services/media-engine';
import { Command, CommandCategory } from '../../types';
import { downloadMediaFromContext } from './helpers';

function formatBytes(bytes: number | undefined): string {
  if (!bytes) return 'unknown';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${Number(value.toFixed(2))} ${units[unit]}`;
}

function formatSeconds(seconds: number | undefined): string {
  if (!seconds) return 'unknown';
  return `${Number(seconds.toFixed(2))}s`;
}

export const MetadataCommand: Command = {
  name: 'metadata',
  aliases: ['mediainfo', 'exif'],
  category: CommandCategory.MEDIA,
  description: 'Show media metadata',
  usage: 'metadata',
  async execute(ctx) {
    const media = await downloadMediaFromContext(ctx, ['image', 'video', 'audio', 'document']);

    if (!media) {
      await ctx.reply('Please send or reply to media with .metadata');
      return;
    }

    try {
      const metadata = await mediaEngine.extractMetadata(media.buffer, media.extension);
      const lines = [
        '*Media Metadata*',
        `Type: ${media.kind}`,
        `Format: ${metadata.format || media.extension}`,
        `MIME: ${media.mimetype || 'unknown'}`,
        `Size: ${formatBytes(metadata.size || media.buffer.length)}`,
      ];

      if (metadata.width || metadata.height) {
        lines.push(`Dimensions: ${metadata.width || '?'}x${metadata.height || '?'}`);
      }

      if (metadata.duration) {
        lines.push(`Duration: ${formatSeconds(metadata.duration)}`);
      }

      if (metadata.bitrate) {
        lines.push(`Bitrate: ${metadata.bitrate} bps`);
      }

      if (metadata.video) {
        lines.push(`Video: ${metadata.video.codec} ${metadata.video.width}x${metadata.video.height} ${metadata.video.fps}fps`);
      }

      if (metadata.audio) {
        lines.push(`Audio: ${metadata.audio.codec} ${metadata.audio.sampleRate}Hz ${metadata.audio.channels}ch`);
      }

      await ctx.reply(lines.join('\n'));
    } catch (err) {
      await ctx.reply('Could not read metadata for this media.');
    }
  },
};

export const RemoveMetadataCommand: Command = {
  name: 'removemeta',
  aliases: ['clearmeta', 'removeexif'],
  category: CommandCategory.MEDIA,
  description: 'Remove image metadata',
  usage: 'removemeta',
  async execute(ctx) {
    const media = await downloadMediaFromContext(ctx, ['image']);

    if (!media) {
      await ctx.reply('Please send or reply to an image with .removemeta');
      return;
    }

    try {
      const cleaned = await mediaEngine.removeMetadata(media.buffer, media.extension);
      await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
        image: cleaned,
        caption: 'Image metadata removed.',
      });
    } catch (err) {
      await ctx.reply('Failed to remove metadata from this image.');
    }
  },
};
