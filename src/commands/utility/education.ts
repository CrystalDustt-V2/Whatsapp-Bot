import { lookupDictionary } from '../../services/dictionary';
import { findElement } from '../../services/periodic-table';
import { Command, CommandCategory } from '../../types';

type FormulaEntry = {
  key: string;
  aliases: string[];
  category: 'math' | 'physics';
  title: string;
  formula: string;
  note: string;
};

type CurrencyRateResponse = {
  base?: string;
  quote?: string;
  date?: string;
  rate?: number;
  message?: string;
};

const FORMULAS: FormulaEntry[] = [
  {
    key: 'circle',
    aliases: ['lingkaran', 'area circle'],
    category: 'math',
    title: 'Circle',
    formula: 'Area = pi * r^2 | Circumference = 2 * pi * r',
    note: 'r = radius',
  },
  {
    key: 'triangle',
    aliases: ['segitiga'],
    category: 'math',
    title: 'Triangle',
    formula: 'Area = 1/2 * base * height',
    note: 'For right triangles: a^2 + b^2 = c^2',
  },
  {
    key: 'rectangle',
    aliases: ['persegi panjang'],
    category: 'math',
    title: 'Rectangle',
    formula: 'Area = length * width | Perimeter = 2 * (length + width)',
    note: 'Use the same unit for length and width.',
  },
  {
    key: 'pythagorean',
    aliases: ['pythagoras', 'right triangle'],
    category: 'math',
    title: 'Pythagorean theorem',
    formula: 'a^2 + b^2 = c^2',
    note: 'c is the hypotenuse.',
  },
  {
    key: 'speed',
    aliases: ['velocity', 'kecepatan'],
    category: 'physics',
    title: 'Speed',
    formula: 'v = s / t',
    note: 'v = speed, s = distance, t = time',
  },
  {
    key: 'force',
    aliases: ['newton', 'gaya'],
    category: 'physics',
    title: 'Force',
    formula: 'F = m * a',
    note: 'F = force, m = mass, a = acceleration',
  },
  {
    key: 'density',
    aliases: ['massa jenis'],
    category: 'physics',
    title: 'Density',
    formula: 'rho = m / V',
    note: 'rho = density, m = mass, V = volume',
  },
  {
    key: 'pressure',
    aliases: ['tekanan'],
    category: 'physics',
    title: 'Pressure',
    formula: 'P = F / A',
    note: 'P = pressure, F = force, A = area',
  },
  {
    key: 'ohm',
    aliases: ['voltage', 'current', 'resistance'],
    category: 'physics',
    title: "Ohm's law",
    formula: 'V = I * R',
    note: 'V = voltage, I = current, R = resistance',
  },
  {
    key: 'power',
    aliases: ['daya'],
    category: 'physics',
    title: 'Power',
    formula: 'P = W / t | P = V * I',
    note: 'W = work, t = time, V = voltage, I = current',
  },
  {
    key: 'kinetic',
    aliases: ['kinetic energy', 'energi kinetik'],
    category: 'physics',
    title: 'Kinetic energy',
    formula: 'Ek = 1/2 * m * v^2',
    note: 'm = mass, v = speed',
  },
  {
    key: 'potential',
    aliases: ['potential energy', 'energi potensial'],
    category: 'physics',
    title: 'Potential energy',
    formula: 'Ep = m * g * h',
    note: 'm = mass, g = gravity, h = height',
  },
];

function normalizeQuery(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function formulaTopics(category?: FormulaEntry['category']): string {
  return FORMULAS.filter((entry) => !category || entry.category === category)
    .map((entry) => entry.key)
    .join(', ');
}

function findFormula(query: string, category?: FormulaEntry['category']): FormulaEntry | undefined {
  const normalized = normalizeQuery(query);
  return FORMULAS.filter((entry) => !category || entry.category === category).find((entry) => {
    const terms = [entry.key, entry.title, ...entry.aliases].map(normalizeQuery);
    return terms.some((term) => term === normalized || term.includes(normalized) || normalized.includes(term));
  });
}

function formatFormula(entry: FormulaEntry): string {
  return `*${entry.title}*\nFormula: ${entry.formula}\nNote: ${entry.note}`;
}

function isCurrencyCode(value: string | undefined): value is string {
  return /^[A-Za-z]{3}$/.test(value || '');
}

function parseCurrencyArgs(args: string[]): { amount: number; base: string; quote: string } | null {
  if (args.length === 2 && isCurrencyCode(args[0]) && isCurrencyCode(args[1])) {
    return { amount: 1, base: args[0].toUpperCase(), quote: args[1].toUpperCase() };
  }

  if (args.length < 3 || !isCurrencyCode(args[1]) || !isCurrencyCode(args[2])) {
    return null;
  }

  const amount = Number(args[0].replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000_000) {
    return null;
  }

  return { amount, base: args[1].toUpperCase(), quote: args[2].toUpperCase() };
}

function formatCurrency(value: number, code: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 4,
    }).format(value);
  } catch {
    return `${Number(value.toPrecision(12)).toString()} ${code}`;
  }
}

async function getCurrencyRate(base: string, quote: string): Promise<CurrencyRateResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`https://api.frankfurter.dev/v2/rate/${base}/${quote}`, {
      signal: controller.signal,
    });
    const body = (await response.json()) as CurrencyRateResponse;

    if (!response.ok || typeof body.rate !== 'number') {
      throw new Error(body.message || 'Currency rate lookup failed');
    }

    return body;
  } finally {
    clearTimeout(timeout);
  }
}

export const DictionaryCommand: Command = {
  name: 'dictionary',
  aliases: ['dict', 'define'],
  category: CommandCategory.EDUCATION,
  description: 'Look up an English word definition',
  usage: 'dictionary <word>',
  async execute(ctx) {
    const word = ctx.args[0];
    if (!word) {
      await ctx.reply('Usage: .dictionary <word>');
      return;
    }

    const entry = await lookupDictionary(word);
    if (!entry) {
      await ctx.reply(`No definition found for "${word}".`);
      return;
    }

    const lines = [
      `*${entry.word}*${entry.phonetic ? ` (${entry.phonetic})` : ''}`,
      entry.partOfSpeech ? `Part of speech: ${entry.partOfSpeech}` : undefined,
      `Definition: ${entry.definition}`,
      entry.example ? `Example: ${entry.example}` : undefined,
      `Source: ${entry.source}`,
    ].filter(Boolean);

    await ctx.reply(lines.join('\n'));
  },
};

export const FormulaCommand: Command = {
  name: 'formula',
  aliases: ['formulas', 'rumus'],
  category: CommandCategory.EDUCATION,
  description: 'Look up common math and physics formulas',
  usage: 'formula <topic>',
  async execute(ctx) {
    const query = ctx.args.join(' ').trim();
    if (!query) {
      await ctx.reply(`Usage: .formula <topic>\nTopics: ${formulaTopics()}`);
      return;
    }

    const entry = findFormula(query);
    if (!entry) {
      await ctx.reply(`Formula not found: ${query}\nTopics: ${formulaTopics()}`);
      return;
    }

    await ctx.reply(formatFormula(entry));
  },
};

export const PhysicsCommand: Command = {
  name: 'physics',
  aliases: ['fisika'],
  category: CommandCategory.EDUCATION,
  description: 'Look up common physics formulas',
  usage: 'physics <topic>',
  async execute(ctx) {
    const query = ctx.args.join(' ').trim();
    if (!query) {
      await ctx.reply(`Usage: .physics <topic>\nTopics: ${formulaTopics('physics')}`);
      return;
    }

    const entry = findFormula(query, 'physics');
    if (!entry) {
      await ctx.reply(`Physics formula not found: ${query}\nTopics: ${formulaTopics('physics')}`);
      return;
    }

    await ctx.reply(formatFormula(entry));
  },
};

export const CurrencyCommand: Command = {
  name: 'currency',
  aliases: ['fx', 'forex', 'convertcurrency'],
  category: CommandCategory.EDUCATION,
  description: 'Convert currency with latest exchange rates',
  usage: 'currency [amount] <from> <to>',
  async execute(ctx) {
    const parsed = parseCurrencyArgs(ctx.args);
    if (!parsed) {
      await ctx.reply('Usage: .currency [amount] <from> <to>\nExample: .currency 10 USD IDR\nExample: .currency EUR JPY');
      return;
    }

    if (parsed.base === parsed.quote) {
      await ctx.reply(`${formatCurrency(parsed.amount, parsed.base)} = ${formatCurrency(parsed.amount, parsed.quote)}`);
      return;
    }

    try {
      const result = await getCurrencyRate(parsed.base, parsed.quote);
      const rate = result.rate || 0;
      const converted = parsed.amount * rate;

      await ctx.reply(
        `Currency conversion\n` +
          `${formatCurrency(parsed.amount, parsed.base)} = ${formatCurrency(converted, parsed.quote)}\n` +
          `Rate: 1 ${parsed.base} = ${Number(rate.toPrecision(8)).toString()} ${parsed.quote}\n` +
          `Date: ${result.date || 'latest'}\n` +
          `Source: Frankfurter`
      );
    } catch {
      await ctx.reply(`Could not convert ${parsed.base} to ${parsed.quote}.`);
    }
  },
};

export const ElementCommand: Command = {
  name: 'element',
  aliases: ['periodic', 'chem'],
  category: CommandCategory.EDUCATION,
  description: 'Look up common periodic table elements',
  usage: 'element <symbol|name|atomic number>',
  async execute(ctx) {
    const query = ctx.args.join(' ').trim();
    if (!query) {
      await ctx.reply('Usage: .element <symbol|name|atomic number>');
      return;
    }

    const element = findElement(query);
    if (!element) {
      await ctx.reply(`Element not found: ${query}`);
      return;
    }

    await ctx.reply(
      `*${element.name} (${element.symbol})*\n` +
        `Atomic number: ${element.atomicNumber}\n` +
        `Atomic mass: ${element.atomicMass}\n` +
        `Category: ${element.category}`
    );
  },
};
