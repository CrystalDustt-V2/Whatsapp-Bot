import { searchYtDlp } from '../services/tiktok-downloader';
import { Command, CommandCategory } from '../types';
import { formatUsageError, formatFailed } from '../core/response-formatter';

type GeniusSong = {
  title: string;
  artist: string;
  url: string;
  releaseYear?: number;
  releaseDate?: string;
};

type LyricsCopyrightCheck = {
  allowed: boolean;
  reason: string;
};

const LANGUAGE_ALIASES: Record<string, string> = {
  english: 'en',
  en: 'en',
  indonesian: 'id',
  indonesia: 'id',
  indo: 'id',
  id: 'id',
  japanese: 'ja',
  japan: 'ja',
  ja: 'ja',
  korean: 'ko',
  korea: 'ko',
  ko: 'ko',
  chinese: 'zh-CN',
  mandarin: 'zh-CN',
  zh: 'zh-CN',
  spanish: 'es',
  spain: 'es',
  es: 'es',
  french: 'fr',
  fr: 'fr',
  german: 'de',
  de: 'de',
  portuguese: 'pt',
  pt: 'pt',
  russian: 'ru',
  ru: 'ru',
  arabic: 'ar',
  ar: 'ar',
  hindi: 'hi',
  hi: 'hi',
  thai: 'th',
  th: 'th',
  vietnamese: 'vi',
  vi: 'vi',
  malay: 'ms',
  melayu: 'ms',
  ms: 'ms',
};

const PUBLIC_DOMAIN_TITLE_ALLOWLIST = new Set([
  'auld lang syne',
  'amazing grace',
  'danny boy',
  'greensleeves',
  'happy birthday to you',
  'home on the range',
  'jingle bells',
  'londons burning',
  'mary had a little lamb',
  'old macdonald had a farm',
  'row row row your boat',
  'silent night',
  'the star spangled banner',
  'twinkle twinkle little star',
  'yankee doodle',
]);

const PUBLIC_DOMAIN_ARTIST_MARKERS = ['traditional', 'public domain'];

function getObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function getArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };

  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith('#x')) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    if (lower.startsWith('#')) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
    return named[lower] || match;
  });
}

function htmlToText(value: string): string {
  return decodeHtml(
    value
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 WhatsAppHybridBot/1.0' },
    });
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}

async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json,text/plain,*/*',
      'user-agent': 'Mozilla/5.0 WhatsAppHybridBot/1.0',
      ...headers,
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
}

async function fetchText(url: string, headers: Record<string, string> = {}): Promise<string> {
  const response = await fetch(url, {
    headers: {
      accept: 'text/html,text/plain,application/xhtml+xml,*/*',
      'user-agent': 'Mozilla/5.0 WhatsAppHybridBot/1.0',
      ...headers,
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

export const GoogleSearchCommand: Command = {
  name: 'google',
  aliases: ['g', 'search', 'websearch'],
  category: CommandCategory.SEARCH,
  description: 'Search the web and return top result snippets',
  usage: 'google <query>',
  async execute(ctx) {
    const query = ctx.args.join(' ').trim();
    if (!query) {
      await ctx.reply('Usage: .google <query>');
      return;
    }

    try {
      // Use DuckDuckGo HTML search for clean result snippets
      const html = await fetchText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      });

      const results: { title: string; snippet: string; url: string }[] = [];
      const blocks = html.split(/class="result__body/i).slice(1, 6);

      for (const block of blocks) {
        const titleMatch = block.match(/class="result__snippet[^>]*>([\s\S]*?)<\/a>/i) || block.match(/<a[^>]*class="result__url"[^>]*>([\s\S]*?)<\/a>/i);
        const linkMatch = block.match(/class="result__url"[^>]*href="([^"]+)"/i) || block.match(/href="([^"]+)"/i);
        const snippetMatch = block.match(/class="result__snippet[^>]*>([\s\S]*?)<\/a>/i);

        let url = linkMatch?.[1]?.trim() || '';
        if (url.includes('uddg=')) {
          try {
            const raw = new URL(`https://html.duckduckgo.com${url}`).searchParams.get('uddg');
            if (raw) url = decodeURIComponent(raw);
          } catch {
            // Keep url
          }
        }

        const title = htmlToText(titleMatch?.[1] || '').slice(0, 100);
        const snippet = htmlToText(snippetMatch?.[1] || '').slice(0, 200);

        if (title && url) {
          results.push({ title, snippet, url });
        }
      }

      if (results.length > 0) {
        const text = `*Google Search Results for "${query}"*\n\n` +
          results.map((r, i) => `${i + 1}. *${r.title}*\n${r.snippet ? `${r.snippet}\n` : ''}${r.url}`).join('\n\n');
        await ctx.reply(text);
        return;
      }
    } catch {
      // Fallback
    }

    await ctx.reply(`*Google Search:*\nhttps://www.google.com/search?q=${encodeURIComponent(query)}`);
  },
};

export const ImageSearchCommand: Command = {
  name: 'imagesearch',
  aliases: ['image', 'imgsearch', 'img'],
  category: CommandCategory.SEARCH,
  description: 'Search and send matching images',
  usage: 'imagesearch <query>',
  async execute(ctx) {
    const query = ctx.args.join(' ').trim();
    if (!query) {
      await ctx.reply('Usage: .imagesearch <query>');
      return;
    }

    try {
      await ctx.reply(`Searching image for "${query}"...`);
      // Search Wallhaven / Unsplash
      const data = getObject(await fetchJson(`https://wallhaven.cc/api/v1/search?q=${encodeURIComponent(query)}&sorting=relevance`));
      const items = getArray(data?.data);
      const first = getObject(items[0]);
      const imageUrl = getString(first?.path) || getString(first?.thumbs && getObject(first.thumbs)?.large);

      if (imageUrl) {
        const buffer = await fetchImageBuffer(imageUrl);
        if (buffer) {
          await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
            image: buffer,
            caption: `*Image Search:* ${query}\nSource: Wallhaven`,
          });
          return;
        }
      }
    } catch {
      // Fallback
    }

    // Secondary fallback: Google image search URL
    await ctx.reply(`Image search: https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`);
  },
};

export const YouTubeSearchCommand: Command = {
  name: 'ytsearch',
  aliases: ['youtubesearch', 'yts'],
  category: CommandCategory.SEARCH,
  description: 'Search YouTube and return top video results with titles and links',
  usage: 'ytsearch <query>',
  async execute(ctx) {
    const query = ctx.args.join(' ').trim();
    if (!query) {
      await ctx.reply('Usage: .ytsearch <query>');
      return;
    }

    try {
      await ctx.reply(`Searching YouTube for "${query}"...`);
      const results = await searchYtDlp(`ytsearch5:${query}`, 5);

      if (!results.length) {
        await ctx.reply(`No YouTube videos found for "${query}".`);
        return;
      }

      const lines = results.map((r, i) => {
        const title = r.title || 'Untitled';
        const uploader = r.uploader ? ` • ${r.uploader}` : '';
        const duration = r.duration ? ` [${r.duration}]` : '';
        const link = r.webpageUrl || (r.id ? `https://www.youtube.com/watch?v=${r.id}` : '');
        return `${i + 1}. *${title}*${duration}\nChannel: ${r.uploader || 'Unknown'}\n${link}`;
      });

      await ctx.reply(`*YouTube Search Results for "${query}"*\n\n${lines.join('\n\n')}`);
    } catch (err) {
      await ctx.reply(`YouTube search: https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`);
    }
  },
};

export const WikipediaCommand: Command = {
  name: 'wikipedia',
  aliases: ['wiki', 'wikisearch'],
  category: CommandCategory.SEARCH,
  description: 'Search Wikipedia and return article summary with photo',
  usage: 'wikipedia <query>',
  async execute(ctx) {
    const query = ctx.args.join(' ').trim();
    if (!query) {
      await ctx.reply('Usage: .wikipedia <topic>\nExample: .wikipedia Albert Einstein');
      return;
    }

    try {
      // First attempt: REST summary
      let summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
      let data = getObject(await fetchJson(summaryUrl).catch(() => null));

      // Second attempt: OpenSearch to resolve exact title if direct match fails
      if (!data || data.type === 'https://mediawiki.org/wiki/HyperSwitch/errors/not_found') {
        const opensearch = getArray(await fetchJson(`https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=1&format=json`));
        const matchedTitle = getString(getArray(opensearch[1])[0]);
        if (matchedTitle) {
          summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(matchedTitle)}`;
          data = getObject(await fetchJson(summaryUrl).catch(() => null));
        }
      }

      if (data && getString(data.title) && getString(data.extract)) {
        const title = getString(data.title);
        const description = getString(data.description);
        const extract = getString(data.extract);
        const pageUrl = getString(getObject(getObject(data.content_urls)?.desktop)?.page) || `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`;
        const thumbnailUrl = getString(getObject(data.thumbnail)?.source);

        const caption = [
          `*${title}*`,
          description ? `_${description}_\n` : undefined,
          extract,
          `\nRead more: ${pageUrl}`,
        ].filter(Boolean).join('\n');

        if (thumbnailUrl) {
          const thumbnailBuffer = await fetchImageBuffer(thumbnailUrl);
          if (thumbnailBuffer) {
            await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
              image: thumbnailBuffer,
              caption: caption.slice(0, 1000),
            });
            return;
          }
        }

        await ctx.reply(caption.slice(0, 3000));
        return;
      }
    } catch {
      // Fallback
    }

    await ctx.reply(`Wikipedia: https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(query)}`);
  },
};

export const GitHubSearchCommand: Command = {
  name: 'github',
  aliases: ['gh', 'ghsearch'],
  category: CommandCategory.SEARCH,
  description: 'Search GitHub repositories with stars, forks, and language',
  usage: 'github <query>',
  async execute(ctx) {
    const query = ctx.args.join(' ').trim();
    if (!query) {
      await ctx.reply('Usage: .github <repository or topic>\nExample: .github baileys');
      return;
    }

    try {
      const data = getObject(await fetchJson(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=5`, {
        accept: 'application/vnd.github.v3+json',
        'user-agent': 'WhatsAppHybridBot/1.0',
      }));

      const items = getArray(data?.items);
      if (items.length > 0) {
        const repos = items.slice(0, 5).map((item, index) => {
          const repo = getObject(item);
          const fullName = getString(repo?.full_name);
          const description = getString(repo?.description) || 'No description';
          const stars = Number(repo?.stargazers_count || 0).toLocaleString();
          const forks = Number(repo?.forks_count || 0).toLocaleString();
          const language = getString(repo?.language) || 'General';
          const url = getString(repo?.html_url);

          return `${index + 1}. *${fullName}* (⭐ ${stars} | 🍴 ${forks} | ${language})\n${description}\n${url}`;
        });

        await ctx.reply(`*GitHub Repositories for "${query}"*\n\n${repos.join('\n\n')}`);
        return;
      }
    } catch {
      // Fallback
    }

    await ctx.reply(`GitHub search: https://github.com/search?q=${encodeURIComponent(query)}`);
  },
};

type WallpaperOptions = {
  query: string;
  ratios?: string;
  atleast?: string;
  categories: string;
  orientationLabel?: string;
  resolutionLabel?: string;
  categoryLabel?: string;
};

function parseWallpaperArgs(args: string[]): WallpaperOptions {
  let ratios: string | undefined;
  let atleast: string | undefined;
  let categories = '111'; // General, Anime, People
  let orientationLabel: string | undefined;
  let resolutionLabel: string | undefined;
  let categoryLabel: string | undefined;

  const queryParts: string[] = [];

  for (const arg of args) {
    const lower = arg.toLowerCase();
    if (lower === '--portrait' || lower === '--mobile' || lower === '--phone' || lower === '--vertical') {
      ratios = '9x16,10x16,9x18';
      orientationLabel = 'Mobile / Portrait';
    } else if (lower === '--landscape' || lower === '--desktop' || lower === '--pc' || lower === '--horizontal') {
      ratios = '16x9,16x10,21x9';
      orientationLabel = 'Desktop / Landscape';
    } else if (lower === '--square') {
      ratios = '1x1';
      orientationLabel = 'Square (1:1)';
    } else if (lower === '--4k' || lower === '--uhd') {
      atleast = '3840x2160';
      resolutionLabel = '4K UHD (3840x2160+)';
    } else if (lower === '--2k' || lower === '--qhd') {
      atleast = '2560x1440';
      resolutionLabel = '2K QHD (2560x1440+)';
    } else if (lower === '--1080p' || lower === '--fhd') {
      atleast = '1920x1080';
      resolutionLabel = '1080p FHD (1920x1080+)';
    } else if (lower === '--anime') {
      categories = '010';
      categoryLabel = 'Anime';
    } else if (lower === '--general') {
      categories = '100';
      categoryLabel = 'General';
    } else if (lower === '--people') {
      categories = '001';
      categoryLabel = 'People';
    } else {
      queryParts.push(arg);
    }
  }

  return {
    query: queryParts.join(' ').trim(),
    ratios,
    atleast,
    categories,
    orientationLabel,
    resolutionLabel,
    categoryLabel,
  };
}

export const WallpaperCommand: Command = {
  name: 'wallpaper',
  aliases: ['wp', 'wallpapers'],
  category: CommandCategory.SEARCH,
  description: 'Search and download ultra-HD wallpapers with resolution, orientation, and category filters',
  usage: 'wallpaper <query> [--portrait|--landscape] [--4k|--2k|--1080p] [--anime|--general]',
  examples: [
    'wallpaper cyberpunk --portrait --4k',
    'wallpaper nature --landscape --4k',
    'wallpaper lofi room --mobile',
    'wallpaper neon city --anime --2k',
  ],
  inputs: 'Search query and optional filter flags',
  limits: 'Max 10MB image',
  async execute(ctx) {
    const parsed = parseWallpaperArgs(ctx.args);
    if (!parsed.query) {
      await ctx.reply(
        formatUsageError({
          command: 'wallpaper',
          reason: 'Wallpaper topic or search query is required.',
          examples: [
            'wallpaper cyberpunk --portrait --4k',
            'wallpaper anime aesthetic --mobile',
            'wallpaper mountain sunset --landscape',
          ],
          hint: 'Flags: --portrait / --landscape, --4k / --2k / --1080p, --anime / --general.',
        })
      );
      return;
    }

    try {
      await ctx.reply(`🖼️ Searching HD wallpaper for "${parsed.query}"...`);

      // 1. Primary Source: Wallhaven API
      const params = new URLSearchParams({
        q: parsed.query,
        categories: parsed.categories,
        purity: '100', // SFW
        sorting: 'relevance',
      });
      if (parsed.ratios) params.set('ratios', parsed.ratios);
      if (parsed.atleast) params.set('atleast', parsed.atleast);

      const data = getObject(await fetchJson(`https://wallhaven.cc/api/v1/search?${params.toString()}`));
      const items = getArray(data?.data);

      if (items.length > 0) {
        const first = getObject(items[0]);
        const imageUrl = getString(first?.path);
        const resolution = getString(first?.resolution);
        const category = getString(first?.category);
        const webUrl = getString(first?.url);

        if (imageUrl) {
          const buffer = await fetchImageBuffer(imageUrl);
          if (buffer) {
            const lines = [
              `🖼️ *HD Wallpaper: ${parsed.query}*`,
              resolution ? `📐 *Resolution:* ${resolution}${parsed.resolutionLabel ? ` (${parsed.resolutionLabel})` : ''}` : undefined,
              parsed.orientationLabel ? `📱 *Orientation:* ${parsed.orientationLabel}` : undefined,
              category ? `🏷️ *Category:* ${category}` : undefined,
              `🌐 *Source:* Wallhaven`,
              webUrl ? `🔗 *Direct Link:* ${webUrl}` : undefined,
            ].filter(Boolean);

            await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
              image: buffer,
              caption: lines.join('\n'),
            });
            return;
          }
        }
      }

      // 2. Secondary Fallback: Unsplash Source API
      const isPortrait = parsed.ratios?.includes('9x16');
      const width = parsed.atleast ? Number(parsed.atleast.split('x')[0]) : (isPortrait ? 1080 : 1920);
      const height = parsed.atleast ? Number(parsed.atleast.split('x')[1]) : (isPortrait ? 1920 : 1080);
      const unsplashData = getObject(await fetchJson(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(parsed.query)}&per_page=1&client_id=YOUR_CLIENT_ID`).catch(() => null));
      const unsplashItems = getArray(unsplashData?.results);
      if (unsplashItems.length > 0) {
        const firstUnsplash = getObject(unsplashItems[0]);
        const urls = getObject(firstUnsplash?.urls);
        const rawImg = getString(urls?.regular) || getString(urls?.full);
        if (rawImg) {
          const buffer = await fetchImageBuffer(rawImg);
          if (buffer) {
            await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
              image: buffer,
              caption: `🖼️ *Wallpaper: ${parsed.query}*\n📐 *Resolution:* ${firstUnsplash?.width}x${firstUnsplash?.height}\n🌐 *Source:* Unsplash`,
            });
            return;
          }
        }
      }
    } catch {
      // Fallback
    }

    await ctx.reply(
      formatFailed({
        title: 'Wallpaper Search',
        reason: `No wallpaper matched "${parsed.query}" with the selected filters.`,
        tryHint: `Try broader keywords or browse on https://wallhaven.cc/search?q=${encodeURIComponent(parsed.query)}`,
      })
    );
  },
};

export const PinterestCommand: Command = {
  name: 'pinterest',
  aliases: ['pin', 'pinsearch'],
  category: CommandCategory.SEARCH,
  description: 'Search Pinterest and image ideas',
  usage: 'pinterest <query>',
  async execute(ctx) {
    const query = ctx.args.join(' ').trim();
    if (!query) {
      await ctx.reply('Usage: .pinterest <query>');
      return;
    }

    try {
      const data = getObject(await fetchJson(`https://wallhaven.cc/api/v1/search?q=${encodeURIComponent(query)}&categories=111&purity=100`));
      const items = getArray(data?.data);
      const first = getObject(items[0]);
      const imageUrl = getString(first?.path) || getString(first?.thumbs && getObject(first.thumbs)?.large);

      if (imageUrl) {
        const buffer = await fetchImageBuffer(imageUrl);
        if (buffer) {
          await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
            image: buffer,
            caption: `*Pinterest Idea:* ${query}\nLink: https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`,
          });
          return;
        }
      }
    } catch {
      // Fallback
    }

    await ctx.reply(`Pinterest search: https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`);
  },
};

export const RecipeSearchCommand: Command = {
  name: 'recipe',
  aliases: ['recipes', 'resep'],
  category: CommandCategory.SEARCH,
  description: 'Search recipes with full ingredients, instructions, and photo',
  usage: 'recipe <food name>',
  async execute(ctx) {
    const query = ctx.args.join(' ').trim();
    if (!query) {
      await ctx.reply('Usage: .recipe <food name>\nExample: .recipe pasta\nExample: .recipe chicken');
      return;
    }

    try {
      const data = getObject(await fetchJson(`https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(query)}`));
      const meals = getArray(data?.meals);
      const meal = getObject(meals[0]);

      if (meal) {
        const name = getString(meal.strMeal);
        const category = getString(meal.strCategory);
        const area = getString(meal.strArea);
        const instructions = getString(meal.strInstructions);
        const thumbUrl = getString(meal.strMealThumb);

        // Collect ingredients
        const ingredients: string[] = [];
        for (let i = 1; i <= 20; i += 1) {
          const ing = getString(meal[`strIngredient${i}`])?.trim();
          const measure = getString(meal[`strMeasure${i}`])?.trim();
          if (ing) {
            ingredients.push(`- ${ing}${measure ? ` (${measure})` : ''}`);
          }
        }

        const caption = [
          `*${name}*`,
          category && area ? `Category: ${category} | Origin: ${area}` : undefined,
          `\n*Ingredients:*`,
          ingredients.slice(0, 15).join('\n'),
          `\n*Instructions:*`,
          instructions.slice(0, 500) + (instructions.length > 500 ? '...' : ''),
        ].filter(Boolean).join('\n');

        if (thumbUrl) {
          const photo = await fetchImageBuffer(thumbUrl);
          if (photo) {
            await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
              image: photo,
              caption: caption.slice(0, 1000),
            });
            return;
          }
        }

        await ctx.reply(caption.slice(0, 3000));
        return;
      }
    } catch {
      // Fallback
    }

    await ctx.reply(`Recipe search: https://www.allrecipes.com/search?q=${encodeURIComponent(query)}`);
  },
};

export const ApkSearchCommand: Command = {
  name: 'apksearch',
  aliases: ['apk', 'androidapp'],
  category: CommandCategory.SEARCH,
  description: 'Search Android APK packages and store details',
  usage: 'apksearch <app name>',
  async execute(ctx) {
    const query = ctx.args.join(' ').trim();
    if (!query) {
      await ctx.reply('Usage: .apksearch <app name>\nExample: .apksearch whatsapp');
      return;
    }

    try {
      const data = getObject(await fetchJson(`https://search.f-droid.org/api/v1/packages?q=${encodeURIComponent(query)}`));
      const packages = getArray(data?.packages);

      if (packages.length > 0) {
        const list = packages.slice(0, 4).map((p, i) => {
          const pkg = getObject(p);
          const name = getString(pkg?.name) || getString(pkg?.packageName);
          const summary = getString(pkg?.summary) || 'Android Application';
          const version = getString(pkg?.suggestedVersionName) || 'Latest';
          const pkgId = getString(pkg?.packageName);
          const link = `https://f-droid.org/packages/${pkgId}/`;
          return `${i + 1}. *${name}* (v${version})\n${summary}\n${link}`;
        });

        await ctx.reply(`*APK Search Results for "${query}"*\n\n${list.join('\n\n')}`);
        return;
      }
    } catch {
      // Fallback
    }

    await ctx.reply(`APK search:\n- APKPure: https://apkpure.com/search?q=${encodeURIComponent(query)}\n- Google Play: https://play.google.com/store/search?q=${encodeURIComponent(query)}&c=apps`);
  },
};

export const SyntaxGuideCommand: Command = {
  name: 'syntax',
  aliases: ['docs', 'devdocs', 'cheat'],
  category: CommandCategory.SEARCH,
  description: 'Look up code syntax and developer cheatsheets',
  usage: 'syntax <language/topic>',
  async execute(ctx) {
    const query = ctx.args.join(' ').trim();
    if (!query) {
      await ctx.reply('Usage: .syntax <language/topic>\nExample: .syntax javascript array\nExample: .syntax python list');
      return;
    }

    try {
      const formattedQuery = query.replace(/\s+/g, '/');
      const text = await fetchText(`https://cheat.sh/${encodeURIComponent(formattedQuery)}?T`, {
        'user-agent': 'curl/7.68.0',
      });

      const clean = stripAnsi(text).trim();
      if (clean && !clean.includes('Unknown topic') && !clean.includes('404 NOT FOUND')) {
        await ctx.reply(`*Syntax / Cheatsheet: ${query}*\n\n\`\`\`\n${clean.slice(0, 2500)}\n\`\`\``);
        return;
      }
    } catch {
      // Fallback
    }

    await ctx.reply(`Developer docs: https://devdocs.io/#q=${encodeURIComponent(query)}`);
  },
};

export const MathSolverCommand: Command = {
  name: 'mathsolver',
  aliases: ['solve', 'solvemath'],
  category: CommandCategory.SEARCH,
  description: 'Solve mathematical expressions and calculations',
  usage: 'mathsolver <expression>',
  async execute(ctx) {
    const expression = ctx.args.join(' ').trim();
    if (!expression) {
      await ctx.reply('Usage: .mathsolver <math expression>\nExample: .mathsolver 2 * (5 + 3) ^ 2\nExample: .mathsolver sqrt(144) + sin(45 deg)');
      return;
    }

    try {
      const resultText = await fetchText(`https://api.mathjs.org/v4/?expr=${encodeURIComponent(expression)}`);
      if (resultText && !resultText.toLowerCase().includes('error')) {
        await ctx.reply(`*Math Solution*\nExpression: ${expression}\nResult: *${resultText.trim()}*`);
        return;
      }
    } catch {
      // Fallback
    }

    await ctx.reply(`Math solver: https://www.wolframalpha.com/input?i=${encodeURIComponent(expression)}`);
  },
};

function firstWords(value: string, maxWords: number): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, maxWords)
    .join(' ');
}

async function searchGeniusSong(query: string): Promise<GeniusSong | null> {
  const data = getObject(await fetchJson(`https://genius.com/api/search/song?q=${encodeURIComponent(query)}`));
  const response = getObject(data?.response);
  const sections = getArray(response?.sections);

  for (const section of sections) {
    const hits = getArray(getObject(section)?.hits);
    for (const hit of hits) {
      const result = getObject(getObject(hit)?.result);
      const title = getString(result?.title);
      const artist = getString(result?.artist_names) || getString(getObject(result?.primary_artist)?.name);
      const url = getString(result?.url);
      const releaseDate = getString(result?.release_date_for_display);
      const releaseYear = Number(getObject(result?.release_date_components)?.year);
      if (title && artist && url) {
        return {
          title,
          artist,
          url,
          releaseDate: releaseDate || undefined,
          releaseYear: Number.isFinite(releaseYear) ? releaseYear : undefined,
        };
      }
    }
  }

  return null;
}

function parsePreloadedGeniusState(html: string): Record<string, unknown> | null {
  const match = html.match(/window\.__PRELOADED_STATE__\s*=\s*JSON\.parse\('([\s\S]*?)'\);/);
  if (!match) return null;

  try {
    const jsonText = JSON.parse(`"${match[1]}"`) as string;
    return getObject(JSON.parse(jsonText));
  } catch {
    return null;
  }
}

function readNestedObject(root: Record<string, unknown> | null, path: string[]): Record<string, unknown> | null {
  let current: Record<string, unknown> | null = root;
  for (const key of path) {
    current = getObject(current?.[key]);
    if (!current) return null;
  }
  return current;
}

async function fetchGeniusLyrics(url: string): Promise<string> {
  const html = await fetchText(url);
  const state = parsePreloadedGeniusState(html);
  const body = readNestedObject(state, ['songPage', 'lyricsData', 'body']);
  const lyricsHtml = getString(body?.html);
  return lyricsHtml ? htmlToText(lyricsHtml) : '';
}

function normalizeCopyrightText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function publicDomainCutoffYear(): number {
  return new Date().getUTCFullYear() - 96;
}

function looksLikePublicDomainTitle(title: string): boolean {
  const normalized = normalizeCopyrightText(title);
  return PUBLIC_DOMAIN_TITLE_ALLOWLIST.has(normalized);
}

function hasPublicDomainArtistMarker(artist: string): boolean {
  const normalized = normalizeCopyrightText(artist);
  return PUBLIC_DOMAIN_ARTIST_MARKERS.some((marker) => normalized.includes(marker));
}

function copyrightCheck(song: GeniusSong): LyricsCopyrightCheck {
  const cutoff = publicDomainCutoffYear();
  if (song.releaseYear && song.releaseYear <= cutoff) {
    return {
      allowed: true,
      reason: `release year ${song.releaseYear} is within the conservative public-domain cutoff (${cutoff} or earlier)`,
    };
  }

  if (looksLikePublicDomainTitle(song.title) && hasPublicDomainArtistMarker(song.artist)) {
    return {
      allowed: true,
      reason: 'song title and artist metadata look public-domain/traditional',
    };
  }

  return {
    allowed: false,
    reason: 'Genius metadata does not clearly mark this as public-domain/traditional',
  };
}

async function replyLongText(reply: (text: string) => Promise<void>, text: string, maxChars = 3500): Promise<void> {
  const lines = text.split('\n');
  const chunks: string[] = [];
  let current = '';

  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxChars && current) {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);
  for (const chunk of chunks) {
    await reply(chunk.slice(0, maxChars));
  }
}

function normalizeLanguage(value: string): string | null {
  const clean = value.trim().toLowerCase().replace(/[^a-z-]/g, '');
  return LANGUAGE_ALIASES[clean] || (/^[a-z]{2}(-[a-z]{2})?$/i.test(clean) ? clean : null);
}

function parseTranslateInput(input: string): { target: string; text: string } {
  const raw = input.trim();
  const arrow = raw.match(/^([\s\S]+?)\s*(?:->|=>|\|)\s*([A-Za-z- ]{2,24})$/);
  if (arrow) {
    const target = normalizeLanguage(arrow[2]);
    if (target) return { target, text: arrow[1].trim() };
  }

  const toMatch = raw.match(/^to\s+([A-Za-z-]+)\s+([\s\S]+)$/i);
  if (toMatch) {
    const target = normalizeLanguage(toMatch[1]);
    if (target) return { target, text: toMatch[2].trim() };
  }

  const firstSpace = raw.search(/\s/);
  if (firstSpace > 0) {
    const first = raw.slice(0, firstSpace);
    const target = normalizeLanguage(first);
    if (target) return { target, text: raw.slice(firstSpace).trim() };
  }

  return { target: 'en', text: raw };
}

async function translateText(text: string, target: string): Promise<{ translated: string; detected: string }> {
  const url =
    `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(target)}` +
    `&dt=t&q=${encodeURIComponent(text)}`;
  const data = getArray(await fetchJson(url));
  const segments = getArray(data[0]);
  const translated = segments
    .map((segment) => getString(getArray(segment)[0]))
    .join('')
    .trim();

  return {
    translated,
    detected: getString(data[2]) || 'auto',
  };
}

export const LyricsCommand: Command = {
  name: 'lyrics',
  aliases: ['lyric'],
  category: CommandCategory.SEARCH,
  description: 'Find Genius lyrics, with full text only for public-domain/traditional songs',
  usage: 'lyrics <song name>',
  async execute(ctx) {
    const query = (ctx.rawArgs || ctx.args.join(' ')).trim();
    if (!query) {
      await ctx.reply('Usage: .lyrics <song name>');
      return;
    }

    try {
      const song = await searchGeniusSong(query);
      if (!song) {
        await ctx.reply(`No Genius result found for "${query}".`);
        return;
      }

      const lyrics = await fetchGeniusLyrics(song.url).catch(() => '');
      const check = copyrightCheck(song);
      const releaseLine = song.releaseDate ? `Release: ${song.releaseDate}\n` : '';

      if (!check.allowed || !lyrics) {
        const preview = firstWords(lyrics, 10);
        await ctx.reply(
          `*Lyrics result*\n` +
          `Title: ${song.title}\n` +
          `Artist: ${song.artist}\n` +
          releaseLine +
          (preview ? `Preview: ${preview}...\n` : '') +
          `Full lyrics skipped: ${check.reason}.\n` +
          `Source: ${song.url}`
        );
        return;
      }

      const header =
        `*Lyrics result*\n` +
        `Title: ${song.title}\n` +
        `Artist: ${song.artist}\n` +
        releaseLine +
        `Full lyrics allowed: ${check.reason}.\n` +
        `Source: ${song.url}\n\n`;

      await replyLongText(ctx.reply, `${header}${lyrics}`);
    } catch {
      await ctx.reply('Could not fetch lyrics from Genius right now.');
    }
  },
};

export const TranslateCommand: Command = {
  name: 'translate',
  aliases: ['tr'],
  category: CommandCategory.SEARCH,
  description: 'Translate text with auto-detected source language',
  usage: 'translate <target language> <text>',
  async execute(ctx) {
    const input = (ctx.rawArgs || ctx.args.join(' ')).trim();
    if (!input) {
      await ctx.reply('Usage: .translate <target language> <text>\nExample: .translate id hello world');
      return;
    }

    const parsed = parseTranslateInput(input);
    if (!parsed.text) {
      await ctx.reply('Give me text to translate after the target language.');
      return;
    }

    try {
      const result = await translateText(parsed.text.slice(0, 4500), parsed.target);
      if (!result.translated) {
        await ctx.reply('Could not translate that text.');
        return;
      }

      await ctx.reply(
        `*Translation*\n` +
        `From: ${result.detected}\n` +
        `To: ${parsed.target}\n\n` +
        `${result.translated.slice(0, 3500)}`
      );
    } catch {
      await ctx.reply('Translation failed. Try a language code like en, id, ja, ko, or es.');
    }
  },
};

export const SearchCommands = [
  GoogleSearchCommand,
  ImageSearchCommand,
  YouTubeSearchCommand,
  WikipediaCommand,
  GitHubSearchCommand,
  WallpaperCommand,
  PinterestCommand,
  RecipeSearchCommand,
  ApkSearchCommand,
  SyntaxGuideCommand,
  MathSolverCommand,
  LyricsCommand,
  TranslateCommand,
];
