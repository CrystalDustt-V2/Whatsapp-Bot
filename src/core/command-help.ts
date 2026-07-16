import config from '../config';
import type { Command } from '../types';

function usageParts(usage: string): string[] {
  return usage.match(/<[^>]+>|\[[^\]]+\]/g) || [];
}

function describePart(part: string): string {
  const optional = part.startsWith('[');
  const inner = part.slice(1, -1);
  const choices = inner.includes('|') ? ` Options: ${inner.split('|').join(', ')}.` : '';
  return `- ${inner}: ${optional ? 'optional' : 'required'}.${choices}`;
}

export function formatCommandHelp(command: Command): string {
  const usage = command.usage || command.name;
  const parts = usageParts(usage);
  const lines = [
    `*${config.BOT_PREFIX}${command.name}*`,
    command.description || 'No description.',
    '',
    `Usage: ${config.BOT_PREFIX}${usage}`,
    command.aliases?.length ? `Aliases: ${command.aliases.map((alias) => `${config.BOT_PREFIX}${alias}`).join(', ')}` : undefined,
    `Category: ${command.category}`,
    parts.length ? `\nOptions:\n${parts.map(describePart).join('\n')}` : undefined,
  ].filter(Boolean);

  return lines.join('\n');
}
