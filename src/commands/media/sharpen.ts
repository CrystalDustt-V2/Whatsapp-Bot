import { Command, CommandCategory } from '../../types';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import mediaEngine from '../../services/media-engine';

export const SharpenCommand: Command = {
  name: 'sharpen',
  aliases: [],
  category: CommandCategory.MEDIA,
  description: 'Sharpen an image',
  usage: 'sharpen',
  async execute(ctx) {
    const msg = ctx.message.message;
    if (!msg) return;

    let media = null;

    if (msg.imageMessage) {
      media = msg.imageMessage;
    } else if (msg.extendedTextMessage?.contextInfo?.quotedMessage) {
      const quoted = msg.extendedTextMessage.contextInfo.quotedMessage;
      if (quoted.imageMessage) {
        media = quoted.imageMessage;
      }
    }

    if (!media) {
      await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
        text: 'Please send or reply to an image with .sharpen',
      });
      return;
    }

    const stream = await downloadContentFromMessage(media as any, 'image');
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    const editedBuffer = await mediaEngine.sharpenImage(buffer);

    await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
      image: editedBuffer,
      caption: 'Here is your sharpened image!',
    });
  },
};

export default SharpenCommand;
