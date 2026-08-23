import { Command, CommandCategory } from '../types';
import { commandRegistry } from '../core/command-registry';
import config from '../config';
import { formatCommandHelp } from '../core/command-help';

export const HelpCommand: Command = {
  name: 'help',
  aliases: ['h', '?', 'quickstart', 'guide'],
  category: CommandCategory.CORE,
  description: 'Show interactive help information, command guides, and quickstart',
  usage: 'help [command|category]',
  examples: ['help', 'help ai', 'help play', 'help media'],
  async execute(ctx) {
    const rawTarget = ctx.args.join(' ').trim().toLowerCase();

    // 1. Single Command Help
    if (rawTarget) {
      const cleanTarget = rawTarget.replace(config.BOT_PREFIX, '').trim();
      const cmd = commandRegistry.get(cleanTarget);
      if (cmd) {
        await ctx.reply(formatCommandHelp(cmd));
        return;
      }

      // Check if target is a category
      const categories = Object.values(CommandCategory);
      const matchedCategory = categories.find((c) => c.toLowerCase() === cleanTarget);
      if (matchedCategory) {
        const commands = commandRegistry.getVisibleByCategory(matchedCategory);
        const lines = commands.map((c) => `• \`${config.BOT_PREFIX}${c.usage || c.name}\` - ${c.description || 'No description'}`);
        const text =
          `📁 *Category: ${matchedCategory} (${commands.length} commands)*\n\n` +
          `${lines.join('\n')}\n\n` +
          `👉 Type \`${config.BOT_PREFIX}help <command>\` for detailed documentation.`;
        await ctx.reply(text);
        return;
      }

      await ctx.reply(
        `❌ Command or category \`${rawTarget}\` not found.\n` +
        `💡 Try searching with \`${config.BOT_PREFIX}search ${cleanTarget}\` or view all categories with \`${config.BOT_PREFIX}menu\`.`
      );
      return;
    }

    // 2. Default Help & Quickstart Overview
    const categories = Object.values(CommandCategory);
    const totalCommands = commandRegistry.getVisibleAll().length;

    let text = `📖 *CrystalDust WhatsApp Bot Guide*\n`;
    text += `Welcome! Here is a quick reference to help you get started.\n\n`;

    text += `🚀 *Quickstart Commands:*\n`;
    text += `• 🤖 *AI Chat:* \`${config.BOT_PREFIX}ai <your question>\`\n`;
    text += `• 🎨 *Sticker Maker:* \`${config.BOT_PREFIX}sticker\` (send/reply image) or \`${config.BOT_PREFIX}sbrat <text>\`\n`;
    text += `• 🎵 *Music & Audio:* \`${config.BOT_PREFIX}play <song title>\` or \`${config.BOT_PREFIX}spotify <query>\`\n`;
    text += `• 🎬 *Video Download:* \`${config.BOT_PREFIX}ytvideo <title>\` or \`${config.BOT_PREFIX}tiktok <url>\`\n`;
    text += `• 👤 *Social Stalk:* \`${config.BOT_PREFIX}profile <platform> <username>\`\n`;
    text += `• 🗑️ *Undelete Messages:* \`${config.BOT_PREFIX}deleted list\`\n`;
    text += `• 🔍 *Search Commands:* \`${config.BOT_PREFIX}search <keyword>\`\n\n`;

    text += `📁 *Command Categories (${totalCommands} total):*\n`;
    for (const category of categories) {
      const count = commandRegistry.getVisibleByCategory(category).length;
      if (count > 0) {
        text += `• *${category}* (${count}) -> \`${config.BOT_PREFIX}menu ${category.toLowerCase()}\`\n`;
      }
    }

    text += `\n💡 *Tips:*\n`;
    text += `• Type \`${config.BOT_PREFIX}help <command>\` for syntax, examples & parameters.\n`;
    text += `• Type \`${config.BOT_PREFIX}menu\` to browse the full interactive menu.`;

    await ctx.reply(text);
  },
};

export default HelpCommand;

