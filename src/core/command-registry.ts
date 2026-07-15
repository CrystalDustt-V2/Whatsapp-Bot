import type { Command, CommandMetadata, CommandCategory } from '../types';
import logger from './logger';

export class CommandRegistry {
  private commands: Map<string, Command> = new Map();
  private aliases: Map<string, Command> = new Map();
  private order: string[] = [];

  register(command: Command): void {
    const name = command.name.toLowerCase();
    const normalizedCommand = {
      ...command,
      name,
      aliases: command.aliases?.map((alias) => alias.toLowerCase()),
    };

    if (!this.commands.has(name)) {
      this.order.push(name);
    }

    this.commands.set(name, normalizedCommand);
    logger.info(`Registered command: ${command.name}`);

    if (normalizedCommand.aliases) {
      for (const alias of normalizedCommand.aliases) {
        this.aliases.set(alias, normalizedCommand);
        logger.debug(`Registered alias: ${alias} -> ${name}`);
      }
    }
  }

  get(name: string): Command | undefined {
    const normalizedName = name.toLowerCase();
    return this.commands.get(normalizedName) || this.aliases.get(normalizedName);
  }

  getAll(): Command[] {
    return this.order
      .map((name) => this.commands.get(name))
      .filter((command): command is Command => Boolean(command));
  }

  getVisibleAll(): Command[] {
    return this.getAll().filter((cmd) => !cmd.hidden);
  }

  getByCategory(category: CommandCategory): Command[] {
    return this.getAll().filter((cmd) => cmd.category === category);
  }

  getVisibleByCategory(category: CommandCategory): Command[] {
    return this.getVisibleAll().filter((cmd) => cmd.category === category);
  }
}

export const commandRegistry = new CommandRegistry();

export default commandRegistry;
