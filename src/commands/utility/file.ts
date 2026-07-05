import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { downloadMediaFromContext } from '../media/helpers';
import { isPrivateAddress, normalizeHttpUrl } from '../../services/network-tools';
import { Command, CommandCategory } from '../../types';

const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const MAX_REDIRECTS = 3;

function cleanFileName(name: string, fallbackExt: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);

  if (!cleaned) return `file.${fallbackExt}`;
  return /\.[a-z0-9]{1,8}$/i.test(cleaned) ? cleaned : `${cleaned}.${fallbackExt}`;
}

function extensionFromType(contentType: string): string {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  if (contentType.includes('mpeg')) return 'mp3';
  if (contentType.includes('ogg')) return 'ogg';
  if (contentType.includes('mp4')) return 'mp4';
  if (contentType.includes('pdf')) return 'pdf';
  if (contentType.includes('zip')) return 'zip';
  return 'bin';
}

function fileNameFromResponse(url: string, contentType: string, requestedName?: string): string {
  if (requestedName) return cleanFileName(requestedName, extensionFromType(contentType));

  try {
    const fromPath = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    return cleanFileName(fromPath || 'download', extensionFromType(contentType));
  } catch {
    return cleanFileName('download', extensionFromType(contentType));
  }
}

async function assertPublicUrl(url: string): Promise<void> {
  const host = new URL(url).hostname;
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('private-host');
    return;
  }

  const addresses = await lookup(host, { all: true });
  if (!addresses.some((entry) => !isPrivateAddress(entry.address))) {
    throw new Error('private-host');
  }
}

async function downloadPublicUrl(inputUrl: string): Promise<{ url: string; buffer: Buffer; contentType: string }> {
  let url = inputUrl;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    await assertPublicUrl(url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(url, { redirect: 'manual', signal: controller.signal });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw new Error('bad-redirect');
        url = new URL(location, url).toString();
        continue;
      }

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const contentLength = Number(response.headers.get('content-length') || 0);
      if (contentLength > MAX_DOWNLOAD_BYTES) throw new Error('too-large');

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > MAX_DOWNLOAD_BYTES) throw new Error('too-large');

      return {
        url,
        buffer,
        contentType: response.headers.get('content-type')?.split(';')[0]?.toLowerCase() || 'application/octet-stream',
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error('too-many-redirects');
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

export const DownloadFileCommand: Command = {
  name: 'download',
  aliases: ['fetchfile', 'getfile'],
  category: CommandCategory.UTILITY,
  description: 'Download a public URL as a file under 20 MB',
  usage: 'download <url> [filename]',
  async execute(ctx) {
    const url = normalizeHttpUrl(ctx.args[0] || '');
    const requestedName = ctx.args.slice(1).join(' ').trim();
    if (!url) {
      await ctx.reply('Usage: .download <url> [filename]\nMaximum file size: 20 MB');
      return;
    }

    try {
      const file = await downloadPublicUrl(url);
      await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
        document: file.buffer,
        mimetype: file.contentType,
        fileName: fileNameFromResponse(file.url, file.contentType, requestedName),
      });
    } catch (err) {
      const message = err instanceof Error && err.message === 'too-large'
        ? 'Download refused: file is over 20 MB.'
        : 'Could not download that public URL.';
      await ctx.reply(message);
    }
  },
};
