import { Command, CommandCategory } from '../../types';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import mediaEngine from '../../services/media-engine';

export const BlurCommand: Command = {
  name: 'blur',
  aliases: [],
  category: CommandCategory.MEDIA,
  description: 'Blur an image',
  usage: 'blur [amount]',
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
        text: 'Please send or reply to an image with .blur [amount]',
      });
      return;
    }

    const stream = await downloadContentFromMessage(media as any, 'image');
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    const amount = ctx.args.length ? parseInt(ctx.args[0]) || 5 : 5;
    const editedBuffer = await mediaEngine.blurImage(buffer, amount);

    await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
      image: editedBuffer,
      caption: 'Here is your blurred image!',
    });
  },
};

export default BlurCommand;
