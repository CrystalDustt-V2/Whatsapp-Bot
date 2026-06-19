import { Command, CommandCategory } from '../types';
import { commandRegistry } from '../core/command-registry';
import config from '../config';

export const MenuCommand: Command = {
  name: 'menu',
  aliases: ['allmenu', 'commands'],
  category: CommandCategory.CORE,
  description: 'Show complete command menu',
  usage: 'menu',
  async execute(ctx) {
    let text = '📱 *WhatsApp Hybrid Bot*\n\n';
    const categories = Object.values(CommandCategory);

    for (const category of categories) {
      const commands = commandRegistry.getByCategory(category);
      if (commands.length > 0) {
        text += `━━━ ❖ *${category}* ❖ ━━━\n`;
        for (const cmd of commands) {
          text += `• ${config.BOT_PREFIX}${cmd.name}`;
          if (cmd.description) {
            text += ` - ${cmd.description}`;
          }
          text += '\n';
        }
        text += '\n';
      }
    }

    text += `Total Commands: ${commandRegistry.getAll().length}`;

    await ctx.socket.sendMessage(
      ctx.message.key.remoteJid!,
      { text },
      { quoted: ctx.message }
    );
  },
};

export default MenuCommand;
