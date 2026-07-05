import { Command, CommandCategory } from '../../types';

const CASE_MODES = ['upper', 'lower', 'title', 'sentence', 'slug', 'camel', 'snake', 'kebab'] as const;

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
