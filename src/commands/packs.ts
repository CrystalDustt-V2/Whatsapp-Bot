import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import config from '../config';
import { stickerEngine } from '../services/sticker-engine';
import { BotContext, Command, CommandCategory } from '../types';
import { downloadMediaFromContext } from './media/helpers';

type PackLink = {
  type: 'email' | 'whatsapp';
  value: string;
  linkedAt: string;
};

type PackSticker = {
  id: string;
  label?: string;
  tags: string[];
  fileName: string;
  bytes: number;
  createdAt: string;
};

type StickerPack = {
  id: string;
  name: string;
  category?: string;
  createdAt: string;
  updatedAt: string;
  stickers: PackSticker[];
};

type PackUser = {
  displayName: string;
  phoneNumber: string;
  link?: PackLink;
  packs: Record<string, StickerPack>;
};

type PackState = {
  users: Record<string, PackUser>;
};

const STORE_DIR = path.join(config.SESSION_PATH, 'sticker-packs');
const INDEX_FILE = path.join(STORE_DIR, 'index.json');
const STICKER_WATERMARK = 'Created with CrystalDust V0 Bot';
const MAX_PACKS_PER_USER = 20;
const MAX_STICKERS_PER_PACK = 100;
const MAX_STICKER_BYTES = 2 * 1024 * 1024;

function command(name: string, aliases: string[], category: CommandCategory, description: string, usage: string, execute: Command['execute']): Command {
  return { name, aliases, category, description, usage, execute };
}

function slug(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
}

function userKey(ctx: BotContext): string {
  return (ctx.sender.jid || `${ctx.sender.phoneNumber}@s.whatsapp.net`).replace(/[^a-z0-9@._-]/gi, '_');
}

function loadState(): PackState {
  try {
    const state = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')) as PackState;
    return state?.users ? state : { users: {} };
  } catch {
    return { users: {} };
  }
}

function saveState(state: PackState): void {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  fs.writeFileSync(INDEX_FILE, JSON.stringify(state, null, 2));
}

function user(state: PackState, ctx: BotContext): PackUser {
  const key = userKey(ctx);
  state.users[key] ||= {
    displayName: ctx.sender.displayName,
    phoneNumber: ctx.sender.phoneNumber,
    packs: {},
  };
  state.users[key].displayName = ctx.sender.displayName;
  state.users[key].phoneNumber = ctx.sender.phoneNumber;
  return state.users[key];
}

function packDir(ctx: BotContext, packId: string): string {
  return path.join(STORE_DIR, userKey(ctx), packId);
}

function findPack(target: PackUser, raw?: string): StickerPack | undefined {
  const key = slug(raw || '');
  return target.packs[key] || Object.values(target.packs).find((pack) => slug(pack.name) === key);
}

function parseNameCategory(raw: string): { name: string; category?: string } {
  const [name = '', category = ''] = raw.split('|').map((part) => part.trim());
  return {
    name: name.replace(/\s+/g, ' ').slice(0, 64),
    category: category.replace(/\s+/g, ' ').slice(0, 40) || undefined,
  };
}

function formatPack(pack: StickerPack): string {
  return `${pack.name} (${pack.id})\nCategory: ${pack.category || '-'}\nStickers: ${pack.stickers.length}\nUpdated: ${pack.updatedAt.slice(0, 10)}`;
}

function stickerRef(pack: StickerPack, raw?: string): PackSticker | undefined {
  if (!raw || raw.toLowerCase() === 'random') {
    return pack.stickers[Math.floor(Math.random() * pack.stickers.length)];
  }
  const index = Number(raw);
  return Number.isInteger(index) && index > 0
    ? pack.stickers[index - 1]
    : pack.stickers.find((sticker) => sticker.id === raw);
}

function removePackFiles(ctx: BotContext, packId: string): void {
  const dir = packDir(ctx, packId);
  const resolved = path.resolve(dir);
  const root = path.resolve(STORE_DIR);
  if (resolved.startsWith(root)) fs.rmSync(resolved, { recursive: true, force: true });
}

async function stickerBufferForAdd(ctx: BotContext, pack: StickerPack): Promise<Buffer | null> {
  const media = await downloadMediaFromContext(ctx, ['sticker', 'image']);
  if (!media) return null;

  const sticker = media.kind === 'sticker'
    ? await stickerEngine.getMetadataManager().addMetadata(media.buffer, pack.name, STICKER_WATERMARK)
    : await stickerEngine.createSticker(media.buffer, { packName: pack.name, author: STICKER_WATERMARK, smartCrop: true });

  return sticker.byteLength <= MAX_STICKER_BYTES ? sticker : null;
}

async function sendPackSticker(ctx: BotContext, pack: StickerPack, sticker: PackSticker): Promise<void> {
  const file = path.join(packDir(ctx, pack.id), sticker.fileName);
  await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
    sticker: fs.readFileSync(file),
    mimetype: 'image/webp',
  }, { quoted: ctx.message });
}

export const PackSystemCommand = command('pack', ['stickerpack', 'spack'], CommandCategory.PACK_SYSTEM, 'Manage saved sticker packs', 'pack <create|list|info|rename|delete|link|unlink|website|export> ...', async (ctx) => {
  const action = ctx.args[0]?.toLowerCase() || 'list';
  const state = loadState();
  const me = user(state, ctx);

  if (action === 'create') {
    const { name, category } = parseNameCategory((ctx.rawArgs || ctx.args.join(' ')).replace(/^create\s+/i, ''));
    const id = slug(name);
    if (!id) {
      await ctx.reply('Usage: .pack create <pack name> [| category]');
      return;
    }
    if (me.packs[id] || Object.keys(me.packs).length >= MAX_PACKS_PER_USER) {
      await ctx.reply(me.packs[id] ? 'Pack already exists.' : `Pack limit reached (${MAX_PACKS_PER_USER}).`);
      return;
    }
    const now = new Date().toISOString();
    me.packs[id] = { id, name, category, createdAt: now, updatedAt: now, stickers: [] };
    saveState(state);
    await ctx.reply(`Created pack: ${name}\nUse .packuse add ${id} while replying to a sticker/image.`);
    return;
  }

  if (action === 'list') {
    const packs = Object.values(me.packs);
    await ctx.reply(packs.length ? `Your packs\n${packs.map((pack) => `- ${pack.id}: ${pack.name} (${pack.stickers.length})`).join('\n')}` : 'No packs yet. Use .pack create <name>.');
    return;
  }

  if (action === 'info') {
    const pack = findPack(me, ctx.args[1]);
    await ctx.reply(pack ? formatPack(pack) : 'Pack not found.');
    return;
  }

  if (action === 'rename') {
    const pack = findPack(me, ctx.args[1]);
    const { name, category } = parseNameCategory((ctx.rawArgs || '').replace(/^rename\s+\S+\s*/i, ''));
    if (!pack || !name) {
      await ctx.reply('Usage: .pack rename <pack-id> <new name> [| category]');
      return;
    }
    pack.name = name;
    pack.category = category || pack.category;
    pack.updatedAt = new Date().toISOString();
    saveState(state);
    await ctx.reply(`Renamed pack: ${pack.name}`);
    return;
  }

  if (action === 'delete' || action === 'remove') {
    const pack = findPack(me, ctx.args[1]);
    if (!pack) {
      await ctx.reply('Usage: .pack delete <pack-id>');
      return;
    }
    delete me.packs[pack.id];
    removePackFiles(ctx, pack.id);
    saveState(state);
    await ctx.reply(`Deleted pack: ${pack.name}`);
    return;
  }

  if (action === 'link') {
    const type = ctx.args[1]?.toLowerCase();
    const value = type === 'whatsapp' ? (ctx.args[2]?.replace(/\D/g, '') || ctx.sender.phoneNumber) : ctx.args[2];
    if ((type !== 'email' && type !== 'whatsapp') || !value || (type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) {
      await ctx.reply('Usage: .pack link <email|whatsapp> <value>');
      return;
    }
    me.link = { type, value, linkedAt: new Date().toISOString() };
    saveState(state);
    await ctx.reply(`Pack account linked by ${type}.`);
    return;
  }

  if (action === 'unlink') {
    delete me.link;
    saveState(state);
    await ctx.reply('Pack account link removed.');
    return;
  }

  if (action === 'website') {
    const websiteUrl = config.PUBLIC_PACK_WEBSITE_URL || config.PACK_WEBSITE_URL;
    await ctx.reply(websiteUrl ? `Pack website: ${websiteUrl}` : 'PUBLIC_PACK_WEBSITE_URL is not configured yet.');
    return;
  }

  if (action === 'export') {
    const pack = findPack(me, ctx.args[1]);
    if (!pack) {
      await ctx.reply('Usage: .pack export <pack-id>');
      return;
    }
    const payload = Buffer.from(JSON.stringify({ owner: { displayName: me.displayName, phoneNumber: me.phoneNumber, link: me.link }, pack }, null, 2));
    await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
      document: payload,
      mimetype: 'application/json',
      fileName: `${pack.id}-manifest.json`,
      caption: 'Pack manifest exported. Sticker media stays on this bot until website sync exists.',
    }, { quoted: ctx.message });
    return;
  }

  await ctx.reply('Usage: .pack <create|list|info|rename|delete|link|unlink|website|export> ...');
});

export const PackUsageCommand = command('packuse', ['usepack', 'pstick', 'packsticker'], CommandCategory.PACK_USAGE, 'Add, send, and search saved pack stickers', 'packuse <add|send|random|remove|search|categories|category> ...', async (ctx) => {
  const action = ctx.args[0]?.toLowerCase() || 'random';
  const state = loadState();
  const me = user(state, ctx);

  if (action === 'add') {
    const pack = findPack(me, ctx.args[1]);
    if (!pack || pack.stickers.length >= MAX_STICKERS_PER_PACK) {
      await ctx.reply(pack ? `Sticker limit reached (${MAX_STICKERS_PER_PACK}).` : 'Usage: .packuse add <pack-id> [label | tag1,tag2]');
      return;
    }
    const sticker = await stickerBufferForAdd(ctx, pack);
    if (!sticker) {
      await ctx.reply('Reply to a sticker/image under 2 MB with .packuse add <pack-id> [label | tags].');
      return;
    }

    const [label = '', tagsText = ''] = (ctx.rawArgs || ctx.args.join(' '))
      .replace(/^add\s+\S+\s*/i, '')
      .split('|')
      .map((part) => part.trim());
    const item: PackSticker = {
      id: randomUUID().slice(0, 8),
      label: label.slice(0, 48) || undefined,
      tags: tagsText.split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean).slice(0, 12),
      fileName: `${Date.now()}-${randomUUID().slice(0, 8)}.webp`,
      bytes: sticker.byteLength,
      createdAt: new Date().toISOString(),
    };

    fs.mkdirSync(packDir(ctx, pack.id), { recursive: true });
    fs.writeFileSync(path.join(packDir(ctx, pack.id), item.fileName), sticker);
    pack.stickers.push(item);
    pack.updatedAt = new Date().toISOString();
    saveState(state);
    await ctx.reply(`Added sticker #${pack.stickers.length} to ${pack.name}.`);
    return;
  }

  if (action === 'send' || action === 'random') {
    const pack = action === 'send'
      ? findPack(me, ctx.args[1])
      : (ctx.args[1] ? findPack(me, ctx.args[1]) : Object.values(me.packs).filter((item) => item.stickers.length)[Math.floor(Math.random() * Object.values(me.packs).filter((item) => item.stickers.length).length)]);
    const sticker = pack ? stickerRef(pack, action === 'send' ? ctx.args[2] : 'random') : undefined;
    if (!pack || !sticker) {
      await ctx.reply(action === 'send' ? 'Usage: .packuse send <pack-id> [number|random]' : 'No sticker found in your packs.');
      return;
    }
    await sendPackSticker(ctx, pack, sticker);
    return;
  }

  if (action === 'remove' || action === 'delete') {
    const pack = findPack(me, ctx.args[1]);
    const sticker = pack ? stickerRef(pack, ctx.args[2]) : undefined;
    if (!pack || !sticker) {
      await ctx.reply('Usage: .packuse remove <pack-id> <number|sticker-id>');
      return;
    }
    fs.rmSync(path.join(packDir(ctx, pack.id), sticker.fileName), { force: true });
    pack.stickers = pack.stickers.filter((item) => item.id !== sticker.id);
    pack.updatedAt = new Date().toISOString();
    saveState(state);
    await ctx.reply(`Removed sticker from ${pack.name}.`);
    return;
  }

  if (action === 'search') {
    const query = ctx.args.slice(1).join(' ').toLowerCase();
    if (!query) {
      await ctx.reply('Usage: .packuse search <query>');
      return;
    }
    const rows = Object.values(me.packs).flatMap((pack) =>
      pack.stickers
        .map((sticker, index) => ({ pack, sticker, index }))
        .filter(({ pack, sticker }) => [pack.name, pack.category, sticker.label, ...sticker.tags].filter(Boolean).join(' ').toLowerCase().includes(query))
    ).slice(0, 15);
    await ctx.reply(rows.length ? rows.map(({ pack, sticker, index }) => `- ${pack.id} #${index + 1}${sticker.label ? `: ${sticker.label}` : ''}`).join('\n') : 'No pack stickers matched.');
    return;
  }

  if (action === 'categories') {
    const categories = [...new Set(Object.values(me.packs).map((pack) => pack.category).filter(Boolean))];
    await ctx.reply(categories.length ? `Pack categories\n${categories.map((category) => `- ${category}`).join('\n')}` : 'No pack categories yet.');
    return;
  }

  if (action === 'category') {
    const category = ctx.args.slice(1).join(' ').toLowerCase();
    const packs = Object.values(me.packs).filter((pack) => pack.category?.toLowerCase() === category);
    await ctx.reply(packs.length ? packs.map((pack) => `- ${pack.id}: ${pack.name} (${pack.stickers.length})`).join('\n') : 'No packs in that category.');
    return;
  }

  await ctx.reply('Usage: .packuse <add|send|random|remove|search|categories|category> ...');
});

export const PackCommands = [PackSystemCommand, PackUsageCommand];
