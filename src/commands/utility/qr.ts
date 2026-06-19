import { Command, CommandCategory } from '../../types';
import textUtils from '../../services/text-utils';

export const QRCommand: Command = {
  name: 'qr',
  aliases: ['qrcode'],
  category: CommandCategory.UTILITY,
  description: 'Generate QR code from text',
  usage: 'qr <text>',
  async execute(ctx) {
    if (!ctx.args.length) {
      await ctx.socket.sendMessage(ctx.message.key.remoteJid!, { text: 'Usage: .qr <text>' });
      return;
    }

    const text = ctx.args.join(' ');
    const qrBuffer = await textUtils.generateQRCode(text);

    await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
      image: qrBuffer,
      caption: 'Here is your QR code!',
    });
  },
};

export default QRCommand;
