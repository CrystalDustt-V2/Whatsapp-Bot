import type { WASocket, WAMessage } from '@whiskeysockets/baileys';

export interface SenderIdentity {
  jid: string;
  phoneNumber: string;
  profileName?: string;
  displayName: string;
  chatJid: string;
  fromMe: boolean;
}

export interface BotContext {
  socket: WASocket;
  message: WAMessage;
  sender: SenderIdentity;
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
  hidden?: boolean;
  permissions?: PermissionLevel;
  cooldown?: number;
  usage?: string;
  description?: string;
}

export interface Command extends CommandMetadata {
  execute(ctx: BotContext): Promise<void>;
}
