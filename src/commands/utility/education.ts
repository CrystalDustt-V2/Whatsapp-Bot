import { lookupDictionary } from '../../services/dictionary';
import { findElement } from '../../services/periodic-table';
import { Command, CommandCategory } from '../../types';

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
