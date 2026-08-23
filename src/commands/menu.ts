import config from '../config';
import { commandRegistry } from '../core/command-registry';
import { Command, CommandCategory } from '../types';

const CATEGORY_PAGE_SIZE = 20;
const ALL_PAGE_SIZE = 25;

export const MenuCommand: Command = {
  name: 'menu',
  aliases: ['allmenu', 'commands', 'cmdlist'],
  category: CommandCategory.CORE,
  description: 'Browse complete command list by category with pagination',
  usage: 'menu [category|all] [page]',
  examples: ['menu', 'menu media', 'menu utility 2', 'menu all', 'menu all 2'],
  async execute(ctx) {
    const categories = Object.values(CommandCategory);
    const totalCommands = commandRegistry.getVisibleAll().length;

    const arg0 = (ctx.args[0] || '').toLowerCase();
    const arg1 = (ctx.args[1] || '').toLowerCase();

    // 1. All Commands Paginated View: .menu all [page] or .allmenu [page]
    if (arg0 === 'all' || ctx.args.length > 0 && Number.isInteger(Number(arg0)) && !categories.some(c => c.toLowerCase() === arg0)) {
      const allCommands = commandRegistry.getVisibleAll();
      const pageStr = arg0 === 'all' ? arg1 : arg0;
      const page = Math.max(1, parseInt(pageStr, 10) || 1);
      const totalPages = Math.max(1, Math.ceil(allCommands.length / ALL_PAGE_SIZE));

      if (page > totalPages) {
        await ctx.reply(`❌ Page ${page} does not exist. Available pages: 1 to ${totalPages} (Total: ${allCommands.length} commands).`);
        return;
      }

      const startIndex = (page - 1) * ALL_PAGE_SIZE;
      const pageItems = allCommands.slice(startIndex, startIndex + ALL_PAGE_SIZE);

      const lines = pageItems.map((cmd, idx) => {
        const num = startIndex + idx + 1;
        const desc = cmd.description ? ` - ${cmd.description}` : '';
        return `${num}. \`${config.BOT_PREFIX}${cmd.usage || cmd.name}\`${desc}`;
      });

      const nextHint = page < totalPages
        ? `📖 Page ${page}/${totalPages} • Use \`${config.BOT_PREFIX}menu all ${page + 1}\` for next page\n`
        : `📖 Page ${page}/${totalPages} (End of catalog)\n`;

      const text =
        `📱 *WhatsApp Hybrid Bot - All Commands*\n` +
        `*Total Available: ${allCommands.length} Commands*\n\n` +
        `${lines.join('\n')}\n\n` +
        `${nextHint}` +
        `👉 Type \`${config.BOT_PREFIX}help <command>\` for detailed syntax & examples.`;

      await ctx.reply(text);
      return;
    }

    // 2. Specific Category View: .menu <category> [page]
    if (arg0) {
      const matchedCategory = categories.find((c) => c.toLowerCase() === arg0 || c.toLowerCase().replace(/\s+/g, '') === arg0);

      if (!matchedCategory) {
        const available = categories
          .filter((value) => commandRegistry.getVisibleByCategory(value).length > 0)
          .map((c) => `\`${c.toLowerCase()}\``)
          .join(', ');

        await ctx.reply(
          `❌ Unknown category: \`${arg0}\`\n\n` +
          `📁 *Available Categories:*\n${available}\n\n` +
          `👉 Example: \`${config.BOT_PREFIX}menu media\` or \`${config.BOT_PREFIX}menu all\``
        );
        return;
      }

      const commands = commandRegistry.getVisibleByCategory(matchedCategory);
      if (!commands.length) {
        await ctx.reply(`No active commands in category *${matchedCategory}*.`);
        return;
      }

      const page = Math.max(1, parseInt(arg1, 10) || 1);
      const totalPages = Math.max(1, Math.ceil(commands.length / CATEGORY_PAGE_SIZE));

      if (page > totalPages) {
        await ctx.reply(`❌ Page ${page} does not exist for *${matchedCategory}*. Available pages: 1 to ${totalPages}.`);
        return;
      }

      const startIndex = (page - 1) * CATEGORY_PAGE_SIZE;
      const pageItems = commands.slice(startIndex, startIndex + CATEGORY_PAGE_SIZE);

      const lines = pageItems.map((cmd) => {
        const desc = cmd.description ? ` - ${cmd.description}` : '';
        return `• \`${config.BOT_PREFIX}${cmd.usage || cmd.name}\`${desc}`;
      });

      const nextHint = page < totalPages
        ? `📖 Page ${page}/${totalPages} • Use \`${config.BOT_PREFIX}menu ${arg0} ${page + 1}\` for next page\n`
        : `📖 Page ${page}/${totalPages} (${commands.length} commands in this category)\n`;

      const text =
        `📱 *WhatsApp Hybrid Bot*\n` +
        `━━━ ❖ *${matchedCategory.toUpperCase()}* ❖ ━━━\n\n` +
        `${lines.join('\n')}\n\n` +
        `${nextHint}` +
        `👉 Type \`${config.BOT_PREFIX}help <command>\` for detailed documentation.`;

      await ctx.reply(text);
      return;
    }

    // 3. Main Category Directory Overview
    let text = `📱 *CrystalDust's WhatsApp Hybrid Bot*\n`;
    text += `Explore features by category using \`${config.BOT_PREFIX}menu <category>\`\n\n`;

    for (const category of categories) {
      const count = commandRegistry.getVisibleByCategory(category).length;
      if (count > 0) {
        text += `• *${category}* (${count} cmds) -> \`${config.BOT_PREFIX}menu ${category.toLowerCase()}\`\n`;
      }
    }

    text += `\n📊 *Statistics & Shortcuts:*\n`;
    text += `• Total Commands: *${totalCommands}*\n`;
    text += `• View Everything: \`${config.BOT_PREFIX}menu all\`\n`;
    text += `• Search Commands: \`${config.BOT_PREFIX}search <keyword>\`\n`;
    text += `• Quick Guide: \`${config.BOT_PREFIX}quickstart\`\n`;

    if (config.DONATE_TEXT) {
      text += `\n💖 *Support the Project:* ${config.DONATE_TEXT}`;
    }

    await ctx.reply(text);
  },
};

export default MenuCommand;
