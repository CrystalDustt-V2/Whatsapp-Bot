import { downloadContentFromMessage, proto } from '@whiskeysockets/baileys';
import type { BotContext } from '../../types';

export type DownloadableMediaKind = 'image' | 'video' | 'audio' | 'document';

export interface DownloadedMedia {
  buffer: Buffer;
  kind: DownloadableMediaKind;
  mimetype: string;
  fileName?: string;
  extension: string;
}

type AnyMediaMessage =
  | proto.Message.IImageMessage
  | proto.Message.IVideoMessage
  | proto.Message.IAudioMessage
  | proto.Message.IDocumentMessage;

function unwrapMessage(message?: proto.IMessage | null): proto.IMessage | undefined {
  if (!message) return undefined;

  const wrapped =
    message.viewOnceMessage?.message ||
    message.viewOnceMessageV2?.message ||
    message.viewOnceMessageV2Extension?.message ||
    message.ephemeralMessage?.message ||
    message.documentWithCaptionMessage?.message ||
    message.editedMessage?.message;

  return wrapped ? unwrapMessage(wrapped) : message;
}

function getMedia(
  message: proto.IMessage | undefined,
  allowedKinds: DownloadableMediaKind[]
): { media: AnyMediaMessage; kind: DownloadableMediaKind } | null {
  if (!message) return null;

  if (message.imageMessage && allowedKinds.includes('image')) {
    return { media: message.imageMessage, kind: 'image' };
  }

  if (message.videoMessage && allowedKinds.includes('video')) {
    return { media: message.videoMessage, kind: 'video' };
  }

  if (message.audioMessage && allowedKinds.includes('audio')) {
    return { media: message.audioMessage, kind: 'audio' };
  }

  if (message.documentMessage && allowedKinds.includes('document')) {
    return { media: message.documentMessage, kind: 'document' };
  }

  return null;
}

function extensionFromMedia(media: AnyMediaMessage, kind: DownloadableMediaKind): string {
  const fileName = 'fileName' in media ? media.fileName || undefined : undefined;
  const mimetype = media.mimetype || '';
  const fileExtension = fileName?.split('.').pop()?.toLowerCase();
  const mimeExtension = mimetype.split('/')[1]?.split(';')[0]?.toLowerCase();

  if (fileExtension && fileExtension.length <= 5) {
    return fileExtension === 'jpeg' ? 'jpg' : fileExtension;
  }

  if (mimeExtension) {
    return mimeExtension === 'jpeg' ? 'jpg' : mimeExtension;
  }

  return kind === 'image' ? 'jpg' : kind === 'video' ? 'mp4' : kind === 'audio' ? 'mp3' : 'bin';
}

export async function downloadMediaFromContext(
  ctx: BotContext,
  allowedKinds: DownloadableMediaKind[]
): Promise<DownloadedMedia | null> {
  const message = unwrapMessage(ctx.message.message);
  const quotedMessage = unwrapMessage(message?.extendedTextMessage?.contextInfo?.quotedMessage);
  const found = getMedia(message, allowedKinds) || getMedia(quotedMessage, allowedKinds);

  if (!found) return null;

  const stream = await downloadContentFromMessage(found.media as any, found.kind);
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return {
    buffer: Buffer.concat(chunks),
    kind: found.kind,
    mimetype: found.media.mimetype || '',
    fileName: 'fileName' in found.media ? found.media.fileName || undefined : undefined,
    extension: extensionFromMedia(found.media, found.kind),
  };
}
