import mediaEngine from '../../services/media-engine';
import type { ImageEditOptions } from '../../services/media-engine/image-editor';
import { Command, CommandCategory } from '../../types';
import { downloadMediaFromContext } from './helpers';

type Adjustment = 'brightness' | 'saturation' | 'contrast';

function percentArg(value: string | undefined): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 10 || parsed > 300) return null;
  return parsed / 100;
}

function createAdjustmentCommand(name: Adjustment, aliases: string[], description: string): Command {
  return {
    name,
    aliases,
    category: CommandCategory.MEDIA,
    description,
    usage: `${name} <10-300>`,
    async execute(ctx) {
      const amount = percentArg(ctx.args[0]);
      if (!amount) {
        await ctx.reply(`Usage: .${name} <10-300>\n100 keeps the original level.`);
        return;
      }

      const media = await downloadMediaFromContext(ctx, ['image']);
      if (!media) {
        await ctx.reply(`Please send or reply to an image with .${name} <10-300>`);
        return;
      }

      try {
        const options: ImageEditOptions = { [name]: amount };
        const edited = await mediaEngine.editImage(media.buffer, options);
        await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
          image: edited,
          caption: `Image ${name} set to ${Math.round(amount * 100)}%.`,
        });
      } catch (err) {
        await ctx.reply(`Failed to adjust image ${name}.`);
      }
    },
  };
}

export const BrightnessCommand = createAdjustmentCommand(
  'brightness',
  ['bright'],
  'Adjust image brightness'
);
export const SaturationCommand = createAdjustmentCommand(
  'saturation',
  ['saturate'],
  'Adjust image saturation'
);
export const ContrastCommand = createAdjustmentCommand(
  'contrast',
  [],
  'Adjust image contrast'
);
