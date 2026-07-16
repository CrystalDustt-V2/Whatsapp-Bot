import { Command, CommandCategory } from '../types';
import { commandRegistry } from '../core/command-registry';
import config from '../config';
import { formatCommandHelp } from '../core/command-help';

export const HelpCommand: Command = {
  name: 'help',
  aliases: ['h', '?'],
  category: CommandCategory.CORE,
  description: 'Show help information',
  usage: 'help [command]',
  async execute(ctx) {
    const [cmdName] = ctx.args;

    if (cmdName) {
      const cmd = commandRegistry.get(cmdName);
      if (cmd) {
        await ctx.socket.sendMessage(
          ctx.message.key.remoteJid!,
          { text: formatCommandHelp(cmd) },
          { quoted: ctx.message }
        );
        return;
      }
    }

    let text = '📖 *WhatsApp Hybrid Bot* Help\n\n';
    const categories = Object.values(CommandCategory);

    for (const category of categories) {
      const commands = commandRegistry.getVisibleByCategory(category);
      if (commands.length > 0) {
        text += `📁 *${category}*\n`;
        text += commands.map((c) => `• ${config.BOT_PREFIX}${c.name}`).join('\n');
        text += '\n\n';
      }
    }

    text += `Use ${config.BOT_PREFIX}help <command> for detailed help`;

    await ctx.socket.sendMessage(
      ctx.message.key.remoteJid!,
      { text },
      { quoted: ctx.message }
    );
  },
};

export default HelpCommand;
