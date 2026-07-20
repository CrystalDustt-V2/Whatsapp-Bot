import { createHash, randomUUID } from 'crypto';

import { Command, CommandCategory } from '../../types';

const CASE_MODES = ['upper', 'lower', 'title', 'sentence', 'slug', 'camel', 'snake', 'kebab'] as const;
const HASH_ALGORITHMS = ['sha256', 'sha512', 'sha1', 'md5'] as const;
const MAX_REPLY_CHARS = 3500;
const LOREM_WORDS = [
  'lorem',
  'ipsum',
  'dolor',
  'sit',
  'amet',
  'consectetur',
  'adipiscing',
  'elit',
  'sed',
  'do',
  'eiusmod',
  'tempor',
  'incididunt',
  'ut',
  'labore',
  'et',
  'dolore',
  'magna',
  'aliqua',
  'enim',
  'ad',
  'minim',
  'veniam',
  'quis',
  'nostrud',
  'exercitation',
  'ullamco',
  'laboris',
  'nisi',
  'aliquip',
  'ex',
  'ea',
  'commodo',
  'consequat',
];

const SYNTAX_SNIPPETS: Record<string, { title: string; body: string }> = {
  js: {
    title: 'JavaScript',
    body: 'const name = "Crystal";\nfunction greet(name) {\n  return `Hi, ${name}`;\n}',
  },
  javascript: {
    title: 'JavaScript',
    body: 'const name = "Crystal";\nfunction greet(name) {\n  return `Hi, ${name}`;\n}',
  },
  ts: {
    title: 'TypeScript',
    body: 'type User = { name: string };\nfunction greet(user: User): string {\n  return `Hi, ${user.name}`;\n}',
  },
  typescript: {
    title: 'TypeScript',
    body: 'type User = { name: string };\nfunction greet(user: User): string {\n  return `Hi, ${user.name}`;\n}',
  },
  py: {
    title: 'Python',
    body: 'def greet(name: str) -> str:\n    return f"Hi, {name}"',
  },
  python: {
    title: 'Python',
    body: 'def greet(name: str) -> str:\n    return f"Hi, {name}"',
  },
  sql: {
    title: 'SQL',
    body: 'SELECT id, name\nFROM users\nWHERE active = true\nORDER BY created_at DESC;',
  },
  bash: {
    title: 'Bash',
    body: 'for file in *.txt; do\n  echo "$file"\ndone',
  },
  html: {
    title: 'HTML',
    body: '<section>\n  <h1>Hello</h1>\n  <p>Welcome.</p>\n</section>',
  },
  css: {
    title: 'CSS',
    body: '.card {\n  display: grid;\n  gap: 8px;\n}',
  },
  regex: {
    title: 'Regex',
    body: '/^[a-z0-9_-]{3,32}$/i',
  },
};

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) || [];
}

function titleCase(text: string): string {
  return text.toLowerCase().replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function sentenceCase(text: string): string {
  const lower = text.toLowerCase();
  return lower.replace(/(^\s*[a-z]|[.!?]\s+[a-z])/g, (match) => match.toUpperCase());
}

function applyCase(mode: string, text: string): string | null {
  const parts = words(text);

  switch (mode) {
    case 'upper':
      return text.toUpperCase();
    case 'lower':
      return text.toLowerCase();
    case 'title':
      return titleCase(text);
    case 'sentence':
      return sentenceCase(text);
    case 'slug':
    case 'kebab':
      return parts.join('-');
    case 'snake':
      return parts.join('_');
    case 'camel':
      return parts.map((part, index) => (index === 0 ? part : part[0].toUpperCase() + part.slice(1))).join('');
    default:
      return null;
  }
}

function limitReply(text: string): string {
  return text.length > MAX_REPLY_CHARS ? `${text.slice(0, MAX_REPLY_CHARS)}\n...truncated` : text;
}

function textInput(ctx: { rawArgs?: string; args: string[] }): string {
  return (ctx.rawArgs || ctx.args.join(' ')).trim();
}

function rot13(text: string): string {
  return text.replace(/[a-z]/gi, (char) => {
    const base = char <= 'Z' ? 65 : 97;
    return String.fromCharCode(((char.charCodeAt(0) - base + 13) % 26) + base);
  });
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return char;
    }
  });
}

function unescapeHtml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, value) => {
    const lower = value.toLowerCase();
    const named: Record<string, string> = {
      amp: '&',
      lt: '<',
      gt: '>',
      quot: '"',
      apos: "'",
      nbsp: ' ',
    };

    if (named[lower]) {
      return named[lower];
    }

    const codePoint = lower.startsWith('#x') ? Number.parseInt(lower.slice(2), 16) : Number.parseInt(lower.slice(1), 10);
    if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
      return entity;
    }

    return String.fromCodePoint(codePoint);
  });
}

function clampWords(value: string | undefined): number {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed)) {
    return 30;
  }

  return Math.min(100, Math.max(5, parsed));
}

export const TextCaseCommand: Command = {
  name: 'case',
  aliases: ['textcase', 'changecase'],
  category: CommandCategory.UTILITY,
  description: 'Convert text casing',
  usage: 'case <mode> <text>',
  async execute(ctx) {
    const mode = (ctx.args[0] || '').toLowerCase();
    const text = (ctx.rawArgs || ctx.args.join(' ')).replace(/^\S+\s*/, '').trim();
    const result = applyCase(mode, text);

    if (!mode || !text || result === null) {
      await ctx.reply(`Usage: .case <mode> <text>\nModes: ${CASE_MODES.join(', ')}`);
      return;
    }

    await ctx.reply(result || '(empty)');
  },
};

export const UuidCommand: Command = {
  name: 'uuid',
  aliases: ['guid'],
  category: CommandCategory.UTILITY,
  description: 'Generate a random UUID',
  usage: 'uuid',
  async execute(ctx) {
    await ctx.reply(randomUUID());
  },
};

export const HashCommand: Command = {
  name: 'hash',
  aliases: ['sha256', 'checksum'],
  category: CommandCategory.UTILITY,
  description: 'Hash text with SHA/MD5 algorithms',
  usage: 'hash [sha256|sha512|sha1|md5] <text>',
  async execute(ctx) {
    const first = (ctx.args[0] || '').toLowerCase();
    const algorithm = HASH_ALGORITHMS.includes(first as (typeof HASH_ALGORITHMS)[number]) ? first : 'sha256';
    const text = (ctx.rawArgs || ctx.args.join(' ')).replace(algorithm === first ? /^\S+\s*/ : /^/, '').trim();

    if (!text) {
      await ctx.reply(`Usage: .hash [algorithm] <text>\nAlgorithms: ${HASH_ALGORITHMS.join(', ')}`);
      return;
    }

    await ctx.reply(`${algorithm}: ${createHash(algorithm).update(text).digest('hex')}`);
  },
};

export const JsonCommand: Command = {
  name: 'json',
  aliases: ['jsonformat', 'jsonminify'],
  category: CommandCategory.UTILITY,
  description: 'Format or minify JSON text',
  usage: 'json [format|minify] <json>',
  async execute(ctx) {
    const raw = (ctx.rawArgs || ctx.args.join(' ')).trim();
    const mode = /^(format|minify)\b/i.test(raw) ? raw.split(/\s+/, 1)[0].toLowerCase() : 'format';
    const jsonText = mode === 'format' && !/^format\b/i.test(raw) ? raw : raw.replace(/^\S+\s*/, '').trim();

    if (!jsonText) {
      await ctx.reply('Usage: .json [format|minify] <json>');
      return;
    }

    try {
      const parsed = JSON.parse(jsonText);
      await ctx.reply(limitReply(JSON.stringify(parsed, null, mode === 'minify' ? 0 : 2)));
    } catch {
      await ctx.reply('Invalid JSON.');
    }
  },
};

export const TimestampCommand: Command = {
  name: 'timestamp',
  aliases: ['ts', 'unix'],
  category: CommandCategory.UTILITY,
  description: 'Convert dates and Unix timestamps',
  usage: 'timestamp [date|unix]',
  async execute(ctx) {
    const input = (ctx.rawArgs || ctx.args.join(' ')).trim();
    const date = !input
      ? new Date()
      : /^\d{10}$/.test(input)
        ? new Date(Number(input) * 1000)
        : /^\d{13}$/.test(input)
          ? new Date(Number(input))
          : new Date(input);

    if (Number.isNaN(date.getTime())) {
      await ctx.reply('Usage: .timestamp [date|unix]\nExample: .timestamp 2026-07-08 12:00');
      return;
    }

    await ctx.reply(
      `Timestamp\n` +
        `ISO: ${date.toISOString()}\n` +
        `Unix: ${Math.floor(date.getTime() / 1000)}\n` +
        `Unix ms: ${date.getTime()}\n` +
        `Local: ${date.toString()}`
    );
  },
};

export const SortLinesCommand: Command = {
  name: 'sortlines',
  aliases: ['sorttext', 'sort'],
  category: CommandCategory.UTILITY,
  description: 'Sort text lines alphabetically',
  usage: 'sortlines <multiline text>',
  async execute(ctx) {
    const text = textInput(ctx);
    if (!text) {
      await ctx.reply('Usage: .sortlines <multiline text>');
      return;
    }

    await ctx.reply(limitReply(text.split(/\r\n|\r|\n/).sort((a, b) => a.localeCompare(b)).join('\n')));
  },
};

export const DedupeLinesCommand: Command = {
  name: 'dedupe',
  aliases: ['uniqlines', 'dedupelines'],
  category: CommandCategory.UTILITY,
  description: 'Remove duplicate text lines',
  usage: 'dedupe <multiline text>',
  async execute(ctx) {
    const text = textInput(ctx);
    if (!text) {
      await ctx.reply('Usage: .dedupe <multiline text>');
      return;
    }

    await ctx.reply(limitReply([...new Set(text.split(/\r\n|\r|\n/))].join('\n')));
  },
};

export const ExtractUrlsCommand: Command = {
  name: 'extracturls',
  aliases: ['urls', 'links'],
  category: CommandCategory.UTILITY,
  description: 'Extract URLs from text',
  usage: 'extracturls <text>',
  async execute(ctx) {
    const urls = textInput(ctx).match(/https?:\/\/[^\s<>"']+/gi) || [];
    await ctx.reply(urls.length ? limitReply(urls.join('\n')) : 'No URLs found.');
  },
};

export const Rot13Command: Command = {
  name: 'rot13',
  aliases: ['caesar13'],
  category: CommandCategory.UTILITY,
  description: 'Encode or decode ROT13 text',
  usage: 'rot13 <text>',
  async execute(ctx) {
    const text = textInput(ctx);
    if (!text) {
      await ctx.reply('Usage: .rot13 <text>');
      return;
    }

    await ctx.reply(rot13(text));
  },
};

export const HtmlEscapeCommand: Command = {
  name: 'htmlescape',
  aliases: ['escapehtml', 'htmlencode'],
  category: CommandCategory.UTILITY,
  description: 'Escape text for safe HTML display',
  usage: 'htmlescape <text>',
  async execute(ctx) {
    const text = textInput(ctx);
    if (!text) {
      await ctx.reply('Usage: .htmlescape <text>');
      return;
    }

    await ctx.reply(limitReply(escapeHtml(text)));
  },
};

export const HtmlUnescapeCommand: Command = {
  name: 'htmlunescape',
  aliases: ['unescapehtml', 'htmldecode'],
  category: CommandCategory.UTILITY,
  description: 'Decode common HTML entities back into text',
  usage: 'htmlunescape <text>',
  async execute(ctx) {
    const text = textInput(ctx);
    if (!text) {
      await ctx.reply('Usage: .htmlunescape <text>');
      return;
    }

    await ctx.reply(limitReply(unescapeHtml(text)));
  },
};

export const LoremCommand: Command = {
  name: 'lorem',
  aliases: ['placeholder', 'dummytext'],
  category: CommandCategory.UTILITY,
  description: 'Generate placeholder lorem ipsum text',
  usage: 'lorem [words]',
  async execute(ctx) {
    const count = clampWords(ctx.args[0]);
    const output = Array.from({ length: count }, (_, index) => LOREM_WORDS[index % LOREM_WORDS.length]).join(' ');
    await ctx.reply(`${output}.`);
  },
};

export const CharInfoCommand: Command = {
  name: 'charinfo',
  aliases: ['unicode', 'codepoint'],
  category: CommandCategory.UTILITY,
  description: 'Show Unicode code points and UTF-8 bytes for text',
  usage: 'charinfo <text>',
  async execute(ctx) {
    const text = textInput(ctx);
    if (!text) {
      await ctx.reply('Usage: .charinfo <text>');
      return;
    }

    const entries = Array.from(text)
      .slice(0, 12)
      .map((char, index) => {
        const codePoint = char.codePointAt(0) || 0;
        const utf8 = Buffer.from(char, 'utf8')
          .toString('hex')
          .replace(/../g, '$& ')
          .trim()
          .toUpperCase();

        return `${index + 1}. ${char} - U+${codePoint.toString(16).toUpperCase().padStart(4, '0')} (${codePoint}) - UTF-8 ${utf8}`;
      });

    const more = Array.from(text).length > 12 ? '\n...showing first 12 characters' : '';
    await ctx.reply(limitReply(`Character info\n${entries.join('\n')}${more}`));
  },
};

export const WordCountCommand: Command = {
  name: 'wordcount',
  aliases: ['wc', 'counttext'],
  category: CommandCategory.UTILITY,
  description: 'Count words, characters, and lines in text',
  usage: 'wordcount <text>',
  async execute(ctx) {
    const text = (ctx.rawArgs || ctx.args.join(' ')).trim();
    if (!text) {
      await ctx.reply('Usage: .wordcount <text>');
      return;
    }

    await ctx.reply(
      `Text count\n` +
        `Words: ${text.match(/\S+/g)?.length || 0}\n` +
        `Characters: ${Array.from(text).length}\n` +
        `Characters without spaces: ${Array.from(text.replace(/\s/g, '')).length}\n` +
        `Lines: ${text.split(/\r\n|\r|\n/).length}`
    );
  },
};

export const CodeSnippetCommand: Command = {
  name: 'codesnippet',
  aliases: ['snippet', 'codehelp', 'codesyntax'],
  category: CommandCategory.EDUCATION,
  description: 'Show quick syntax examples for common programming languages',
  usage: 'codesnippet <language>',
  async execute(ctx) {
    const key = (ctx.args[0] || '').toLowerCase();
    const entry = SYNTAX_SNIPPETS[key];

    if (!entry) {
      await ctx.reply(`Usage: .codesnippet <language>\nLanguages: ${Object.keys(SYNTAX_SNIPPETS).join(', ')}`);
      return;
    }

    await ctx.reply(`*${entry.title} syntax*\n\n${entry.body}`);
  },
};
