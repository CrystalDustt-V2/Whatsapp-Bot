import config from '../config';
import { commandRegistry } from '../core/command-registry';
import { getBotInfo } from '../services/bot-info';
import { Command, CommandCategory } from '../types';

export const BotCommand: Command = {
  name: 'bot',
  aliases: ['start', 'intro'],
  category: CommandCategory.CORE,
  description: 'Introduce the bot and starter commands',
  usage: 'bot',
  async execute(ctx) {
    const prefix = config.BOT_PREFIX;
    const ownerNumber = config.OWNER_NUMBER?.replace(/\D/g, '');
    const ownerLine = ownerNumber
      ? `Owner: ${config.OWNER_NAME} (wa.me/${ownerNumber})`
      : `Owner: ${config.OWNER_NAME}`;

    await ctx.reply(
      `*CrystalDust V0*\n` +
      `This is a WhatsApp half-bot: a normal account with some tools attached. It can help with stickers, media edits, searches, quick utilities, and AI chat when you need it.\n\n` +
      `${ownerLine}\n\n` +
      `Good places to start:\n` +
      `${prefix}menu - shows the command categories. Try ${prefix}menu sticker or ${prefix}menu media when you want a specific section.\n` +
      `${prefix}search <query> - finds related commands by name and description, so you do not have to memorize everything.\n` +
      `${prefix}ai <message> [UNFINISHED, EXPERIMENTAL] - asks CrystalDust V0 directly. It can answer normally, and it can use bot commands when that fits.\n\n` +
      `Commands start with "${prefix}".`
    );
  },
};

export const StatusCommand: Command = {
  name: 'status',
  aliases: ['stats', 'botstatus'],
  category: CommandCategory.CORE,
  description: 'Show bot status summary',
  usage: 'status',
  async execute(ctx) {
    const info = getBotInfo();
    await ctx.reply(
      `*Bot Status*\n` +
      `Status: Online\n` +
      `Uptime: ${info.uptime}\n` +
      `Commands: ${info.commandCount}\n` +
      `Prefix: ${info.prefix}\n` +
      `Dashboard: ${info.dashboardUrl}`
    );
  },
};

export const DashboardCommand: Command = {
  name: 'dashboard',
  aliases: ['panel', 'web'],
  category: CommandCategory.CORE,
  description: 'Show dashboard URL',
  usage: 'dashboard',
  async execute(ctx) {
    await ctx.reply(`Dashboard: ${config.DASHBOARD_URL}`);
  },
};

export const OwnerCommand: Command = {
  name: 'owner',
  aliases: ['creator', 'contact'],
  category: CommandCategory.CORE,
  description: 'Show bot owner contact',
  usage: 'owner',
  async execute(ctx) {
    const ownerNumber = config.OWNER_NUMBER?.trim();
    const ownerLine = ownerNumber ? `WhatsApp: wa.me/${ownerNumber.replace(/\D/g, '')}` : 'WhatsApp: not configured';
    await ctx.reply(`*Owner*\nName: ${config.OWNER_NAME}\n${ownerLine}`);
  },
};

export const VersionCommand: Command = {
  name: 'version',
  aliases: ['ver'],
  category: CommandCategory.CORE,
  description: 'Show bot version',
  usage: 'version',
  async execute(ctx) {
    const info = getBotInfo();
    await ctx.reply(`${info.name} v${info.version}\n${info.description}`);
  },
};

export const ScriptCommand: Command = {
  name: 'script',
  aliases: ['source', 'repo'],
  category: CommandCategory.CORE,
  description: 'Show script or repository URL',
  usage: 'script',
  async execute(ctx) {
    await ctx.reply(config.SCRIPT_URL ? `Script: ${config.SCRIPT_URL}` : 'Script URL is not configured.');
  },
};

export const DonateCommand: Command = {
  name: 'donate',
  aliases: ['support'],
  category: CommandCategory.CORE,
  description: 'Show donation information',
  usage: 'donate',
  async execute(ctx) {
    await ctx.reply(config.DONATE_TEXT || 'Donation information is not configured yet.');
  },
};

export const RulesCommand: Command = {
  name: 'rules',
  aliases: ['rule'],
  category: CommandCategory.CORE,
  description: 'Show bot usage rules',
  usage: 'rules',
  async execute(ctx) {
    await ctx.reply(
      config.RULES_TEXT ||
      '*Rules*\n' +
      '1. Use commands responsibly.\n' +
      '2. Do not spam commands.\n' +
      '3. Respect group rules and other members.\n' +
      '4. Some features may take a moment to process.'
    );
  },
};

export const TosCommand: Command = {
  name: 'tos',
  aliases: ['terms'],
  category: CommandCategory.CORE,
  description: 'Show terms of service',
  usage: 'tos',
  async execute(ctx) {
    await ctx.reply(
      '*Terms of Service*\n' +
      'This bot is provided as-is. You are responsible for how you use it, including compliance with WhatsApp rules, local laws, and group policies.'
    );
  },
};

export const SpeedCommand: Command = {
  name: 'speed',
  aliases: ['latency'],
  category: CommandCategory.CORE,
  description: 'Measure command response speed',
  usage: 'speed',
  async execute(ctx) {
    const startedAt = Date.now();
    await ctx.reply(`Speed: ${Date.now() - startedAt}ms`);
  },
};

export const CoreExtraCommands = [
  BotCommand,
  StatusCommand,
  DashboardCommand,
  OwnerCommand,
  VersionCommand,
  ScriptCommand,
  DonateCommand,
  RulesCommand,
  TosCommand,
  SpeedCommand,
];

export function getCoreCommandSummary(): string {
  return commandRegistry
    .getByCategory(CommandCategory.CORE)
    .map((command) => `${config.BOT_PREFIX}${command.name}`)
    .join(', ');
}
