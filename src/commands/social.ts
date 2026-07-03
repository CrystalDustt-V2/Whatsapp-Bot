import { Command, CommandCategory } from '../types';

type SocialCommandDefinition = {
  name: string;
  aliases: string[];
  description: string;
  usage: string;
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

      const url = definition.run(query);
      await ctx.reply(url || `Could not understand: ${query}`);
    },
  };
}

export const SocialCommands = [
  createSocialCommand({
    name: 'instagram',
    aliases: ['ig', 'reels'],
    description: 'Open Instagram URL or search reels',
    usage: 'instagram <url|query>',
    run: (query) => httpUrl(query, ['instagram.com']) || googleSite('instagram.com/reel', query),
  }),
  createSocialCommand({
    name: 'facebook',
    aliases: ['fb', 'fbvideo'],
    description: 'Open Facebook URL or search videos',
    usage: 'facebook <url|query>',
    run: (query) => httpUrl(query, ['facebook.com', 'fb.watch']) || googleSite('facebook.com/watch', query),
  }),
  createSocialCommand({
    name: 'twitter',
    aliases: ['x', 'tweet'],
    description: 'Open X/Twitter URL or search posts',
    usage: 'twitter <url|query>',
    run: (query) => httpUrl(query, ['x.com', 'twitter.com']) || `https://x.com/search?q=${encodeURIComponent(query)}`,
  }),
  createSocialCommand({
    name: 'vimeo',
    aliases: ['vimeovideo'],
    description: 'Open Vimeo URL or search videos',
    usage: 'vimeo <url|query>',
    run: (query) => httpUrl(query, ['vimeo.com']) || `https://vimeo.com/search?q=${encodeURIComponent(query)}`,
  }),
  createSocialCommand({
    name: 'snackvideo',
    aliases: ['snack'],
    description: 'Open SnackVideo URL or search videos',
    usage: 'snackvideo <url|query>',
    run: (query) => httpUrl(query, ['snackvideo.com']) || googleSite('snackvideo.com', query),
  }),
  createSocialCommand({
    name: 'pinvideo',
    aliases: ['pinterestvideo', 'pv'],
    description: 'Search Pinterest videos',
    usage: 'pinvideo <query>',
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
