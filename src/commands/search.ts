import { Command, CommandCategory } from '../types';

type SearchProvider = {
  name: string;
  aliases: string[];
  description: string;
  url(query: string): string;
};

const providers: SearchProvider[] = [
  {
    name: 'google',
    aliases: ['g'],
    description: 'Search Google',
    url: (query) => `https://www.google.com/search?q=${encodeURIComponent(query)}`,
  },
  {
    name: 'imagesearch',
    aliases: ['image', 'imgsearch'],
    description: 'Search Google Images',
    url: (query) => `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`,
  },
  {
    name: 'ytsearch',
    aliases: ['youtubesearch'],
    description: 'Search YouTube',
    url: (query) => `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
  },
  {
    name: 'wikipedia',
    aliases: ['wiki'],
    description: 'Search Wikipedia',
    url: (query) => `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(query)}`,
  },
  {
    name: 'github',
    aliases: ['gh'],
    description: 'Search GitHub',
    url: (query) => `https://github.com/search?q=${encodeURIComponent(query)}`,
  },
  {
    name: 'pinterest',
    aliases: ['pin'],
    description: 'Search Pinterest',
    url: (query) => `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`,
  },
  {
    name: 'apksearch',
    aliases: ['apk'],
    description: 'Search APKPure',
    url: (query) => `https://apkpure.com/search?q=${encodeURIComponent(query)}`,
  },
  {
    name: 'recipe',
    aliases: ['recipes'],
    description: 'Search recipes',
    url: (query) => `https://www.allrecipes.com/search?q=${encodeURIComponent(query)}`,
  },
  {
    name: 'wallpaper',
    aliases: ['wp'],
    description: 'Search wallpaper images',
    url: (query) => `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(`${query} wallpaper`)}`,
  },
  {
    name: 'mathsolver',
    aliases: ['solve'],
    description: 'Open a math solver search',
    url: (query) => `https://www.wolframalpha.com/input?i=${encodeURIComponent(query)}`,
  },
  {
    name: 'syntax',
    aliases: ['docs', 'devdocs'],
    description: 'Search programming syntax docs',
    url: (query) => `https://devdocs.io/#q=${encodeURIComponent(query)}`,
  },
];

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

function createSearchCommand(provider: SearchProvider): Command {
  return {
    name: provider.name,
    aliases: provider.aliases,
    category: CommandCategory.SEARCH,
    description: provider.description,
    usage: `${provider.name} <query>`,
    async execute(ctx) {
      const query = ctx.args.join(' ').trim();
      if (!query) {
        await ctx.reply(`Usage: .${provider.name} <query>`);
        return;
      }

      await ctx.reply(`${provider.name}: ${provider.url(query)}`);
    },
  };
}

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

function firstWords(value: string, maxWords: number): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, maxWords)
    .join(' ');
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json,text/plain,*/*',
      'user-agent': 'Mozilla/5.0 WhatsAppHybridBot/1.0',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml,*/*',
      'user-agent': 'Mozilla/5.0 WhatsAppHybridBot/1.0',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
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
  ...providers.map(createSearchCommand),
  LyricsCommand,
  TranslateCommand,
];
