import { Command, CommandCategory } from '../types';
import { downloadYtDlpVideoFile, searchYtDlp } from '../services/tiktok-downloader';

type SocialVideoProvider = {
  name: string;
  aliases: string[];
  description: string;
  usage: string;
  hosts: string[];
  searchPrefix?: string;
};

const videoProviders: SocialVideoProvider[] = [
  {
    name: 'instagram',
    aliases: ['ig', 'reels', 'igvideo', 'igreel'],
    description: 'Download Instagram reel or video by URL or query',
    usage: 'instagram <url|query>',
    hosts: ['instagram.com'],
    searchPrefix: 'instagram.com/reel',
  },
  {
    name: 'facebook',
    aliases: ['fb', 'fbvideo', 'fbreels'],
    description: 'Download Facebook video or reel by URL',
    usage: 'facebook <url>',
    hosts: ['facebook.com', 'fb.watch'],
    searchPrefix: 'facebook.com/watch',
  },
  {
    name: 'twitter',
    aliases: ['x', 'tweet', 'xvideo', 'twittervideo'],
    description: 'Download X/Twitter video by post URL',
    usage: 'twitter <url>',
    hosts: ['x.com', 'twitter.com'],
  },
  {
    name: 'vimeo',
    aliases: ['vimeovideo', 'vimeodl'],
    description: 'Download Vimeo video by URL or search',
    usage: 'vimeo <url|query>',
    hosts: ['vimeo.com'],
  },
  {
    name: 'snackvideo',
    aliases: ['snack', 'snackdl'],
    description: 'Download SnackVideo by URL',
    usage: 'snackvideo <url>',
    hosts: ['snackvideo.com', 'sck.io'],
  },
  {
    name: 'pinvideo',
    aliases: ['pinterestvideo', 'pv'],
    description: 'Download Pinterest video or pin by URL',
    usage: 'pinvideo <url|query>',
    hosts: ['pinterest.com', 'pin.it'],
  },
];

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
  return new RegExp(`^[A-Za-z0-9._-]{1,${max}}$`).test(value) ? value : null;
}

async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
    });
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}

function createSocialVideoCommand(provider: SocialVideoProvider): Command {
  return {
    name: provider.name,
    aliases: provider.aliases,
    category: CommandCategory.DOWNLOADER,
    description: provider.description,
    usage: provider.usage,
    async execute(ctx) {
      const input = ctx.args.join(' ').trim();
      if (!input) {
        await ctx.reply(`Usage: .${provider.usage}`);
        return;
      }

      let targetUrl = httpUrl(input, provider.hosts);
      if (!targetUrl && /^https?:\/\//i.test(input)) {
        targetUrl = input;
      }

      if (!targetUrl) {
        try {
          await ctx.reply(`Searching and finding ${provider.name} media...`);
          const searchInput = provider.searchPrefix
            ? `ytsearch1:${provider.searchPrefix} ${input}`
            : `ytsearch1:${provider.name} ${input}`;
          const results = await searchYtDlp(searchInput, 1);
          targetUrl = results[0]?.webpageUrl || results[0]?.url || null;
        } catch {
          targetUrl = null;
        }
      }

      if (!targetUrl) {
        await ctx.reply(`Could not find a downloadable media for "${input}". Please provide a direct ${provider.name} link.`);
        return;
      }

      try {
        await ctx.reply(`Downloading ${provider.name} media...`);
        const video = await downloadYtDlpVideoFile(targetUrl);
        const lines = [
          `*${provider.name.charAt(0).toUpperCase() + provider.name.slice(1)} Video*`,
          video.info?.title ? `Title: ${video.info.title}` : undefined,
          video.info?.uploader ? `Creator: ${video.info.uploader}` : undefined,
          video.info?.duration ? `Duration: ${video.info.duration}` : undefined,
        ].filter(Boolean);

        await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
          video: video.buffer,
          mimetype: video.mimetype || 'video/mp4',
          caption: lines.join('\n'),
        });
      } catch (err) {
        // Fallback: If video extraction fails on Pinterest/Instagram, attempt OpenGraph image retrieval
        if (targetUrl && (targetUrl.includes('pinterest.com') || targetUrl.includes('pin.it') || targetUrl.includes('instagram.com'))) {
          try {
            const pageRes = await fetch(targetUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
              },
            });
            if (pageRes.ok) {
              const html = await pageRes.text();
              const ogImageMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i)
                || html.match(/content=["']([^"']+)["']\s+property=["']og:image["']/i);
              const imgUrl = ogImageMatch?.[1]?.replace(/&amp;/g, '&');
              if (imgUrl) {
                const imgBuf = await fetchImageBuffer(imgUrl);
                if (imgBuf) {
                  await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
                    image: imgBuf,
                    caption: `*${provider.name.charAt(0).toUpperCase() + provider.name.slice(1)} Media*\nLink: ${targetUrl}`,
                  });
                  return;
                }
              }
            }
          } catch {
            // Ignore fallback error
          }
        }

        await ctx.reply(`Could not download video from that ${provider.name} link. Ensure the video is public and accessible.`);
      }
    },
  };
}

export const InstagramProfileCommand: Command = {
  name: 'igprofile',
  aliases: ['instaprofile', 'igp'],
  category: CommandCategory.DOWNLOADER,
  description: 'View an Instagram profile picture and details',
  usage: 'igprofile <username>',
  async execute(ctx) {
    const username = handle(ctx.args.join(' ').trim());
    if (!username) {
      await ctx.reply('Usage: .igprofile <username>\nExample: .igprofile cristiano');
      return;
    }

    const profileUrl = `https://www.instagram.com/${username}/`;
    const defaultCaption = `*Instagram Profile*\nUsername: @${username}\nLink: ${profileUrl}`;

    try {
      const response = await fetch(profileUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      if (response.ok) {
        const html = await response.text();
        const ogImageMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i)
          || html.match(/content=["']([^"']+)["']\s+property=["']og:image["']/i);
        const ogDescMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i)
          || html.match(/content=["']([^"']+)["']\s+property=["']og:description["']/i);

        const desc = ogDescMatch ? ogDescMatch[1].replace(/&amp;/g, '&') : '';
        const captionLines = [
          `*Instagram Profile*`,
          `Username: @${username}`,
          desc ? `Stats: ${desc}` : undefined,
          `Link: ${profileUrl}`,
        ].filter(Boolean);

        const imageUrl = ogImageMatch ? ogImageMatch[1].replace(/&amp;/g, '&') : null;
        if (imageUrl) {
          const avatar = await fetchImageBuffer(imageUrl);
          if (avatar) {
            await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
              image: avatar,
              caption: captionLines.join('\n'),
            });
            return;
          }
        }

        if (desc) {
          await ctx.reply(captionLines.join('\n'));
          return;
        }
      }
    } catch {
      // Fallback
    }

    await ctx.reply(defaultCaption);
  },
};

export const TikTokProfileCommand: Command = {
  name: 'tiktokprofile',
  aliases: ['ttprofile', 'tiktokinfo'],
  category: CommandCategory.DOWNLOADER,
  description: 'View TikTok profile creator details and picture',
  usage: 'tiktokprofile <username>',
  async execute(ctx) {
    const username = handle(ctx.args.join(' ').trim(), 24);
    if (!username) {
      await ctx.reply('Usage: .tiktokprofile <username>\nExample: .tiktokprofile tiktok');
      return;
    }

    const profileUrl = `https://www.tiktok.com/@${username}`;
    try {
      const response = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(profileUrl)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      });

      if (response.ok) {
        const data = (await response.json()) as { author_name?: string; title?: string; thumbnail_url?: string };
        const lines = [
          `*TikTok Profile*`,
          `Username: @${username}`,
          data.author_name ? `Name: ${data.author_name}` : undefined,
          data.title ? `Bio / Title: ${data.title}` : undefined,
          `Link: ${profileUrl}`,
        ].filter(Boolean);

        if (data.thumbnail_url) {
          const avatar = await fetchImageBuffer(data.thumbnail_url);
          if (avatar) {
            await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
              image: avatar,
              caption: lines.join('\n'),
            });
            return;
          }
        }

        await ctx.reply(lines.join('\n'));
        return;
      }
    } catch {
      // Fallback
    }

    await ctx.reply(`*TikTok Profile*\nUsername: @${username}\nLink: ${profileUrl}`);
  },
};

export const TwitterProfileCommand: Command = {
  name: 'xprofile',
  aliases: ['twitterprofile', 'xinfo'],
  category: CommandCategory.DOWNLOADER,
  description: 'View an X/Twitter profile picture and details',
  usage: 'xprofile <username>',
  async execute(ctx) {
    const username = handle(ctx.args.join(' ').trim(), 15);
    if (!username) {
      await ctx.reply('Usage: .xprofile <username>\nExample: .xprofile elonmusk');
      return;
    }

    const profileUrl = `https://x.com/${username}`;
    const avatarUrl = `https://unavatar.io/x/${username}`;
    const caption = `*X / Twitter Profile*\nHandle: @${username}\nLink: ${profileUrl}`;

    try {
      const avatar = await fetchImageBuffer(avatarUrl);
      if (avatar) {
        await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
          image: avatar,
          caption,
        });
        return;
      }
    } catch {
      // Fallback
    }

    await ctx.reply(caption);
  },
};

export const GitHubProfileCommand: Command = {
  name: 'ghprofile',
  aliases: ['githubprofile', 'ghuser'],
  category: CommandCategory.SEARCH,
  description: 'View a GitHub user profile and avatar picture',
  usage: 'ghprofile <username>',
  async execute(ctx) {
    const username = handle(ctx.args.join(' ').trim(), 39);
    if (!username) {
      await ctx.reply('Usage: .ghprofile <username>\nExample: .ghprofile torvalds');
      return;
    }

    try {
      const response = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}`, {
        headers: {
          accept: 'application/vnd.github.v3+json',
          'user-agent': 'WhatsAppHybridBot/1.0',
        },
      });

      if (!response.ok) {
        await ctx.reply(`GitHub user "${username}" was not found.`);
        return;
      }

      const user = (await response.json()) as {
        login: string;
        name?: string;
        bio?: string;
        company?: string;
        location?: string;
        blog?: string;
        public_repos?: number;
        followers?: number;
        following?: number;
        html_url?: string;
        avatar_url?: string;
        created_at?: string;
      };

      const lines = [
        `*GitHub Profile: ${user.login}*`,
        user.name ? `Name: ${user.name}` : undefined,
        user.bio ? `Bio: ${user.bio}` : undefined,
        user.location ? `Location: ${user.location}` : undefined,
        user.company ? `Company: ${user.company}` : undefined,
        user.public_repos !== undefined ? `Public Repos: ${user.public_repos}` : undefined,
        user.followers !== undefined ? `Followers: ${user.followers} | Following: ${user.following}` : undefined,
        user.blog ? `Website: ${user.blog}` : undefined,
        `Profile: ${user.html_url || `https://github.com/${username}`}`,
      ].filter(Boolean);

      if (user.avatar_url) {
        const avatar = await fetchImageBuffer(user.avatar_url);
        if (avatar) {
          await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
            image: avatar,
            caption: lines.join('\n'),
          });
          return;
        }
      }

      await ctx.reply(lines.join('\n'));
    } catch {
      await ctx.reply(`Could not fetch GitHub profile for "${username}".`);
    }
  },
};

export const SocialCommands = [
  ...videoProviders.map(createSocialVideoCommand),
  InstagramProfileCommand,
  TikTokProfileCommand,
  TwitterProfileCommand,
  GitHubProfileCommand,
];
