import type { proto } from '@whiskeysockets/baileys';
import type { BotContext } from '../types';

function unwrap(message?: proto.IMessage | null): proto.IMessage | undefined {
  for (let depth = 0; message && depth < 32; depth++) {
    const inner = message.ephemeralMessage?.message || message.viewOnceMessage?.message ||
      message.viewOnceMessageV2?.message || message.viewOnceMessageV2Extension?.message ||
      message.documentWithCaptionMessage?.message || message.editedMessage?.message || message.deviceSentMessage?.message;
    if (!inner) return message;
    message = inner;
  }
  return undefined;
}

export function getQuotedText(ctx: BotContext): string {
  const message = unwrap(ctx.message.message);
  const content = message?.extendedTextMessage || message?.imageMessage || message?.videoMessage || message?.documentMessage;
  const quoted = unwrap(content?.contextInfo?.quotedMessage);
  return (quoted?.conversation || quoted?.extendedTextMessage?.text || quoted?.imageMessage?.caption ||
    quoted?.videoMessage?.caption || quoted?.documentMessage?.caption || '').trim();
}
