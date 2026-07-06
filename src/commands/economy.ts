import * as fs from 'fs';
import * as path from 'path';
import config from '../config';
import type { BotContext, Command } from '../types';
import { CommandCategory } from '../types';

type SkillName = 'hunting' | 'crafting' | 'farming' | 'fishing' | 'mining' | 'combat';

type Player = {
  jid: string;
  name: string;
  wallet: number;
  bank: number;
  xp: number;
  lastDaily?: string;
  clan?: string;
  inventory: Record<string, number>;
  skills: Record<SkillName, number>;
  pet?: {
    name: string;
    type: string;
    hunger: number;
    xp: number;
  };
};

type Clan = {
  name: string;
  ownerJid: string;
  members: string[];
};

type EconomyState = {
  players: Record<string, Player>;
  clans: Record<string, Clan>;
};

type ShopItem = {
  price: number;
  description: string;
};

const DATA_PATH = path.join(config.SESSION_PATH, 'economy-rpg.json');
const MAX_AMOUNT = 1_000_000;
const SKILLS: SkillName[] = ['hunting', 'crafting', 'farming', 'fishing', 'mining', 'combat'];
const SHOP: Record<string, ShopItem> = {
  bait: { price: 25, description: 'Helps hunting rewards' },
  seed: { price: 20, description: 'Used for farming' },
  wood: { price: 15, description: 'Crafting material' },
  stone: { price: 20, description: 'Crafting material' },
  iron: { price: 60, description: 'Crafting material' },
  petfood: { price: 30, description: 'Feeds your pet' },
  potion: { price: 80, description: 'Helps boss fights' },
};
const RECIPES: Record<string, Record<string, number>> = {
  pickaxe: { wood: 2, stone: 3 },
  sword: { wood: 1, iron: 3 },
  armor: { iron: 5, leather: 2 },
  petfood: { seed: 2, meat: 1 },
};

// ponytail: JSON store is enough for one bot process; move to Prisma when multi-worker economy matters.
function loadState(): EconomyState {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')) as EconomyState;
  } catch {
    return { players: {}, clans: {} };
  }
}

function saveState(state: EconomyState): void {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(state, null, 2));
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function levelForXp(xp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1;
}

function skillLevel(points: number): number {
  return Math.floor(Math.sqrt(Math.max(0, points) / 50)) + 1;
}

function userJid(ctx: BotContext): string {
  return ctx.sender.jid || `${ctx.sender.phoneNumber}@s.whatsapp.net`;
}

function newPlayer(ctx: BotContext): Player {
  return {
    jid: userJid(ctx),
    name: ctx.sender.displayName,
    wallet: 250,
    bank: 0,
    xp: 0,
    inventory: {},
    skills: { hunting: 0, crafting: 0, farming: 0, fishing: 0, mining: 0, combat: 0 },
  };
}

function ensureSkills(target: Player): void {
  target.skills ||= {} as Record<SkillName, number>;
  for (const skill of SKILLS) target.skills[skill] ||= 0;
}

function player(state: EconomyState, ctx: BotContext): Player {
  const jid = userJid(ctx);
  state.players[jid] ||= newPlayer(ctx);
  state.players[jid].name = ctx.sender.displayName;
  ensureSkills(state.players[jid]);
  return state.players[jid];
}

function targetJid(ctx: BotContext): string | null {
  const mentioned = ctx.message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  if (mentioned) return mentioned;

  const phone = ctx.args[0]?.replace(/\D/g, '');
  return phone && phone.length >= 6 ? `${phone}@s.whatsapp.net` : null;
}

function targetName(state: EconomyState, jid: string): string {
  return state.players[jid]?.name || jid.split('@')[0];
}

function targetPlayer(state: EconomyState, jid: string): Player {
  state.players[jid] ||= {
    jid,
    name: targetName(state, jid),
    wallet: 250,
    bank: 0,
    xp: 0,
    inventory: {},
    skills: { hunting: 0, crafting: 0, farming: 0, fishing: 0, mining: 0, combat: 0 },
  };
  ensureSkills(state.players[jid]);
  return state.players[jid];
}

function amount(raw: string | undefined, max: number): number | null {
  if (raw === 'all') return Math.max(0, Math.min(MAX_AMOUNT, Math.floor(max)));
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 && value <= MAX_AMOUNT ? value : null;
}

function addItem(target: Player, item: string, count: number): void {
  target.inventory[item] = Math.max(0, (target.inventory[item] || 0) + count);
  if (target.inventory[item] === 0) delete target.inventory[item];
}

function addXp(target: Player, xp: number, skill?: SkillName): void {
  target.xp += xp;
  if (skill) target.skills[skill] += xp;
}

function listInventory(target: Player): string {
  const entries = Object.entries(target.inventory).filter(([, count]) => count > 0);
  return entries.length ? entries.map(([item, count]) => `- ${item}: ${count}`).join('\n') : 'Inventory empty.';
}

function money(value: number): string {
  return `${Math.floor(value)} coins`;
}

function command(name: string, aliases: string[], description: string, usage: string, execute: Command['execute']): Command {
  return { name, aliases, category: CommandCategory.ECONOMY, description, usage, execute };
}

export const EconomyCommand = command('economy', ['eco'], 'Show economy/RPG profile', 'economy', async (ctx) => {
  const state = loadState();
  const me = player(state, ctx);
  await ctx.reply(
    `${me.name}\nWallet: ${money(me.wallet)}\nBank: ${money(me.bank)}\nLevel: ${levelForXp(me.xp)} (${me.xp} XP)\nClan: ${me.clan || '-'}`
  );
});

export const DailyCommand = command('daily', ['dailycoins', 'claim'], 'Claim daily coins', 'daily', async (ctx) => {
  const state = loadState();
  const me = player(state, ctx);
  if (me.lastDaily === today()) {
    await ctx.reply('Daily already claimed today.');
    return;
  }

  me.lastDaily = today();
  me.wallet += 500;
  addXp(me, 50);
  saveState(state);
  await ctx.reply('Daily claimed: 500 coins + 50 XP.');
});

export const BankCommand = command('bank', [], 'Deposit or withdraw coins', 'bank <deposit|withdraw|balance> [amount]', async (ctx) => {
  const action = ctx.args[0]?.toLowerCase();
  const state = loadState();
  const me = player(state, ctx);

  if (!action || action === 'balance') {
    await ctx.reply(`Bank: ${money(me.bank)}\nWallet: ${money(me.wallet)}`);
    return;
  }

  if (action !== 'deposit' && action !== 'withdraw') {
    await ctx.reply('Usage: .bank <deposit|withdraw|balance> [amount|all]');
    return;
  }

  const max = action === 'deposit' ? me.wallet : me.bank;
  const value = amount(ctx.args[1], max);
  if (!value || value > max) {
    await ctx.reply(`Not enough coins. ${action === 'deposit' ? 'Wallet' : 'Bank'}: ${money(max)}`);
    return;
  }

  me.wallet += action === 'deposit' ? -value : value;
  me.bank += action === 'deposit' ? value : -value;
  saveState(state);
  await ctx.reply(`${action === 'deposit' ? 'Deposited' : 'Withdrew'} ${money(value)}.`);
});

export const WalletCommand = command('wallet', ['bal', 'balance'], 'Show wallet and bank balance', 'wallet', async (ctx) => {
  const state = loadState();
  const me = player(state, ctx);
  await ctx.reply(`Wallet: ${money(me.wallet)}\nBank: ${money(me.bank)}\nTotal: ${money(me.wallet + me.bank)}`);
});

export const TransferCommand = command('transfer', ['pay', 'sendcoins'], 'Transfer coins to another user', 'transfer @user <amount>', async (ctx) => {
  const state = loadState();
  const me = player(state, ctx);
  const jid = targetJid(ctx);
  const value = amount(ctx.args.at(-1), me.wallet);
  if (!jid || !value || jid === me.jid) {
    await ctx.reply('Usage: .transfer @user <amount>');
    return;
  }
  if (me.wallet < value) {
    await ctx.reply(`Not enough wallet coins. Wallet: ${money(me.wallet)}`);
    return;
  }

  const other = targetPlayer(state, jid);
  me.wallet -= value;
  other.wallet += value;
  saveState(state);
  await ctx.reply(`Sent ${money(value)} to ${targetName(state, jid)}.`);
});

export const ShopCommand = command('shop', ['store'], 'List or buy shop items', 'shop [buy <item> [qty]]', async (ctx) => {
  const action = ctx.args[0]?.toLowerCase();
  const state = loadState();
  const me = player(state, ctx);

  if (action !== 'buy') {
    await ctx.reply(
      `Shop\n${Object.entries(SHOP)
        .map(([item, data]) => `- ${item}: ${money(data.price)} - ${data.description}`)
        .join('\n')}\n\nUse .shop buy <item> [qty]`
    );
    return;
  }

  const item = ctx.args[1]?.toLowerCase();
  const qty = amount(ctx.args[2] || '1', 1000);
  const listing = item ? SHOP[item] : undefined;
  if (!item || !listing || !qty) {
    await ctx.reply('Usage: .shop buy <item> [qty]');
    return;
  }

  const cost = listing.price * qty;
  if (me.wallet < cost) {
    await ctx.reply(`Need ${money(cost)}. Wallet: ${money(me.wallet)}`);
    return;
  }

  me.wallet -= cost;
  addItem(me, item, qty);
  saveState(state);
  await ctx.reply(`Bought ${qty} ${item} for ${money(cost)}.`);
});

export const InventoryCommand = command('inventory', ['inv', 'items'], 'Show inventory', 'inventory', async (ctx) => {
  const state = loadState();
  await ctx.reply(listInventory(player(state, ctx)));
});

export const TradeCommand = command('trade', ['giveitem'], 'Give an item to another user', 'trade @user <item> [qty]', async (ctx) => {
  const state = loadState();
  const me = player(state, ctx);
  const jid = targetJid(ctx);
  const item = ctx.args[1]?.toLowerCase();
  const qty = amount(ctx.args[2] || '1', 1000);
  if (!jid || !item || !qty) {
    await ctx.reply('Usage: .trade @user <item> [qty]');
    return;
  }
  if ((me.inventory[item] || 0) < qty) {
    await ctx.reply(`Not enough ${item}.`);
    return;
  }

  const other = targetPlayer(state, jid);
  addItem(me, item, -qty);
  addItem(other, item, qty);
  saveState(state);
  await ctx.reply(`Gave ${qty} ${item} to ${targetName(state, jid)}.`);
});

export const GambleCommand = command('gamble', ['bet'], 'Gamble wallet coins', 'gamble <amount>', async (ctx) => {
  const state = loadState();
  const me = player(state, ctx);
  const value = amount(ctx.args[0], me.wallet);
  if (!value || value > me.wallet) {
    await ctx.reply('Usage: .gamble <amount>');
    return;
  }

  const win = Math.random() < 0.48;
  me.wallet += win ? value : -value;
  addXp(me, win ? 20 : 5);
  saveState(state);
  await ctx.reply(`${win ? 'Won' : 'Lost'} ${money(value)}. Wallet: ${money(me.wallet)}`);
});

export const RobCommand = command('rob', ['steal'], 'Try to rob another user', 'rob @user', async (ctx) => {
  const state = loadState();
  const me = player(state, ctx);
  const jid = targetJid(ctx);
  if (!jid || jid === me.jid) {
    await ctx.reply('Usage: .rob @user');
    return;
  }

  const other = targetPlayer(state, jid);
  if (other.wallet < 50) {
    await ctx.reply(`${targetName(state, jid)} has too little wallet cash to rob.`);
    return;
  }

  const success = Math.random() < 0.35;
  if (success) {
    const stolen = Math.max(25, Math.min(other.wallet, Math.floor(other.wallet * (0.1 + Math.random() * 0.25))));
    other.wallet -= stolen;
    me.wallet += stolen;
    addXp(me, 35);
    saveState(state);
    await ctx.reply(`Robbery succeeded. Stole ${money(stolen)}.`);
    return;
  }

  const fine = Math.min(me.wallet, 50);
  me.wallet -= fine;
  other.wallet += fine;
  addXp(me, 5);
  saveState(state);
  await ctx.reply(`Robbery failed. Paid ${money(fine)} fine.`);
});

function activity(ctx: BotContext, skill: SkillName, verb: string, drops: [string, number][]): Promise<void> {
  const state = loadState();
  const me = player(state, ctx);
  const coins = 40 + Math.floor(Math.random() * 120) + skillLevel(me.skills[skill]) * 5;
  const xp = 20 + Math.floor(Math.random() * 40);
  const [item, count] = drops[Math.floor(Math.random() * drops.length)];

  me.wallet += coins;
  addXp(me, xp, skill);
  addItem(me, item, count);
  saveState(state);
  return ctx.reply(`${verb}: +${money(coins)}, +${xp} XP, +${count} ${item}.`);
}

export const HuntCommand = command('hunt', ['hunting'], 'Hunt for coins and items', 'hunt', (ctx) =>
  activity(ctx, 'hunting', 'Hunt complete', [
    ['meat', 1],
    ['leather', 1],
    ['bait', 1],
  ])
);

export const FarmCommand = command('farm', ['farming'], 'Farm for crops and coins', 'farm', (ctx) =>
  activity(ctx, 'farming', 'Farm complete', [
    ['seed', 2],
    ['crop', 2],
    ['wood', 1],
  ])
);

export const FishCommand = command('fish', ['fishing'], 'Fish for coins and items', 'fish', (ctx) =>
  activity(ctx, 'fishing', 'Fishing complete', [
    ['fish', 2],
    ['pearl', 1],
    ['bait', 1],
  ])
);

export const MineCommand = command('mine', ['mining'], 'Mine for materials and coins', 'mine', (ctx) =>
  activity(ctx, 'mining', 'Mine complete', [
    ['stone', 2],
    ['iron', 1],
    ['gold', 1],
  ])
);

export const CraftCommand = command('craft', ['crafting'], 'Craft an item from materials', 'craft <item>', async (ctx) => {
  const item = ctx.args[0]?.toLowerCase();
  const recipe = item ? RECIPES[item] : undefined;
  if (!item || !recipe) {
    await ctx.reply(`Craftable items: ${Object.keys(RECIPES).join(', ')}`);
    return;
  }

  const state = loadState();
  const me = player(state, ctx);
  for (const [need, qty] of Object.entries(recipe)) {
    if ((me.inventory[need] || 0) < qty) {
      await ctx.reply(`Need ${Object.entries(recipe).map(([name, count]) => `${count} ${name}`).join(', ')}.`);
      return;
    }
  }

  for (const [need, qty] of Object.entries(recipe)) addItem(me, need, -qty);
  addItem(me, item, 1);
  addXp(me, 40, 'crafting');
  saveState(state);
  await ctx.reply(`Crafted ${item}.`);
});

export const PetCommand = command('pet', ['pets'], 'Adopt, feed, or check a pet', 'pet <adopt|feed|status> [name]', async (ctx) => {
  const action = ctx.args[0]?.toLowerCase() || 'status';
  const state = loadState();
  const me = player(state, ctx);

  if (action === 'adopt') {
    if (me.pet) {
      await ctx.reply(`You already have ${me.pet.name}.`);
      return;
    }
    me.pet = { name: ctx.args.slice(1).join(' ').trim() || 'Buddy', type: 'cat', hunger: 70, xp: 0 };
    saveState(state);
    await ctx.reply(`Adopted pet: ${me.pet.name}.`);
    return;
  }

  if (!me.pet) {
    await ctx.reply('No pet yet. Use .pet adopt <name>.');
    return;
  }

  if (action === 'feed') {
    if ((me.inventory.petfood || 0) < 1) {
      await ctx.reply('Need petfood. Buy with .shop buy petfood.');
      return;
    }
    addItem(me, 'petfood', -1);
    me.pet.hunger = Math.min(100, me.pet.hunger + 25);
    me.pet.xp += 15;
    saveState(state);
    await ctx.reply(`${me.pet.name} fed. Hunger: ${me.pet.hunger}/100.`);
    return;
  }

  await ctx.reply(`${me.pet.name} (${me.pet.type})\nHunger: ${me.pet.hunger}/100\nLevel: ${skillLevel(me.pet.xp)}`);
});

export const BossCommand = command('boss', ['bossfight'], 'Fight a boss for rewards', 'boss', async (ctx) => {
  const state = loadState();
  const me = player(state, ctx);
  const power = levelForXp(me.xp) + skillLevel(me.skills.combat) + (me.inventory.sword ? 2 : 0) + (me.inventory.armor ? 2 : 0);
  const success = Math.random() * 12 < power;

  if (me.inventory.potion) addItem(me, 'potion', -1);
  if (!success) {
    addXp(me, 20, 'combat');
    saveState(state);
    await ctx.reply('Boss fight lost. +20 combat XP.');
    return;
  }

  const reward = 500 + Math.floor(Math.random() * 500);
  me.wallet += reward;
  addXp(me, 150, 'combat');
  addItem(me, 'boss_trophy', 1);
  saveState(state);
  await ctx.reply(`Boss defeated. +${money(reward)}, +150 XP, +1 boss_trophy.`);
});

export const ClanCommand = command('clan', ['guild'], 'Create, join, leave, or view clans', 'clan <create|join|leave|info> [name]', async (ctx) => {
  const action = ctx.args[0]?.toLowerCase() || 'info';
  const name = ctx.args.slice(1).join(' ').trim().replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 30);
  const state = loadState();
  const me = player(state, ctx);

  if (action === 'create') {
    if (!name) {
      await ctx.reply('Usage: .clan create <name>');
      return;
    }
    const key = name.toLowerCase();
    if (me.clan || state.clans[key]) {
      await ctx.reply(me.clan ? 'Leave your current clan first.' : 'Clan already exists.');
      return;
    }
    state.clans[key] = { name, ownerJid: me.jid, members: [me.jid] };
    me.clan = key;
    saveState(state);
    await ctx.reply(`Clan created: ${name}`);
    return;
  }

  if (action === 'join') {
    const key = name.toLowerCase();
    const clan = state.clans[key];
    if (!clan || me.clan) {
      await ctx.reply(!clan ? 'Clan not found.' : 'Leave your current clan first.');
      return;
    }
    clan.members.push(me.jid);
    me.clan = key;
    saveState(state);
    await ctx.reply(`Joined clan: ${clan.name}`);
    return;
  }

  if (action === 'leave') {
    if (!me.clan) {
      await ctx.reply('You are not in a clan.');
      return;
    }
    const clan = state.clans[me.clan];
    if (clan) {
      clan.members = clan.members.filter((jid) => jid !== me.jid);
      if (!clan.members.length) delete state.clans[me.clan];
      else if (clan.ownerJid === me.jid) clan.ownerJid = clan.members[0];
    }
    me.clan = undefined;
    saveState(state);
    await ctx.reply('Left clan.');
    return;
  }

  const clan = state.clans[name.toLowerCase()] || (me.clan ? state.clans[me.clan] : undefined);
  if (!clan) {
    await ctx.reply('No clan. Use .clan create <name> or .clan join <name>.');
    return;
  }
  await ctx.reply(`Clan: ${clan.name}\nOwner: ${targetName(state, clan.ownerJid)}\nMembers: ${clan.members.length}`);
});

export const LevelCommand = command('level', ['xp'], 'Show XP level', 'level', async (ctx) => {
  const state = loadState();
  const me = player(state, ctx);
  await ctx.reply(`Level: ${levelForXp(me.xp)}\nXP: ${me.xp}`);
});

export const LeaderboardCommand = command('leaderboard', ['lb', 'rank'], 'Show economy leaderboard', 'leaderboard [total|wallet|bank|xp]', async (ctx) => {
  const state = loadState();
  const mode = (ctx.args[0] || 'total').toLowerCase();
  const score = (target: Player): number => {
    if (mode === 'wallet') return target.wallet;
    if (mode === 'bank') return target.bank;
    if (mode === 'xp' || mode === 'level') return target.xp;
    return target.wallet + target.bank;
  };

  const rows = Object.values(state.players)
    .sort((a, b) => score(b) - score(a))
    .slice(0, 10)
    .map((target, index) => `${index + 1}. ${target.name}: ${mode === 'xp' || mode === 'level' ? `${target.xp} XP` : money(score(target))}`);

  await ctx.reply(rows.length ? `Leaderboard (${mode})\n${rows.join('\n')}` : 'Leaderboard empty.');
});

export const SkillsCommand = command('skills', ['skill'], 'Show RPG skill levels', 'skills', async (ctx) => {
  const state = loadState();
  const me = player(state, ctx);
  await ctx.reply(SKILLS.map((skill) => `${skill}: level ${skillLevel(me.skills[skill])} (${me.skills[skill]} XP)`).join('\n'));
});

export const RpgCommand = command('rpg', ['profile'], 'Show RPG profile', 'rpg', async (ctx) => {
  const state = loadState();
  const me = player(state, ctx);
  await ctx.reply(
    `RPG profile\nLevel: ${levelForXp(me.xp)}\nXP: ${me.xp}\nPet: ${me.pet?.name || '-'}\nClan: ${me.clan ? state.clans[me.clan]?.name || me.clan : '-'}`
  );
});

export const EconomyCommands = [
  EconomyCommand,
  DailyCommand,
  BankCommand,
  WalletCommand,
  TransferCommand,
  ShopCommand,
  InventoryCommand,
  TradeCommand,
  GambleCommand,
  RobCommand,
  RpgCommand,
  HuntCommand,
  CraftCommand,
  FarmCommand,
  FishCommand,
  MineCommand,
  PetCommand,
  BossCommand,
  ClanCommand,
  LevelCommand,
  LeaderboardCommand,
  SkillsCommand,
];
