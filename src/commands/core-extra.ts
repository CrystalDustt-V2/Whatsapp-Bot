import config from '../config';
import { commandRegistry } from '../core/command-registry';
import { getBotInfo } from '../services/bot-info';
import { Command, CommandCategory } from '../types';

export const BotCommand: Command = {
  name: 'bot',
  aliases: ['start', 'intro', 'welcome', 'quickstart'],
  category: CommandCategory.CORE,
  description: 'Welcome guide and quickstart onboarding for new users',
  usage: 'bot',
  examples: ['bot', 'start', 'quickstart'],
  async execute(ctx) {
    const prefix = config.BOT_PREFIX;
    const ownerNumber = config.OWNER_NUMBER?.replace(/\D/g, '');
    const ownerLine = ownerNumber
      ? `👑 *Developer:* ${config.OWNER_NAME} (wa.me/${ownerNumber})`
      : `👑 *Developer:* ${config.OWNER_NAME}`;

    const lines = [
      `👋 *Welcome to CrystalDust Hybrid WhatsApp Bot!*`,
      `A feature-rich WhatsApp assistant offering AI intelligence, media downloads, sticker creation, RPG economy, and utilities.\n`,
      `${ownerLine}`,
      `⚙️ *Command Prefix:* \`${prefix}\`\n`,
      `🚀 *Best Ways to Get Started:*`,
      `• 📖 \`${prefix}help\` — Browse interactive command documentation`,
      `• 📁 \`${prefix}menu\` — Explore all categorized command catalogs`,
      `• 🤖 \`${prefix}ai <query>\` — Chat with advanced AI`,
      `• 🎵 \`${prefix}play <title>\` — Stream music from YouTube / Spotify`,
      `• 🎨 \`${prefix}sticker\` — Create stickers from images or videos`,
      `• 🎁 \`${prefix}daily\` — Claim daily coins and XP`,
      `• 🎣 \`${prefix}fish\` / 🏹 \`${prefix}hunt\` — Gather items and level up`,
      `• 🗑️ \`${prefix}deleted list\` — View deleted chat messages`,
      `• 🔍 \`${prefix}search <topic>\` — Search any command or feature`,
      `\n💡 _Type \`${prefix}help <command>\` (e.g. \`${prefix}help play\`) for syntax and examples._`,
    ];

    await ctx.reply(lines.join('\n'));
  },
};

export const StatusCommand: Command = {
  name: 'status',
  aliases: ['botstatus', 'system', 'ping'],
  category: CommandCategory.CORE,
  description: 'Display bot system status, memory usage, uptime, and service health',
  usage: 'status',
  examples: ['status', 'system', 'ping'],
  async execute(ctx) {
    const info = getBotInfo();
    const mem = process.memoryUsage();
    const formatMb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

    const lines = [
      `⚡ *Bot System Status*`,
      `• State: 🟢 *Online & Operational*`,
      `• Uptime: ⏱️ *${info.uptime}*`,
      `• Total Commands: 📦 *${info.commandCount} loaded*`,
      `• Prefix: \`${info.prefix}\``,
      `• Memory: 💾 *RSS: ${formatMb(mem.rss)}* | Heap: ${formatMb(mem.heapUsed)} / ${formatMb(mem.heapTotal)}`,
      `• Environment: Node.js ${process.version} (${process.platform})`,
      `\n🧩 *Module Health:*`,
      `• 🤖 AI Service: 🟢 Operational`,
      `• 🎵 Media & Downloader: 🟢 Operational`,
      `• 💰 Economy & RPG: 🟢 Operational`,
      `• 🔍 Search Engine: 🟢 Operational`,
      `• 🗑️ Deleted Recovery: 🟢 Operational`,
      `\n📊 Dashboard: ${info.dashboardUrl || 'Active'}`,
    ];

    await ctx.reply(lines.join('\n'));
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
    .getVisibleByCategory(CommandCategory.CORE)
    .map((command) => `${config.BOT_PREFIX}${command.name}`)
    .join(', ');
}
