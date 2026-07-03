import { downloadMediaFromContext } from '../media/helpers';
import { Command, CommandCategory } from '../../types';

function cleanFileName(name: string, fallbackExt: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);

  if (!cleaned) return `file.${fallbackExt}`;
  return /\.[a-z0-9]{1,8}$/i.test(cleaned) ? cleaned : `${cleaned}.${fallbackExt}`;
}

export const RenameFileCommand: Command = {
  name: 'renamefile',
  aliases: ['rename', 'filename'],
  category: CommandCategory.UTILITY,
  description: 'Resend media as a document with a new filename',
  usage: 'renamefile <new-name>',
  async execute(ctx) {
    const name = (ctx.rawArgs || ctx.args.join(' ')).trim();
    if (!name) {
      await ctx.reply('Usage: .renamefile <new-name>');
      return;
    }

    const media = await downloadMediaFromContext(ctx, ['image', 'video', 'audio', 'document']);
    if (!media) {
      await ctx.reply('Please send or reply to media with .renamefile <new-name>');
      return;
    }

    await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
      document: media.buffer,
      mimetype: media.mimetype || 'application/octet-stream',
      fileName: cleanFileName(name, media.extension),
    });
  },
};
