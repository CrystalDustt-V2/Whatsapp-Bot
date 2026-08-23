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
  aliases: ['instaprofile', 'igp', 'igstalk'],
  category: CommandCategory.SEARCH,
  description: 'Fetch an Instagram user profile and avatar picture',
  usage: 'igprofile <username>',
  async execute(ctx) {
    const username = handle(ctx.args.join(' ').trim());
    if (!username) {
      await ctx.reply('Usage: .igprofile <username>\nExample: .igprofile cristiano');
      return;
    }

    const profileUrl = `https://www.instagram.com/${username}/`;
    let avatar: Buffer | null = null;
    let name: string | undefined;
    let bio: string | undefined;
    let stats: string | undefined;
    let isVerified = false;

    // 1. Try Instagram API endpoint
    try {
      const apiRes = await fetch(`https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`, {
        headers: {
          'x-ig-app-id': '936619743392459',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'application/json',
        },
      });

      if (apiRes.ok) {
        const json = (await apiRes.json()) as any;
        const user = json?.data?.user;
        if (user) {
          name = user.full_name || undefined;
          bio = user.biography || undefined;
          isVerified = Boolean(user.is_verified);
          const followers = user.edge_followed_by?.count != null ? Number(user.edge_followed_by.count).toLocaleString() : undefined;
          const following = user.edge_follow?.count != null ? Number(user.edge_follow.count).toLocaleString() : undefined;
          const posts = user.edge_owner_to_timeline_media?.count != null ? Number(user.edge_owner_to_timeline_media.count).toLocaleString() : undefined;
          if (followers || following || posts) {
            stats = `Followers: ${followers || '0'} | Following: ${following || '0'} | Posts: ${posts || '0'}`;
          }
          const picUrl = user.profile_pic_url_hd || user.profile_pic_url;
          if (picUrl) {
            avatar = await fetchImageBuffer(picUrl);
          }
        }
      }
    } catch {
      // Fallback
    }

    // 2. Try OpenGraph extraction if details missing
    if (!name && !bio && !stats) {
      try {
        const response = await fetch(profileUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        });

        if (response.ok) {
          const html = await response.text();
          const ogImageMatch =
            html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i) ||
            html.match(/content=["']([^"']+)["']\s+property=["']og:image["']/i);
          const ogDescMatch =
            html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i) ||
            html.match(/content=["']([^"']+)["']\s+property=["']og:description["']/i);
          const ogTitleMatch =
            html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) ||
            html.match(/content=["']([^"']+)["']\s+property=["']og:title["']/i);

          const desc = ogDescMatch ? ogDescMatch[1].replace(/&amp;/g, '&') : '';
          const title = ogTitleMatch ? ogTitleMatch[1].replace(/&amp;/g, '&') : '';
          if (desc) stats = desc;
          if (title && !title.toLowerCase().includes('instagram')) name = title;

          const imageUrl = ogImageMatch ? ogImageMatch[1].replace(/&amp;/g, '&') : null;
          if (imageUrl && !avatar) {
            avatar = await fetchImageBuffer(imageUrl);
          }
        }
      } catch {
        // Fallback
      }
    }

    // 3. Avatar fallback via unavatar
    if (!avatar) {
      avatar = await fetchImageBuffer(`https://unavatar.io/instagram/${username}`);
    }

    const lines = [
      `*Instagram Profile*`,
      name ? `Name: *${name}*` : undefined,
      `Username: @${username}`,
      isVerified ? `Verified: Yes ✅` : undefined,
      bio ? `Bio: ${bio}` : undefined,
      stats ? `Stats: ${stats}` : undefined,
      `Link: ${profileUrl}`,
    ].filter(Boolean);

    if (avatar) {
      await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
        image: avatar,
        caption: lines.join('\n'),
      });
      return;
    }

    await ctx.reply(lines.join('\n'));
  },
};

export const TikTokProfileCommand: Command = {
  name: 'tiktokprofile',
  aliases: ['ttprofile', 'tiktokinfo', 'ttstalk'],
  category: CommandCategory.SEARCH,
  description: 'Fetch TikTok creator profile details and avatar picture',
  usage: 'tiktokprofile <username>',
  async execute(ctx) {
    const username = handle(ctx.args.join(' ').trim(), 24);
    if (!username) {
      await ctx.reply('Usage: .tiktokprofile <username>\nExample: .tiktokprofile tiktok');
      return;
    }

    const profileUrl = `https://www.tiktok.com/@${username}`;
    let name: string | undefined;
    let bio: string | undefined;
    let avatar: Buffer | null = null;
    let stats: string | undefined;

    // 1. Try TikTok page HTML extraction
    try {
      const response = await fetch(profileUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      if (response.ok) {
        const html = await response.text();
        const jsonMatch = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[1]);
          const userDetail = parsed?.['__DEFAULT_SCOPE__']?.['webapp.user-detail']?.userInfo?.user;
          const userStats = parsed?.['__DEFAULT_SCOPE__']?.['webapp.user-detail']?.userInfo?.stats;
          if (userDetail) {
            name = userDetail.nickname || undefined;
            bio = userDetail.signature || undefined;
            const followers = userStats?.followerCount != null ? Number(userStats.followerCount).toLocaleString() : undefined;
            const following = userStats?.followingCount != null ? Number(userStats.followingCount).toLocaleString() : undefined;
            const hearts = userStats?.heartCount != null ? Number(userStats.heartCount).toLocaleString() : undefined;
            if (followers || following || hearts) {
              stats = `Followers: ${followers || '0'} | Following: ${following || '0'} | Hearts: ${hearts || '0'}`;
            }
            const picUrl = userDetail.avatarLarger || userDetail.avatarMedium || userDetail.avatarThumb;
            if (picUrl) {
              avatar = await fetchImageBuffer(picUrl);
            }
          }
        }
      }
    } catch {
      // Fallback
    }

    // 2. Try TikTok oEmbed if missing
    if (!name && !bio) {
      try {
        const oembedRes = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(profileUrl)}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 WhatsAppHybridBot/1.0' },
        });
        if (oembedRes.ok) {
          const data = (await oembedRes.json()) as { author_name?: string; title?: string; thumbnail_url?: string };
          if (data.author_name) name = data.author_name;
          if (data.title) bio = data.title;
          if (data.thumbnail_url && !avatar) {
            avatar = await fetchImageBuffer(data.thumbnail_url);
          }
        }
      } catch {
        // Fallback
      }
    }

    // 3. Avatar fallback via unavatar
    if (!avatar) {
      avatar = await fetchImageBuffer(`https://unavatar.io/tiktok/${username}`);
    }

    const lines = [
      `*TikTok Profile*`,
      name ? `Name: *${name}*` : undefined,
      `Username: @${username}`,
      bio ? `Bio: ${bio}` : undefined,
      stats ? `Stats: ${stats}` : undefined,
      `Link: ${profileUrl}`,
    ].filter(Boolean);

    if (avatar) {
      await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
        image: avatar,
        caption: lines.join('\n'),
      });
      return;
    }

    await ctx.reply(lines.join('\n'));
  },
};

export const TwitterProfileCommand: Command = {
  name: 'xprofile',
  aliases: ['twitterprofile', 'xinfo', 'xstalk', 'twitterstalk'],
  category: CommandCategory.SEARCH,
  description: 'Fetch an X/Twitter profile details and high-res avatar picture',
  usage: 'xprofile <username>',
  async execute(ctx) {
    const username = handle(ctx.args.join(' ').trim(), 15);
    if (!username) {
      await ctx.reply('Usage: .xprofile <username>\nExample: .xprofile elonmusk');
      return;
    }

    const profileUrl = `https://x.com/${username}`;
    let name: string | undefined;
    let bio: string | undefined;
    let followers: string | undefined;
    let following: string | undefined;
    let tweets: string | undefined;
    let isVerified = false;
    let joined: string | undefined;
    let avatar: Buffer | null = null;

    // 1. Try FxTwitter API
    try {
      const res = await fetch(`https://api.fxtwitter.com/${username}`, {
        headers: { 'User-Agent': 'WhatsAppHybridBot/1.0' },
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        const u = data?.user;
        if (u) {
          name = u.name;
          bio = u.description;
          if (u.followers != null) followers = Number(u.followers).toLocaleString();
          if (u.following != null) following = Number(u.following).toLocaleString();
          if (u.tweets != null) tweets = Number(u.tweets).toLocaleString();
          isVerified = Boolean(u.verification?.verified);
          if (u.joined) {
            const date = new Date(u.joined);
            joined = Number.isNaN(date.getTime()) ? u.joined : date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
          }
          const rawAvatar = u.avatar_url ? u.avatar_url.replace('_normal.', '_400x400.') : null;
          if (rawAvatar) {
            avatar = await fetchImageBuffer(rawAvatar);
          }
        }
      }
    } catch {
      // Fallback
    }

    // 2. Fallback avatar via unavatar
    if (!avatar) {
      avatar = await fetchImageBuffer(`https://unavatar.io/x/${username}`);
    }

    const lines = [
      `*X / Twitter Profile*`,
      name ? `Name: *${name}*` : undefined,
      `Handle: @${username}`,
      isVerified ? `Verified: Yes ✅` : undefined,
      bio ? `Bio: ${bio}` : undefined,
      followers || following ? `Followers: ${followers || '0'} | Following: ${following || '0'}` : undefined,
      tweets ? `Tweets: ${tweets}` : undefined,
      joined ? `Joined: ${joined}` : undefined,
      `Link: ${profileUrl}`,
    ].filter(Boolean);

    if (avatar) {
      await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
        image: avatar,
        caption: lines.join('\n'),
      });
      return;
    }

    await ctx.reply(lines.join('\n'));
  },
};

export const GitHubProfileCommand: Command = {
  name: 'ghprofile',
  aliases: ['githubprofile', 'ghuser', 'ghstalk'],
  category: CommandCategory.SEARCH,
  description: 'Fetch a GitHub user profile and avatar picture',
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

      const joined = user.created_at
        ? new Date(user.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })
        : undefined;

      const lines = [
        `*GitHub Profile: ${user.login}*`,
        user.name ? `Name: *${user.name}*` : undefined,
        user.bio ? `Bio: ${user.bio}` : undefined,
        user.location ? `Location: ${user.location}` : undefined,
        user.company ? `Company: ${user.company}` : undefined,
        user.public_repos !== undefined ? `Public Repos: ${user.public_repos}` : undefined,
        user.followers !== undefined ? `Followers: ${user.followers.toLocaleString()} | Following: ${user.following?.toLocaleString()}` : undefined,
        user.blog ? `Website: ${user.blog}` : undefined,
        joined ? `Joined: ${joined}` : undefined,
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

export const RedditProfileCommand: Command = {
  name: 'redditprofile',
  aliases: ['reddituser', 'uprofile', 'redditstalk'],
  category: CommandCategory.SEARCH,
  description: 'Fetch a Reddit user profile details and avatar',
  usage: 'redditprofile <username>',
  async execute(ctx) {
    const username = handle(ctx.args.join(' ').trim(), 30);
    if (!username) {
      await ctx.reply('Usage: .redditprofile <username>\nExample: .redditprofile spez');
      return;
    }

    const profileUrl = `https://www.reddit.com/user/${username}`;
    let name: string | undefined;
    let karma: string | undefined;
    let created: string | undefined;
    let avatar: Buffer | null = null;

    try {
      const res = await fetch(`https://www.reddit.com/user/${username}/about.json`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 WhatsAppHybridBot/1.0',
        },
      });

      if (res.ok) {
        const json = (await res.json()) as any;
        const d = json?.data;
        if (d) {
          name = d.name;
          const totalKarma = d.total_karma != null ? Number(d.total_karma).toLocaleString() : undefined;
          const linkKarma = d.link_karma != null ? Number(d.link_karma).toLocaleString() : undefined;
          const commentKarma = d.comment_karma != null ? Number(d.comment_karma).toLocaleString() : undefined;
          karma = `Total: ${totalKarma || '0'} (Post: ${linkKarma || '0'} | Comment: ${commentKarma || '0'})`;

          if (d.created_utc) {
            created = new Date(d.created_utc * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
          }

          const icon = d.icon_img?.split('?')?.[0];
          if (icon) {
            avatar = await fetchImageBuffer(icon);
          }
        }
      }
    } catch {
      // Fallback
    }

    if (!avatar) {
      avatar = await fetchImageBuffer(`https://unavatar.io/reddit/${username}`);
    }

    const lines = [
      `*Reddit Profile: u/${username}*`,
      name ? `Username: u/${name}` : undefined,
      karma ? `Karma: ${karma}` : undefined,
      created ? `Cake Day: ${created}` : undefined,
      `Link: ${profileUrl}`,
    ].filter(Boolean);

    if (avatar) {
      await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
        image: avatar,
        caption: lines.join('\n'),
      });
      return;
    }

    await ctx.reply(lines.join('\n'));
  },
};

export const YouTubeProfileCommand: Command = {
  name: 'ytprofile',
  aliases: ['youtubeprofile', 'ytchannel'],
  category: CommandCategory.SEARCH,
  description: 'Fetch YouTube channel profile and avatar',
  usage: 'ytprofile <channel/handle>',
  async execute(ctx) {
    const raw = ctx.args.join(' ').trim();
    if (!raw) {
      await ctx.reply('Usage: .ytprofile <channel name or @handle>\nExample: .ytprofile mkbhd');
      return;
    }

    const cleanHandle = raw.replace(/^@/, '');
    const channelUrl = `https://www.youtube.com/@${cleanHandle}`;

    try {
      const oembedRes = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(channelUrl)}&format=json`);
      if (oembedRes.ok) {
        const data = (await oembedRes.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
        const lines = [
          `*YouTube Channel*`,
          `Name: *${data.title || data.author_name || cleanHandle}*`,
          `Handle: @${cleanHandle}`,
          `Link: ${channelUrl}`,
        ];

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

    const avatar = await fetchImageBuffer(`https://unavatar.io/youtube/${cleanHandle}`);
    const caption = `*YouTube Channel*\nHandle: @${cleanHandle}\nLink: ${channelUrl}`;
    if (avatar) {
      await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
        image: avatar,
        caption,
      });
      return;
    }

    await ctx.reply(caption);
  },
};

export const UniversalProfileCommand: Command = {
  name: 'profile',
  aliases: ['stalk', 'fetchprofile', 'userprofile'],
  category: CommandCategory.SEARCH,
  description: 'Fetch user profile on any supported social media platform (Instagram, TikTok, Twitter/X, GitHub, Reddit, YouTube)',
  usage: 'profile <platform> <username> OR profile <profile-url>',
  async execute(ctx) {
    const raw = ctx.args.join(' ').trim();
    if (!raw) {
      await ctx.reply(
        'Usage: .profile <platform> <username> OR .profile <url>\n\n' +
        'Supported platforms:\n' +
        '- *.profile ig <username>* (Instagram)\n' +
        '- *.profile x <username>* (Twitter / X)\n' +
        '- *.profile tt <username>* (TikTok)\n' +
        '- *.profile gh <username>* (GitHub)\n' +
        '- *.profile reddit <username>* (Reddit)\n' +
        '- *.profile yt <channel>* (YouTube)\n\n' +
        'Example: .profile x elonmusk\n' +
        'Example: .profile https://instagram.com/cristiano'
      );
      return;
    }

    // Check if input is a direct URL
    try {
      if (/^https?:\/\//i.test(raw)) {
        const urlObj = new URL(raw);
        const host = urlObj.hostname.toLowerCase();
        const pathParts = urlObj.pathname.split('/').filter(Boolean);

        if (host.includes('instagram.com') && pathParts[0]) {
          ctx.args = [pathParts[0]];
          await InstagramProfileCommand.execute(ctx);
          return;
        }
        if ((host.includes('twitter.com') || host.includes('x.com')) && pathParts[0]) {
          ctx.args = [pathParts[0]];
          await TwitterProfileCommand.execute(ctx);
          return;
        }
        if (host.includes('tiktok.com') && pathParts[0]) {
          ctx.args = [pathParts[0].replace(/^@/, '')];
          await TikTokProfileCommand.execute(ctx);
          return;
        }
        if (host.includes('github.com') && pathParts[0]) {
          ctx.args = [pathParts[0]];
          await GitHubProfileCommand.execute(ctx);
          return;
        }
        if (host.includes('reddit.com') && pathParts[1] && pathParts[0] === 'user') {
          ctx.args = [pathParts[1]];
          await RedditProfileCommand.execute(ctx);
          return;
        }
        if (host.includes('youtube.com') && pathParts[0]) {
          ctx.args = [pathParts[0].replace(/^@/, '')];
          await YouTubeProfileCommand.execute(ctx);
          return;
        }
      }
    } catch {
      // Continue to argument parsing
    }

    const first = (ctx.args[0] || '').toLowerCase();
    const rest = ctx.args.slice(1).join(' ').trim();

    if (['ig', 'instagram', 'insta'].includes(first)) {
      ctx.args = [rest];
      await InstagramProfileCommand.execute(ctx);
      return;
    }

    if (['x', 'twitter', 'tweet'].includes(first)) {
      ctx.args = [rest];
      await TwitterProfileCommand.execute(ctx);
      return;
    }

    if (['tt', 'tiktok'].includes(first)) {
      ctx.args = [rest];
      await TikTokProfileCommand.execute(ctx);
      return;
    }

    if (['gh', 'github', 'git'].includes(first)) {
      ctx.args = [rest];
      await GitHubProfileCommand.execute(ctx);
      return;
    }

    if (['reddit', 'u'].includes(first)) {
      ctx.args = [rest];
      await RedditProfileCommand.execute(ctx);
      return;
    }

    if (['yt', 'youtube', 'channel'].includes(first)) {
      ctx.args = [rest];
      await YouTubeProfileCommand.execute(ctx);
      return;
    }

    // If only one argument given (e.g. .profile elonmusk), try Twitter first as default
    ctx.args = [raw];
    await TwitterProfileCommand.execute(ctx);
  },
};

export const SocialCommands = [
  ...videoProviders.map(createSocialVideoCommand),
  InstagramProfileCommand,
  TikTokProfileCommand,
  TwitterProfileCommand,
  GitHubProfileCommand,
  RedditProfileCommand,
  YouTubeProfileCommand,
  UniversalProfileCommand,
];
