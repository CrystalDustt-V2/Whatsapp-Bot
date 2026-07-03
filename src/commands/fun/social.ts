import { createHash } from 'node:crypto';
import config from '../../config';
import { randomData } from '../../services/random-data';
import { Command, CommandCategory } from '../../types';

function stablePercent(input: string): number {
  const hash = createHash('sha256').update(input.toLowerCase()).digest();
  return hash[0] % 101;
}

function cleanName(value: string): string {
  return value.replace(/^@/, '').trim();
}

function normalizeName(value: string): string {
  return cleanName(value).replace(/\s+/g, ' ').toLowerCase();
}

function isPerfectMatchPair(first: string, second: string): boolean {
  const preferredFirst = config.PERFECT_MATCH_NAME_1;
  const preferredSecond = config.PERFECT_MATCH_NAME_2;

  if (!preferredFirst || !preferredSecond) {
    return false;
  }

  const actualPair = [normalizeName(first), normalizeName(second)].sort();
  const preferredPair = [normalizeName(preferredFirst), normalizeName(preferredSecond)].sort();

  return actualPair[0] === preferredPair[0] && actualPair[1] === preferredPair[1];
}

export const ShipCommand: Command = {
  name: 'ship',
  aliases: ['jodoh'],
  category: CommandCategory.FUN,
  description: 'Calculate a playful ship score',
  usage: 'ship <name1> <name2>',
  async execute(ctx) {
    const text = ctx.args.join(' ');
    const parts = text.includes('|')
      ? text.split('|').map(cleanName)
      : ctx.args.map(cleanName);

    const first = parts[0];
    const second = parts.slice(1).join(' ');

    if (!first || !second) {
      await ctx.reply('Usage: .ship <name1> <name2>\nTip: use .ship Alice | Bob for multi-word names.');
      return;
    }

    if (isPerfectMatchPair(first, second)) {
      await ctx.reply(`${first} x ${second}\nShip score: 100%\nStatus: Perfect Duo`);
      return;
    }

    const percent = stablePercent(`${first}:${second}:ship`);
    await ctx.reply(`${first} x ${second}\nShip score: ${percent}%\nStatus: ${randomData.getShipMessage()}`);
  },
};

export const CompatibilityCommand: Command = {
  name: 'compatibility',
  aliases: ['compat', 'match'],
  category: CommandCategory.FUN,
  description: 'Check playful compatibility between two names',
  usage: 'compatibility <name1> <name2>',
  async execute(ctx) {
    const text = ctx.args.join(' ');
    const parts = text.includes('|')
      ? text.split('|').map(cleanName)
      : ctx.args.map(cleanName);

    const first = parts[0];
    const second = parts.slice(1).join(' ');

    if (!first || !second) {
      await ctx.reply('Usage: .compatibility <name1> <name2>\nTip: use .compat Alice | Bob for multi-word names.');
      return;
    }

    if (isPerfectMatchPair(first, second)) {
      await ctx.reply(`${first} and ${second}: 100% compatible`);
      return;
    }

    const percent = stablePercent(`${first}:${second}:compatibility`);
    await ctx.reply(`${first} and ${second}: ${percent}% compatible`);
  },
};

export const RoastCommand: Command = {
  name: 'roast',
  aliases: ['burn'],
  category: CommandCategory.FUN,
  description: 'Get a random light roast',
  usage: 'roast [name]',
  async execute(ctx) {
    const target = ctx.args.join(' ').trim();
    await ctx.reply(`${target ? `${target}, ` : ''}${randomData.getRoast()}`);
  },
};

export const SpinWheelCommand: Command = {
  name: 'spin',
  aliases: ['wheel', 'pick'],
  category: CommandCategory.FUN,
  description: 'Pick one option from a list',
  usage: 'spin <option1> | <option2> | <option3>',
  async execute(ctx) {
    const options = ctx.args
      .join(' ')
      .split('|')
      .map((option) => option.trim())
      .filter(Boolean);

    if (options.length < 2) {
      await ctx.reply('Usage: .spin <option1> | <option2> | <option3>');
      return;
    }

    const winner = options[Math.floor(Math.random() * options.length)];
    await ctx.reply(`Wheel picked: ${winner}`);
  },
};
