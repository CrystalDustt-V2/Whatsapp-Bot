import config from '../config';
import type { Command } from '../types';
import { PermissionLevel } from '../types';

export function permissionName(level?: PermissionLevel): string {
  switch (level) {
    case PermissionLevel.GROUP_ADMIN:
      return 'Group Admin';
    case PermissionLevel.BOT_ADMIN:
      return 'Bot Admin';
    case PermissionLevel.OWNER:
      return 'Bot Owner';
    case PermissionLevel.USER:
    default:
      return 'Everyone';
  }
}

export interface UsageErrorOptions {
  command: Command | string;
  reason?: string;
  customUsage?: string;
  examples?: string[];
  hint?: string;
}

export function formatUsageError(options: UsageErrorOptions): string {
  const cmdName = typeof options.command === 'string' ? options.command : options.command.name;
  const usage =
    options.customUsage ||
    (typeof options.command === 'object' && options.command.usage ? options.command.usage : `${cmdName} <arguments>`);
  const examples =
    options.examples ||
    (typeof options.command === 'object' && options.command.examples ? options.command.examples : []);

  const lines: string[] = [
    `❌ *Invalid Command Format*`,
    `⌨️ *Usage:* \`${config.BOT_PREFIX}${usage}\``,
  ];

  if (options.reason) {
    lines.push(`⚠️ *Reason:* ${options.reason}`);
  }

  if (examples.length > 0) {
    lines.push(`💡 *Example${examples.length > 1 ? 's' : ''}:*`);
    for (const ex of examples) {
      const cleanEx = ex.startsWith(config.BOT_PREFIX) ? ex : `${config.BOT_PREFIX}${ex}`;
      lines.push(`  • \`${cleanEx}\``);
    }
  }

  if (options.hint) {
    lines.push(`ℹ️ *Hint:* ${options.hint}`);
  }

  lines.push(`\n👉 For full details, type \`${config.BOT_PREFIX}help ${cmdName}\``);

  return lines.join('\n');
}

export interface FailedOptions {
  title: string;
  reason: string;
  tryHint?: string;
}

export function formatFailed(options: FailedOptions): string {
  const lines: string[] = [
    `❌ *Action Failed: ${options.title}*`,
    `• *Reason:* ${options.reason}`,
  ];

  if (options.tryHint) {
    lines.push(`• *Try:* ${options.tryHint}`);
  }

  return lines.join('\n');
}

export interface SuccessOptions {
  title: string;
  fields?: Record<string, string | number | boolean | null | undefined>;
  footer?: string;
}

export function formatSuccess(options: SuccessOptions): string {
  const lines: string[] = [`✅ *${options.title}*`];

  if (options.fields) {
    for (const [key, value] of Object.entries(options.fields)) {
      if (value !== undefined && value !== null && value !== '') {
        lines.push(`• *${key}:* ${value}`);
      }
    }
  }

  if (options.footer) {
    lines.push(`\n${options.footer}`);
  }

  return lines.join('\n');
}
