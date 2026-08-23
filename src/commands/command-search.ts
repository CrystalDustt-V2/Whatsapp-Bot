import config from '../config';
import { commandRegistry } from '../core/command-registry';
import type { Command } from '../types';
import { CommandCategory } from '../types';
import { formatUsageError } from '../core/response-formatter';

type SearchResult = {
  command: Command;
  score: number;
};

const SYNONYMS: Record<string, string[]> = {
  music: ['play', 'song', 'spotify', 'soundcloud', 'youtube-music', 'newgrounds', 'audio', 'stream'],
  song: ['play', 'music', 'spotify', 'soundcloud', 'youtube-music'],
  audio: ['toaudio', 'tomp3', 'nightcore', 'bassboost', 'reverb', 'echo', 'play', 'spotify', 'music'],
  video: ['ytvideo', 'tiktok', 'instagram', 'facebook', 'twitter', 'vimeo', 'snackvideo', 'pinvideo'],
  download: ['ytvideo', 'tiktok', 'instagram', 'facebook', 'twitter', 'play', 'spotify', 'download'],
  downloader: ['ytvideo', 'tiktok', 'instagram', 'facebook', 'twitter', 'play', 'spotify'],
  stalk: ['profile', 'igprofile', 'tiktokprofile', 'xprofile', 'ghprofile', 'redditprofile', 'ytprofile'],
  profile: ['profile', 'igprofile', 'tiktokprofile', 'xprofile', 'ghprofile', 'redditprofile', 'ytprofile'],
  user: ['profile', 'igprofile', 'tiktokprofile', 'xprofile', 'ghprofile'],
  recover: ['deleted'],
  delete: ['deleted'],
  deleted: ['deleted'],
  undelete: ['deleted'],
  sticker: ['sticker', 'sbrat', 'memesticker', 'quotesticker', 'circlesticker', 'roundedsticker', 'bwsticker'],
  brat: ['sbrat'],
  photo: ['sticker', 'wallpaper', 'pinterest', 'enhance', 'blur', 'sharpen', 'grayscale'],
  image: ['sticker', 'wallpaper', 'pinterest', 'enhance', 'blur', 'sharpen', 'grayscale', 'toimage'],
  wallpaper: ['wallpaper', 'pinterest'],
  rpg: ['economy', 'balance', 'hunt', 'fish', 'mine', 'farm', 'upgrade', 'quests', 'stats', 'inventory', 'shop', 'boss', 'pet', 'clan'],
  game: ['economy', 'balance', 'hunt', 'fish', 'mine', 'farm', 'upgrade', 'quests', 'stats', 'inventory', 'gamble', 'rob', 'boss'],
  money: ['balance', 'wallet', 'bank', 'daily', 'transfer', 'shop', 'sell', 'economy'],
  coins: ['balance', 'wallet', 'bank', 'daily', 'transfer', 'shop', 'sell', 'economy'],
  quest: ['quests', 'tasks', 'dailyquests'],
  cooldown: ['cooldowns', 'cd', 'timers'],
  ai: ['ai', 'ask', 'gpt', 'gemini', 'chat'],
};

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function stem(value: string): string {
  return value.length > 3 && value.endsWith('s') ? value.slice(0, -1) : value;
}

function tokenMatches(values: string[], query: string): boolean {
  const queryStem = stem(query);
  return values.some((value) => value === query || stem(value) === queryStem);
}

function partialMatches(values: string[], query: string): boolean {
  if (query.length < 2) return false;
  return values.some((value) => value.includes(query) || query.includes(value));
}

function commandScore(command: Command, query: string): number {
  const queryTokens = tokens(query);
  if (!queryTokens.length) return 0;

  const titleText = [command.name, ...(command.aliases || []), command.usage || ''].join(' ');
  const descriptionText = command.description || '';
  const titleTokens = tokens(titleText);
  const descriptionTokens = tokens(descriptionText);
  const normalizedTitle = titleTokens.join(' ');
  const normalizedDescription = descriptionTokens.join(' ');
  const normalizedQuery = queryTokens.join(' ');

  let synonymBonus = 0;
  for (const token of queryTokens) {
    const list = SYNONYMS[token];
    if (list && (list.includes(command.name) || command.aliases?.some((a) => list.includes(a)))) {
      synonymBonus += 85;
    }
  }

  const scores: number[] = queryTokens.map((token) => {
    if (tokenMatches(titleTokens, token)) return 100;
    if (tokenMatches(descriptionTokens, token)) return 85;
    if (partialMatches(titleTokens, token)) return 70;
    if (partialMatches(descriptionTokens, token)) return 55;
    return 0;
  });

  const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const phraseBonus = normalizedTitle.includes(normalizedQuery)
    ? 10
    : normalizedDescription.includes(normalizedQuery)
      ? 6
      : 0;

  return Math.min(100, Math.round(average + phraseBonus + synonymBonus));
}

function searchCommands(query: string): SearchResult[] {
  return commandRegistry
    .getVisibleAll()
    .map((command) => ({ command, score: commandScore(command, query) }))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.command.name.localeCompare(b.command.name));
}

export const CommandSearchCommand: Command = {
  name: 'search',
  aliases: ['findcmd', 'cmdsearch', 'searchcmd'],
  category: CommandCategory.CORE,
  description: 'Search bot commands by keyword, topic, aliases, and description',
  usage: 'search <query>',
  examples: ['search music', 'search sticker', 'search deleted', 'search rpg', 'search video'],
  inputs: 'Keyword, topic, or command feature',
  async execute(ctx) {
    const query = (ctx.rawArgs || ctx.args.join(' ')).trim();
    if (!query) {
      await ctx.reply(
        formatUsageError({
          command: 'search',
          reason: 'Search keyword or query is required.',
          examples: ['search music', 'search download', 'search economy', 'search sticker'],
          hint: 'Searches across command names, aliases, and functionality descriptions.',
        })
      );
      return;
    }

    const results = searchCommands(query);
    if (!results.length) {
      await ctx.reply(
        `🔍 *No matching commands found for "${query}"*\n\n💡 Try broader keywords (e.g. \`music\`, \`video\`, \`sticker\`, \`game\`) or browse the full menu with \`${config.BOT_PREFIX}menu\`.`
      );
      return;
    }

    const topResults = results.slice(0, 10);
    const lines = topResults.map(({ command, score }, index) => {
      const aliases = command.aliases?.length ? ` (${command.aliases.slice(0, 3).map((a) => `.${a}`).join(', ')})` : '';
      const description = command.description ? `\n   _${command.description}_` : '';
      return `${index + 1}. \`${config.BOT_PREFIX}${command.name}\`${aliases}${description}`;
    });

    const moreHint = results.length > 10 ? `\n\n_...and ${results.length - 10} more matches. View categories with ${config.BOT_PREFIX}menu._` : '';

    await ctx.reply(
      `🔍 *Command Search Results for "${query}"*\n` +
      `Found ${results.length} matching commands:\n\n` +
      `${lines.join('\n\n')}${moreHint}\n\n` +
      `👉 Type \`${config.BOT_PREFIX}help <command>\` for full documentation.`
    );
  },
};

export default CommandSearchCommand;
