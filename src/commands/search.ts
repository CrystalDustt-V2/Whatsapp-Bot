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
    name: 'lyrics',
    aliases: ['lyric'],
    description: 'Search song lyrics',
    url: (query) => `https://genius.com/search?q=${encodeURIComponent(query)}`,
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
    name: 'whois',
    aliases: ['domaininfo'],
    description: 'Look up public domain registration info',
    url: (query) => `https://www.whois.com/whois/${encodeURIComponent(query)}`,
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
  {
    name: 'translate',
    aliases: ['tr'],
    description: 'Open text in Google Translate',
    url: (query) => `https://translate.google.com/?sl=auto&tl=en&text=${encodeURIComponent(query)}&op=translate`,
  },
];

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

export const SearchCommands = providers.map(createSearchCommand);
