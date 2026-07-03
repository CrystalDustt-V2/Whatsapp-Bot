import type { WASocket, WAMessage } from '@whiskeysockets/baileys';

export interface BotContext {
  socket: WASocket;
  message: WAMessage;
  args: string[];
  rawArgs?: string;
  reply(text: string): Promise<void>;
}

export enum CommandCategory {
  CORE = 'Core',
  AI = 'AI',
  UTILITY = 'Utility',
  DOWNLOADER = 'Downloader',
  STICKER = 'Sticker',
  GROUP = 'Group',
  FUN = 'Fun',
  ECONOMY = 'Economy',
  SEARCH = 'Search',
  MEDIA = 'Media',
  ISLAMIC = 'Islamic',
  EDUCATION = 'Education',
  MARKETPLACE = 'Marketplace',
  ANONYMOUS = 'Anonymous',
  NETWORK = 'Network',
}

export enum PermissionLevel {
  USER = 0,
  GROUP_ADMIN = 1,
  BOT_ADMIN = 2,
  OWNER = 3,
}

export interface CommandMetadata {
  name: string;
  aliases?: string[];
  category: CommandCategory;
  permissions?: PermissionLevel;
  cooldown?: number;
  usage?: string;
  description?: string;
}

export interface Command extends CommandMetadata {
  execute(ctx: BotContext): Promise<void>;
}
