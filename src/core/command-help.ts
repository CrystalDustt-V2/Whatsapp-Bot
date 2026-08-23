import config from '../config';
import type { Command } from '../types';
import { permissionName } from './response-formatter';

function usageParts(usage: string): string[] {
  return usage.match(/<[^>]+>|\[[^\]]+\]/g) || [];
}

function describePart(part: string): string {
  const optional = part.startsWith('[');
  const inner = part.slice(1, -1);
  const choices = inner.includes('|') ? ` (choices: ${inner.split('|').join(', ')})` : '';
  return `  • \`${inner}\`: ${optional ? '_optional_' : '*required*'}${choices}`;
}

export function formatCommandHelp(command: Command): string {
  const usage = command.usage || command.name;
  const parts = usageParts(usage);
  const examples = command.examples || [];

  const lines: string[] = [
    `📖 *Command Documentation: ${config.BOT_PREFIX}${command.name}*`,
    `📝 *Description:* ${command.description || 'No description provided.'}`,
    `📁 *Category:* ${command.category}`,
  ];

  if (command.aliases && command.aliases.length > 0) {
    lines.push(`🔀 *Aliases:* ${command.aliases.map((a) => `\`${config.BOT_PREFIX}${a}\``).join(', ')}`);
  }

  lines.push('');
  lines.push(`⌨️ *Syntax:* \`${config.BOT_PREFIX}${usage}\``);

  if (parts.length > 0) {
    lines.push(`⚙️ *Parameters:*`);
    for (const part of parts) {
      lines.push(describePart(part));
    }
  }

  if (examples.length > 0) {
    lines.push('');
    lines.push(`💡 *Example Usage:*`);
    for (const ex of examples) {
      const clean = ex.startsWith(config.BOT_PREFIX) ? ex : `${config.BOT_PREFIX}${ex}`;
      lines.push(`  • \`${clean}\``);
    }
  }

  if (command.inputs) {
    lines.push(`📥 *Supported Input:* ${command.inputs}`);
  }

  if (command.limits) {
    lines.push(`⚠️ *Limits & Constraints:* ${command.limits}`);
  }

  lines.push('');
  lines.push(`🛡️ *Permission:* ${permissionName(command.permissions)}`);
  lines.push(`⏳ *Cooldown:* ${command.cooldown ? `${command.cooldown} seconds` : 'None'}`);

  return lines.join('\n');
}

