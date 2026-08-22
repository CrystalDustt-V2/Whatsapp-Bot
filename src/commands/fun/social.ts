import { createHash } from 'node:crypto';
import config from '../../config';
import { randomData } from '../../services/random-data';
import aiService from '../../services/ai-service';
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
  aliases: ['burn', 'insult'],
  category: CommandCategory.FUN,
  description: 'Get a funny or savage roast',
  usage: 'roast [target]',
  async execute(ctx) {
    const target = ctx.args.join(' ').trim();

    // 1. Try AI roast generation (personalized if target is provided)
    try {
      const prompt = target
        ? `Generate 1 short, witty, comedic, and savage roast aimed at "${target}". Keep it lighthearted and safe for WhatsApp chats. Return ONLY the roast.`
        : `Generate 1 short, witty, comedic roast. Keep it lighthearted and safe for WhatsApp chats. Return ONLY the roast.`;

      const aiRes = await aiService.chat(
        [
          { role: 'system', content: 'You are a stand-up comedian doing a roast session. Return only 1 short roast without preamble.' },
          { role: 'user', content: prompt },
        ],
        { maxTokens: 100, temperature: 0.9 }
      );

      const roast = aiRes.text.trim().replace(/^["']|["']$/g, '');
      if (roast && roast.length > 5) {
        await ctx.reply(`🔥 *Roast:*\n\n${roast}`);
        return;
      }
    } catch {
      // Fallback
    }

    // 2. Fallback to local dataset
    await ctx.reply(`🔥 *Roast:*\n\n${target ? `${target}, ` : ''}${randomData.getRoast()}`);
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

export const CoinFlipCommand: Command = {
  name: 'coinflip',
  aliases: ['coin', 'flip'],
  category: CommandCategory.FUN,
  description: 'Flip a coin',
  usage: 'coinflip',
  async execute(ctx) {
    await ctx.reply(`Coin: ${Math.random() < 0.5 ? 'heads' : 'tails'}`);
  },
};

export const DiceCommand: Command = {
  name: 'dice',
  aliases: ['roll'],
  category: CommandCategory.FUN,
  description: 'Roll a dice',
  usage: 'dice [sides]',
  async execute(ctx) {
    const sides = Number(ctx.args[0] || 6);
    if (!Number.isInteger(sides) || sides < 2 || sides > 1000) {
      await ctx.reply('Usage: .dice [sides]\nSides must be 2-1000.');
      return;
    }

    await ctx.reply(`Dice d${sides}: ${Math.floor(Math.random() * sides) + 1}`);
  },
};
