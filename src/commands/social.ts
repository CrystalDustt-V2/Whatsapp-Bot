import { Command, CommandCategory } from '../types';
import { downloadYtDlpVideo } from '../services/tiktok-downloader';

type SocialCommandDefinition = {
  name: string;
  aliases: string[];
  description: string;
  usage: string;
  mediaHosts?: string[];
  run(query: string): string | null;
};

function httpUrl(input: string, hosts: string[]): string | null {
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    return ['http:', 'https:'].includes(url.protocol) &&
      hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function handle(input: string, max = 30): string | null {
  const value = input.replace(/^@/, '').trim();
  return new RegExp(`^[A-Za-z0-9._]{1,${max}}$`).test(value) ? value : null;
}

function googleSite(site: string, query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`site:${site} ${query}`)}`;
}

function createSocialCommand(definition: SocialCommandDefinition): Command {
  return {
    name: definition.name,
    aliases: definition.aliases,
    category: CommandCategory.DOWNLOADER,
    description: definition.description,
    usage: definition.usage,
    async execute(ctx) {
      const query = ctx.args.join(' ').trim();
      if (!query) {
        await ctx.reply(`Usage: .${definition.usage}`);
        return;
      }

      const mediaUrl = definition.mediaHosts ? httpUrl(query, definition.mediaHosts) : null;
      if (mediaUrl) {
        try {
          await ctx.reply(`Downloading ${definition.name} video...`);
          const video = await downloadYtDlpVideo(mediaUrl);
          await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
            video,
            mimetype: 'video/mp4',
            caption: `${definition.name} video`,
          });
        } catch {
          await ctx.reply(`Could not download video from that ${definition.name} URL.`);
        }
        return;
      }

      const url = definition.run(query);
      await ctx.reply(url || `Could not understand: ${query}`);
    },
  };
}

export const SocialCommands = [
  createSocialCommand({
    name: 'instagram',
    aliases: ['ig', 'reels'],
    description: 'Download Instagram video URL or search reels',
    usage: 'instagram <url|query>',
    mediaHosts: ['instagram.com'],
    run: (query) => httpUrl(query, ['instagram.com']) || googleSite('instagram.com/reel', query),
  }),
  createSocialCommand({
    name: 'facebook',
    aliases: ['fb', 'fbvideo'],
    description: 'Download Facebook video URL or search videos',
    usage: 'facebook <url|query>',
    mediaHosts: ['facebook.com', 'fb.watch'],
    run: (query) => httpUrl(query, ['facebook.com', 'fb.watch']) || googleSite('facebook.com/watch', query),
  }),
  createSocialCommand({
    name: 'twitter',
    aliases: ['x', 'tweet'],
    description: 'Download X/Twitter video URL or search posts',
    usage: 'twitter <url|query>',
    mediaHosts: ['x.com', 'twitter.com'],
    run: (query) => httpUrl(query, ['x.com', 'twitter.com']) || `https://x.com/search?q=${encodeURIComponent(query)}`,
  }),
  createSocialCommand({
    name: 'vimeo',
    aliases: ['vimeovideo'],
    description: 'Download Vimeo video URL or search videos',
    usage: 'vimeo <url|query>',
    mediaHosts: ['vimeo.com'],
    run: (query) => httpUrl(query, ['vimeo.com']) || `https://vimeo.com/search?q=${encodeURIComponent(query)}`,
  }),
  createSocialCommand({
    name: 'snackvideo',
    aliases: ['snack'],
    description: 'Download SnackVideo URL or search videos',
    usage: 'snackvideo <url|query>',
    mediaHosts: ['snackvideo.com'],
    run: (query) => httpUrl(query, ['snackvideo.com']) || googleSite('snackvideo.com', query),
  }),
  createSocialCommand({
    name: 'pinvideo',
    aliases: ['pinterestvideo', 'pv'],
    description: 'Download Pinterest video URL or search videos',
    usage: 'pinvideo <url|query>',
    mediaHosts: ['pinterest.com', 'pin.it'],
    run: (query) => `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(`${query} video`)}`,
  }),
  createSocialCommand({
    name: 'igprofile',
    aliases: ['instaprofile', 'igp'],
    description: 'Open an Instagram profile',
    usage: 'igprofile <username>',
    run: (query) => {
      const username = handle(query);
      return username ? `https://www.instagram.com/${username}/` : null;
    },
  }),
  createSocialCommand({
    name: 'tiktokprofile',
    aliases: ['ttprofile', 'tiktokinfo'],
    description: 'Open a TikTok profile',
    usage: 'tiktokprofile <username>',
    run: (query) => {
      const username = handle(query, 24);
      return username ? `https://www.tiktok.com/@${username}` : null;
    },
  }),
  createSocialCommand({
    name: 'xprofile',
    aliases: ['twitterprofile', 'xinfo'],
    description: 'Open an X/Twitter profile',
    usage: 'xprofile <username>',
    run: (query) => {
      const username = handle(query, 15);
      return username ? `https://x.com/${username}` : null;
    },
  }),
];
