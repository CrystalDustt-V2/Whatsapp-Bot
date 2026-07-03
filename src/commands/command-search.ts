import config from '../config';
import { commandRegistry } from '../core/command-registry';
import type { Command } from '../types';
import { CommandCategory } from '../types';

type SearchResult = {
  command: Command;
  score: number;
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

  return Math.min(100, Math.round(average + phraseBonus));
}

function searchCommands(query: string): SearchResult[] {
  return commandRegistry
    .getAll()
    .map((command) => ({ command, score: commandScore(command, query) }))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.command.name.localeCompare(b.command.name));
}

export const CommandSearchCommand: Command = {
  name: 'search',
  aliases: ['findcmd', 'cmdsearch'],
  category: CommandCategory.CORE,
  description: 'Search bot commands by name and description',
  usage: 'search <query>',
  async execute(ctx) {
    const query = (ctx.rawArgs || ctx.args.join(' ')).trim();
    if (!query) {
      await ctx.reply('Usage: .search <query>');
      return;
    }

    const results = searchCommands(query);
    if (!results.length) {
      await ctx.reply(`No commands found for "${query}".`);
      return;
    }

    const lines = results.map(({ command, score }, index) => {
      const aliases = command.aliases?.length ? ` (${command.aliases.join(', ')})` : '';
      const description = command.description ? ` - ${command.description}` : '';
      return `${index + 1}. ${score}% ${config.BOT_PREFIX}${command.name}${aliases}${description}`;
    });

    await ctx.reply(`*Command search: ${query}*\nBest matches: ${results.length}\n\n${lines.join('\n')}`);
  },
};

export default CommandSearchCommand;
