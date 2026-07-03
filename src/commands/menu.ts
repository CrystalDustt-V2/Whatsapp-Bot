import { Command, CommandCategory } from '../types';
import { commandRegistry } from '../core/command-registry';
import config from '../config';

export const MenuCommand: Command = {
  name: 'menu',
  aliases: ['allmenu', 'commands'],
  category: CommandCategory.CORE,
  description: 'Show complete command menu',
  usage: 'menu [sub-category]',
  async execute(ctx) {
    const categories = Object.values(CommandCategory);
    const totalCommands = commandRegistry.getAll().length;
    const requestedCategory = ctx.args.join(' ').trim().toLowerCase();

    if (requestedCategory) {
      const category = categories.find((value) => value.toLowerCase() === requestedCategory);

      if (!category) {
        const available = categories
          .filter((value) => commandRegistry.getByCategory(value).length > 0)
          .join(', ');

        await ctx.socket.sendMessage(
          ctx.message.key.remoteJid!,
          { text: `Unknown sub-category: ${requestedCategory}\nAvailable: ${available}` },
          { quoted: ctx.message }
        );
        return;
      }

      const commands = commandRegistry.getByCategory(category);
      let text = `📱 WhatsApp Hybrid Bot\n━━━ ❖ ${category} ❖ ━━━\n`;

      for (const cmd of commands) {
        text += `• ${config.BOT_PREFIX}${cmd.name}`;
        if (cmd.description) {
          text += ` - ${cmd.description}`;
        }
        text += '\n';
      }

      text += `\nTotal ${category} Commands: ${commands.length}\nTotal Commands: ${totalCommands}`;

      await ctx.socket.sendMessage(
        ctx.message.key.remoteJid!,
        { text },
        { quoted: ctx.message }
      );
      return;
    }

    let text = `📱 WhatsApp Hybrid Bot\nChoose a sub-category to view its commands by typing "${config.BOT_PREFIX}menu <sub-category>"\n`;

    for (const category of categories) {
      if (commandRegistry.getByCategory(category).length > 0) {
        text += `━━━ ❖ ${category} ❖ ━━━\n`;
      }
    }

    text += `Total Commands: ${totalCommands}`;

    await ctx.socket.sendMessage(
      ctx.message.key.remoteJid!,
      { text },
      { quoted: ctx.message }
    );
  },
};

export default MenuCommand;
