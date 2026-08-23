import * as fs from 'fs';
import * as path from 'path';
import config from '../config';
import type { BotContext, Command } from '../types';
import { CommandCategory } from '../types';
import { formatUsageError, formatFailed, formatSuccess } from '../core/response-formatter';

export type SkillName = 'hunting' | 'crafting' | 'farming' | 'fishing' | 'mining' | 'combat';

export type ToolType = 'rod' | 'pickaxe' | 'sword' | 'hoe';

export type ItemRarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface ItemDefinition {
  name: string;
  emoji: string;
  rarity: ItemRarity;
  price: number;
  sellPrice: number;
  description: string;
  category: 'material' | 'catch' | 'mineral' | 'crop' | 'consumable' | 'trophy';
}

export interface PlayerTransaction {
  type: string;
  amount: number;
  description: string;
  timestamp: number;
}

export interface PlayerQuests {
  date: string;
  hunts: number;
  fishes: number;
  mines: number;
  farms: number;
  boss: number;
  claimed: string[];
}

export interface Player {
  jid: string;
  name: string;
  wallet: number;
  bank: number;
  xp: number;
  lastDaily?: string;
  cooldowns?: Record<string, number>;
  clan?: string;
  tools?: Record<ToolType, number>;
  inventory: Record<string, number>;
  equipment?: {
    weapon?: string;
    armor?: string;
    tool?: string;
  };
  skills: Record<SkillName, number>;
  stats?: {
    hunts?: number;
    fishes?: number;
    mines?: number;
    farms?: number;
    bossWins?: number;
  };
  history?: PlayerTransaction[];
  quests?: PlayerQuests;
  pet?: {
    name: string;
    type: string;
    hunger: number;
    xp: number;
  };
}

export interface Clan {
  name: string;
  ownerJid: string;
  members: string[];
}

export interface EconomyState {
  players: Record<string, Player>;
  clans: Record<string, Clan>;
}

const DATA_PATH = path.join(config.SESSION_PATH, 'economy-rpg.json');
const MAX_AMOUNT = 100_000_000;
const SKILLS: SkillName[] = ['hunting', 'crafting', 'farming', 'fishing', 'mining', 'combat'];

export const TOOL_NAMES: Record<ToolType, string> = {
  rod: 'Fishing Rod',
  pickaxe: 'Pickaxe',
  sword: 'Hunting Sword',
  hoe: 'Farming Hoe',
};

export const TOOL_TIER_NAMES: string[] = [
  'Wooden',
  'Iron',
  'Gold',
  'Diamond',
  'Mythic',
];

export const TOOL_UPGRADES: Record<ToolType, { cost: number; material: string; matQty: number }[]> = {
  rod: [
    { cost: 300, material: 'wood', matQty: 5 },       // Tier 1 -> Tier 2 (Iron)
    { cost: 900, material: 'iron', matQty: 4 },       // Tier 2 -> Tier 3 (Gold)
    { cost: 2500, material: 'gold', matQty: 4 },      // Tier 3 -> Tier 4 (Diamond)
    { cost: 7500, material: 'diamond', matQty: 3 },   // Tier 4 -> Tier 5 (Mythic)
  ],
  pickaxe: [
    { cost: 300, material: 'stone', matQty: 6 },
    { cost: 900, material: 'iron', matQty: 5 },
    { cost: 2500, material: 'gold', matQty: 4 },
    { cost: 7500, material: 'diamond', matQty: 3 },
  ],
  sword: [
    { cost: 350, material: 'iron', matQty: 4 },
    { cost: 1000, material: 'gold', matQty: 4 },
    { cost: 2800, material: 'diamond', matQty: 3 },
    { cost: 8000, material: 'dragon_scale', matQty: 2 },
  ],
  hoe: [
    { cost: 250, material: 'wood', matQty: 6 },
    { cost: 800, material: 'iron', matQty: 4 },
    { cost: 2200, material: 'gold', matQty: 4 },
    { cost: 6500, material: 'diamond', matQty: 3 },
  ],
};

export const ITEMS: Record<string, ItemDefinition> = {
  // --- Consumables & Bait ---
  bait: { name: 'Fishing Bait', emoji: '🪱', rarity: 'common', price: 25, sellPrice: 10, description: 'Increases fishing success rate', category: 'consumable' },
  seed: { name: 'Crop Seed', emoji: '🌱', rarity: 'common', price: 20, sellPrice: 8, description: 'Plant for farming harvests', category: 'consumable' },
  petfood: { name: 'Pet Food', emoji: '🥫', rarity: 'common', price: 35, sellPrice: 15, description: 'Feeds and strengthens your pet', category: 'consumable' },
  potion: { name: 'Health Potion', emoji: '🧪', rarity: 'rare', price: 100, sellPrice: 45, description: 'Restores stamina and buffs boss combat', category: 'consumable' },
  elixir: { name: 'XP Elixir', emoji: '🍷', rarity: 'epic', price: 350, sellPrice: 150, description: 'Grants +250 instant XP', category: 'consumable' },

  // --- Crafting & Raw Materials ---
  wood: { name: 'Hardwood', emoji: '🪵', rarity: 'common', price: 20, sellPrice: 10, description: 'Basic crafting timber', category: 'material' },
  stone: { name: 'Solid Stone', emoji: '🪨', rarity: 'common', price: 25, sellPrice: 12, description: 'Basic mining stone', category: 'material' },
  iron: { name: 'Iron Ingot', emoji: '⚙️', rarity: 'rare', price: 80, sellPrice: 40, description: 'Refined iron for tool upgrades', category: 'material' },
  gold: { name: 'Gold Ingot', emoji: '🪙', rarity: 'epic', price: 250, sellPrice: 130, description: 'Precious gold bar', category: 'material' },
  diamond: { name: 'Flawless Diamond', emoji: '💎', rarity: 'epic', price: 600, sellPrice: 320, description: 'Rare gemstone for high-tier gear', category: 'mineral' },
  meteorite: { name: 'Meteorite Shard', emoji: '🌌', rarity: 'legendary', price: 1800, sellPrice: 950, description: 'Extraterrestrial mineral from deep mining', category: 'mineral' },

  // --- Fishing Catches ---
  fish: { name: 'Fresh Salmon', emoji: '🐟', rarity: 'common', price: 35, sellPrice: 20, description: 'Standard river salmon', category: 'catch' },
  seaweed: { name: 'Seaweed', emoji: '🌿', rarity: 'common', price: 15, sellPrice: 8, description: 'Fresh marine vegetation', category: 'catch' },
  prawn: { name: 'Giant Tiger Prawn', emoji: '🦐', rarity: 'rare', price: 90, sellPrice: 50, description: 'Delicious deep-sea prawn', category: 'catch' },
  pufferfish: { name: 'Spiky Pufferfish', emoji: '🐡', rarity: 'rare', price: 120, sellPrice: 70, description: 'Exotic venomous pufferfish', category: 'catch' },
  pearl: { name: 'Black Pearl', emoji: '🦪', rarity: 'epic', price: 350, sellPrice: 200, description: 'Lustrous ocean treasure', category: 'catch' },
  squid: { name: 'Giant Squid', emoji: '🦑', rarity: 'epic', price: 450, sellPrice: 260, description: 'Massive abyssal cephalopod', category: 'catch' },
  megalodon_tooth: { name: 'Megalodon Tooth', emoji: '🦈', rarity: 'legendary', price: 1500, sellPrice: 850, description: 'Fossilized tooth of an apex predator', category: 'catch' },
  sunken_chest: { name: 'Sunken Treasure', emoji: '👑', rarity: 'legendary', price: 2500, sellPrice: 1500, description: 'Ancient chest filled with royal artifacts', category: 'catch' },

  // --- Hunting Drops ---
  meat: { name: 'Game Meat', emoji: '🥩', rarity: 'common', price: 30, sellPrice: 18, description: 'Tender hunting cut', category: 'material' },
  leather: { name: 'Tough Leather', emoji: '🟤', rarity: 'common', price: 35, sellPrice: 22, description: 'Cured animal hide', category: 'material' },
  feather: { name: 'Eagle Feather', emoji: '🪶', rarity: 'common', price: 25, sellPrice: 14, description: 'Lightweight predatory feather', category: 'material' },
  antler: { name: 'Deer Antlers', emoji: '🦌', rarity: 'rare', price: 110, sellPrice: 65, description: 'Sturdy buck trophy', category: 'material' },
  wolf_pelt: { name: 'Shadow Wolf Pelt', emoji: '🐺', rarity: 'rare', price: 150, sellPrice: 90, description: 'Thick warm predator fur', category: 'material' },
  bear_claw: { name: 'Grizzly Claw', emoji: '🐻', rarity: 'epic', price: 380, sellPrice: 220, description: 'Ferocious beast armament', category: 'material' },
  tiger_fang: { name: 'Saber Tiger Fang', emoji: '🐯', rarity: 'epic', price: 480, sellPrice: 280, description: 'Sharp prehistoric hunting relic', category: 'material' },
  dragon_scale: { name: 'Wyvern Scale', emoji: '🐉', rarity: 'legendary', price: 1600, sellPrice: 950, description: 'Impervious dragon plate', category: 'material' },
  unicorn_horn: { name: 'Celestial Horn', emoji: '🦄', rarity: 'legendary', price: 2600, sellPrice: 1600, description: 'Magical horn radiating sacred energy', category: 'material' },

  // --- Farming Harvests ---
  wheat: { name: 'Golden Wheat', emoji: '🌾', rarity: 'common', price: 25, sellPrice: 15, description: 'Staple grain crop', category: 'crop' },
  carrot: { name: 'Sweet Carrot', emoji: '🥕', rarity: 'common', price: 30, sellPrice: 18, description: 'Crisp root vegetable', category: 'crop' },
  crop: { name: 'Fresh Vegetables', emoji: '🥗', rarity: 'common', price: 25, sellPrice: 14, description: 'Assorted garden harvest', category: 'crop' },
  strawberry: { name: 'Wild Strawberry', emoji: '🍓', rarity: 'rare', price: 90, sellPrice: 55, description: 'Succulent red berries', category: 'crop' },
  corn: { name: 'Sunburst Corn', emoji: '🌽', rarity: 'rare', price: 130, sellPrice: 75, description: 'Sweet summer ears', category: 'crop' },
  grape: { name: 'Mystic Grapes', emoji: '🍇', rarity: 'epic', price: 360, sellPrice: 210, description: 'Enchanted vineyard clusters', category: 'crop' },
  melon: { name: 'Giant Watermelon', emoji: '🍉', rarity: 'epic', price: 460, sellPrice: 270, description: 'Massive juicy garden centerpiece', category: 'crop' },
  golden_apple: { name: 'Enchanted Golden Apple', emoji: '🍎', rarity: 'legendary', price: 1500, sellPrice: 880, description: 'Legendary fruit bestowed with vitality', category: 'crop' },
  lotus: { name: 'Celestial Lotus', emoji: '🌸', rarity: 'legendary', price: 2400, sellPrice: 1450, description: 'Sacred blossom blooming once a millennium', category: 'crop' },

  // --- Boss / Special ---
  boss_trophy: { name: 'Ancient Boss Trophy', emoji: '🏆', rarity: 'legendary', price: 2000, sellPrice: 1200, description: 'Proof of victory over the dungeon titan', category: 'trophy' },
};

export const RECIPES: Record<string, Record<string, number>> = {
  pickaxe: { wood: 4, stone: 6 },
  sword: { wood: 2, iron: 4 },
  armor: { iron: 6, leather: 4 },
  potion: { weed: 2, water: 1, berry: 2 },
  petfood: { seed: 4, meat: 2 },
  elixir: { gold: 2, diamond: 1, pearl: 1 },
};

function loadState(): EconomyState {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')) as EconomyState;
    data.players ||= {};
    data.clans ||= {};
    return data;
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

export function levelForXp(xp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1;
}

export function xpForNextLevel(currentLevel: number): number {
  return currentLevel * currentLevel * 100;
}

export function skillLevel(points: number): number {
  return Math.floor(Math.sqrt(Math.max(0, points) / 50)) + 1;
}

function userJid(ctx: BotContext): string {
  return ctx.sender.jid || `${ctx.sender.phoneNumber}@s.whatsapp.net`;
}

function newPlayer(ctx: BotContext): Player {
  return {
    jid: userJid(ctx),
    name: ctx.sender.displayName || 'Adventurer',
    wallet: 500,
    bank: 0,
    xp: 0,
    tools: { rod: 0, pickaxe: 0, sword: 0, hoe: 0 },
    inventory: { bait: 3, seed: 3, wood: 2, stone: 2 },
    skills: { hunting: 0, crafting: 0, farming: 0, fishing: 0, mining: 0, combat: 0 },
    stats: { hunts: 0, fishes: 0, mines: 0, farms: 0, bossWins: 0 },
    cooldowns: {},
  };
}

function ensurePlayerDefaults(p: Player): void {
  p.skills ||= {} as Record<SkillName, number>;
  for (const s of SKILLS) p.skills[s] ||= 0;
  p.tools ||= { rod: 0, pickaxe: 0, sword: 0, hoe: 0 };
  p.stats ||= { hunts: 0, fishes: 0, mines: 0, farms: 0, bossWins: 0 };
  p.cooldowns ||= {};
  p.inventory ||= {};
  p.history ||= [];
  p.quests ||= { date: today(), hunts: 0, fishes: 0, mines: 0, farms: 0, boss: 0, claimed: [] };
  if (p.quests.date !== today()) {
    p.quests = { date: today(), hunts: 0, fishes: 0, mines: 0, farms: 0, boss: 0, claimed: [] };
  }
}

function logTransaction(target: Player, type: string, amount: number, description: string): void {
  target.history ||= [];
  target.history.unshift({
    type,
    amount,
    description,
    timestamp: Date.now(),
  });
  if (target.history.length > 20) {
    target.history.length = 20;
  }
}

function player(state: EconomyState, ctx: BotContext): Player {
  const jid = userJid(ctx);
  state.players[jid] ||= newPlayer(ctx);
  state.players[jid].name = ctx.sender.displayName || state.players[jid].name || 'Adventurer';
  ensurePlayerDefaults(state.players[jid]);
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
    wallet: 500,
    bank: 0,
    xp: 0,
    tools: { rod: 0, pickaxe: 0, sword: 0, hoe: 0 },
    inventory: {},
    skills: { hunting: 0, crafting: 0, farming: 0, fishing: 0, mining: 0, combat: 0 },
    stats: { hunts: 0, fishes: 0, mines: 0, farms: 0, bossWins: 0 },
    cooldowns: {},
  };
  ensurePlayerDefaults(state.players[jid]);
  return state.players[jid];
}

function parseAmount(raw: string | undefined, max: number): number | null {
  if (!raw) return null;
  const trimmed = raw.toLowerCase().trim();
  if (trimmed === 'all' || trimmed === 'max') return Math.max(0, Math.min(MAX_AMOUNT, Math.floor(max)));
  const value = Number(trimmed);
  return Number.isInteger(value) && value > 0 && value <= MAX_AMOUNT ? value : null;
}

function addItem(target: Player, itemKey: string, count: number): void {
  const current = target.inventory[itemKey] || 0;
  const updated = Math.max(0, current + count);
  if (updated <= 0) {
    delete target.inventory[itemKey];
  } else {
    target.inventory[itemKey] = updated;
  }
}

function addXp(target: Player, xpGain: number, skill?: SkillName): { leveledUp: boolean; oldLevel: number; newLevel: number } {
  const oldLevel = levelForXp(target.xp);
  target.xp += xpGain;
  const newLevel = levelForXp(target.xp);
  if (skill) {
    target.skills[skill] = (target.skills[skill] || 0) + xpGain;
  }

  if (newLevel > oldLevel) {
    const bonusCoins = (newLevel - oldLevel) * 250;
    target.wallet += bonusCoins;
    return { leveledUp: true, oldLevel, newLevel };
  }

  return { leveledUp: false, oldLevel, newLevel };
}

function checkCooldown(target: Player, action: string, cooldownSec: number): { ready: boolean; remainingSec: number } {
  target.cooldowns ||= {};
  const now = Math.floor(Date.now() / 1000);
  const lastTime = target.cooldowns[action] || 0;
  const elapsed = now - lastTime;

  if (elapsed < cooldownSec) {
    return { ready: false, remainingSec: cooldownSec - elapsed };
  }

  target.cooldowns[action] = now;
  return { ready: true, remainingSec: 0 };
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function money(value: number): string {
  return `${Math.floor(value).toLocaleString('en-US')} coins`;
}

function rarityBadge(rarity: ItemRarity): string {
  switch (rarity) {
    case 'common': return '⚪ Common';
    case 'rare': return '🔵 Rare';
    case 'epic': return '🟣 Epic';
    case 'legendary': return '🟡 Legendary';
  }
}

// ----------------------------------------------------
// COMMANDS
// ----------------------------------------------------

export const EconomyProfileCommand: Command = {
  name: 'economy',
  aliases: ['eco', 'profile', 'rpgprofile'],
  category: CommandCategory.ECONOMY,
  description: 'View full RPG player profile, stats, equipped tools, and skills',
  usage: 'economy',
  examples: ['economy', 'eco'],
  async execute(ctx) {
    const state = loadState();
    const me = player(state, ctx);
    const lvl = levelForXp(me.xp);
    const nextXp = xpForNextLevel(lvl);
    const totalCoins = me.wallet + me.bank;

    const toolSummary = (Object.keys(TOOL_NAMES) as ToolType[])
      .map((t) => {
        const tier = me.tools?.[t] || 0;
        const name = TOOL_TIER_NAMES[tier] || 'Basic';
        return `• ${TOOL_NAMES[t]}: *${name}* (Tier ${tier + 1})`;
      })
      .join('\n');

    const skillSummary = SKILLS.map((s) => `• ${s.charAt(0).toUpperCase() + s.slice(1)}: Level ${skillLevel(me.skills[s])} (${me.skills[s]} XP)`).join('\n');

    const text = [
      `👑 *Adventurer Profile: ${me.name}*`,
      `⭐ *Level:* ${lvl} (${me.xp.toLocaleString()} / ${nextXp.toLocaleString()} XP)`,
      `💰 *Total Wealth:* ${money(totalCoins)} (Wallet: ${money(me.wallet)} | Bank: ${money(me.bank)})`,
      me.clan ? `🛡️ *Clan:* ${state.clans[me.clan]?.name || me.clan}` : undefined,
      me.pet ? `🐾 *Pet:* ${me.pet.name} (Lvl ${skillLevel(me.pet.xp)}, Hunger: ${me.pet.hunger}/100)` : undefined,
      `\n🔨 *Equipped Tools:*`,
      toolSummary,
      `\n📜 *Skills:*`,
      skillSummary,
      `\n📊 *Lifetime Stats:*`,
      `• Hunts: ${me.stats?.hunts || 0} | Fishes: ${me.stats?.fishes || 0}`,
      `• Mines: ${me.stats?.mines || 0} | Farms: ${me.stats?.farms || 0}`,
      `• Boss Defeats: ${me.stats?.bossWins || 0}`,
    ].filter(Boolean).join('\n');

    await ctx.reply(text);
  },
};

export const BalanceCommand: Command = {
  name: 'balance',
  aliases: ['bal', 'wallet', 'money', 'coins'],
  category: CommandCategory.ECONOMY,
  description: 'Check wallet balance, bank deposits, and total wealth',
  usage: 'balance [@user]',
  examples: ['balance', 'bal', 'wallet @user'],
  async execute(ctx) {
    const state = loadState();
    const target = targetJid(ctx);
    const p = target ? targetPlayer(state, target) : player(state, ctx);

    const total = p.wallet + p.bank;
    const text = [
      `💳 *Balance Statement: ${p.name}*`,
      `🪙 *Wallet:* ${money(p.wallet)}`,
      `🏦 *Bank Vault:* ${money(p.bank)}`,
      `💰 *Net Worth:* ${money(total)}`,
      `⭐ *Level:* ${levelForXp(p.xp)} (${p.xp.toLocaleString()} XP)`,
      `\n💡 _Use .bank deposit <amount> to keep your coins safe from robbery!_`,
    ].join('\n');

    await ctx.reply(text);
  },
};

export const DailyCommand: Command = {
  name: 'daily',
  aliases: ['dailycoins', 'claim'],
  category: CommandCategory.ECONOMY,
  description: 'Claim daily reward coins and bonus XP (24h cooldown)',
  usage: 'daily',
  examples: ['daily'],
  async execute(ctx) {
    const state = loadState();
    const me = player(state, ctx);

    if (me.lastDaily === today()) {
      await ctx.reply(
        formatFailed({
          title: 'Daily Reward',
          reason: 'You have already claimed your daily reward today.',
          tryHint: 'Come back tomorrow after midnight UTC for your next bonus!',
        })
      );
      return;
    }

    const lvl = levelForXp(me.xp);
    const coinsReward = 750 + lvl * 50;
    const xpReward = 100;

    me.lastDaily = today();
    me.wallet += coinsReward;
    const { leveledUp, newLevel } = addXp(me, xpReward);
    saveState(state);

    let msg = `🎁 *Daily Reward Claimed!*\n\n+${money(coinsReward)}\n+${xpReward} XP\nWallet: ${money(me.wallet)}`;
    if (leveledUp) {
      msg += `\n\n🎉 *Level Up!* You advanced to Level ${newLevel}! (+250 bonus coins)`;
    }

    await ctx.reply(msg);
  },
};

export const BankCommand: Command = {
  name: 'bank',
  aliases: ['deposit', 'withdraw'],
  category: CommandCategory.ECONOMY,
  description: 'Deposit wallet coins into the bank or withdraw them',
  usage: 'bank <deposit|withdraw> <amount|all>',
  examples: ['bank deposit 500', 'bank deposit all', 'bank withdraw 250'],
  inputs: 'Action ("deposit" or "withdraw") and coin amount',
  async execute(ctx) {
    const action = (ctx.args[0] || '').toLowerCase();
    const amountArg = ctx.args[1];

    const state = loadState();
    const me = player(state, ctx);

    if (!action || (action !== 'deposit' && action !== 'withdraw')) {
      await ctx.reply(
        formatUsageError({
          command: 'bank',
          reason: 'Specify "deposit" or "withdraw".',
          examples: ['bank deposit 1000', 'bank deposit all', 'bank withdraw 500'],
          hint: `Current Balance: Wallet ${money(me.wallet)} | Bank ${money(me.bank)}`,
        })
      );
      return;
    }

    const max = action === 'deposit' ? me.wallet : me.bank;
    const value = parseAmount(amountArg, max);

    if (!value || value <= 0 || value > max) {
      await ctx.reply(
        formatFailed({
          title: `Bank ${action.charAt(0).toUpperCase() + action.slice(1)}`,
          reason: `Insufficient funds. Available ${action === 'deposit' ? 'Wallet' : 'Bank'}: ${money(max)}`,
          tryHint: `Try a valid positive amount or use "all".`,
        })
      );
      return;
    }

    if (action === 'deposit') {
      me.wallet -= value;
      me.bank += value;
    } else {
      me.wallet += value;
      me.bank -= value;
    }

    saveState(state);
    await ctx.reply(
      `🏦 *Bank Transaction Successful*\n\n• ${action === 'deposit' ? 'Deposited' : 'Withdrawn'}: *${money(value)}*\n• Wallet: ${money(me.wallet)}\n• Bank: ${money(me.bank)}`
    );
  },
};

export const TransferCommand: Command = {
  name: 'transfer',
  aliases: ['pay', 'givecoins', 'sendcoins'],
  category: CommandCategory.ECONOMY,
  description: 'Send coins from your wallet to another player',
  usage: 'transfer @user <amount>',
  examples: ['transfer @user 500', 'pay @user 1000'],
  inputs: 'Mention @user and coin amount',
  async execute(ctx) {
    const state = loadState();
    const me = player(state, ctx);
    const jid = targetJid(ctx);
    const value = parseAmount(ctx.args.at(-1), me.wallet);

    if (!jid || !value || jid === me.jid) {
      await ctx.reply(
        formatUsageError({
          command: 'transfer',
          reason: 'Target user and valid coin amount required.',
          examples: ['transfer @user 500', 'pay @user 250'],
        })
      );
      return;
    }

    if (me.wallet < value) {
      await ctx.reply(
        formatFailed({
          title: 'Transfer Failed',
          reason: `Not enough wallet cash. You have ${money(me.wallet)}.`,
        })
      );
      return;
    }

    const other = targetPlayer(state, jid);
    me.wallet -= value;
    other.wallet += value;
    saveState(state);

    await ctx.reply(
      `💸 *Transfer Complete*\n\nTransferred *${money(value)}* to *${targetName(state, jid)}*.\nYour new wallet balance: ${money(me.wallet)}`
    );
  },
};

export const InventoryCommand: Command = {
  name: 'inventory',
  aliases: ['inv', 'bag', 'items'],
  category: CommandCategory.ECONOMY,
  description: 'View your stored items, rarities, quantities, and estimated sell value',
  usage: 'inventory',
  examples: ['inventory', 'inv'],
  async execute(ctx) {
    const state = loadState();
    const me = player(state, ctx);

    const entries = Object.entries(me.inventory).filter(([, count]) => count > 0);
    if (!entries.length) {
      await ctx.reply(`🎒 *Inventory: ${me.name}*\n\nYour backpack is empty! Go .hunt, .fish, .mine, or .farm to gather items.`);
      return;
    }

    let totalValue = 0;
    const lines = entries.map(([key, count]) => {
      const def = ITEMS[key];
      const name = def?.name || key;
      const emoji = def?.emoji || '📦';
      const sellPrice = def?.sellPrice || 5;
      const val = sellPrice * count;
      totalValue += val;
      return `${emoji} *${name}* × ${count.toLocaleString()} (${money(val)})`;
    });

    const text = [
      `🎒 *Backpack Inventory: ${me.name}*`,
      `📦 Items: ${entries.length} types | Total Est. Value: *${money(totalValue)}*`,
      `\n${lines.join('\n')}`,
      `\n💡 _Use .sell <item> [qty] or .sell all to trade your items for coins._`,
    ].join('\n');

    await ctx.reply(text);
  },
};

export const ShopCommand: Command = {
  name: 'shop',
  aliases: ['store', 'market'],
  category: CommandCategory.ECONOMY,
  description: 'Browse the general merchant shop or buy items',
  usage: 'shop [buy <item> [qty]]',
  examples: ['shop', 'shop buy bait 5', 'shop buy potion 2'],
  inputs: 'Optional "buy", item name, and quantity',
  async execute(ctx) {
    const action = ctx.args[0]?.toLowerCase();
    const state = loadState();
    const me = player(state, ctx);

    if (action !== 'buy') {
      const shopItems = Object.entries(ITEMS)
        .filter(([, def]) => def.price > 0 && (def.category === 'consumable' || def.category === 'material'))
        .map(([k, def]) => `• ${def.emoji} *${def.name}* (\`${k}\`): ${money(def.price)}\n   _${def.description}_`);

      await ctx.reply(
        `🏪 *Village Merchant Shop*\n\n${shopItems.join('\n\n')}\n\n👉 *To Purchase:* \`.shop buy <item_code> [quantity]\`\nExample: \`.shop buy bait 5\``
      );
      return;
    }

    const itemKey = ctx.args[1]?.toLowerCase();
    const qty = parseAmount(ctx.args[2] || '1', 1000) || 1;
    const def = itemKey ? ITEMS[itemKey] : undefined;

    if (!itemKey || !def || def.price <= 0) {
      await ctx.reply(
        formatUsageError({
          command: 'shop',
          reason: 'Invalid item code.',
          examples: ['shop buy bait 5', 'shop buy seed 10', 'shop buy potion 1'],
        })
      );
      return;
    }

    const totalCost = def.price * qty;
    if (me.wallet < totalCost) {
      await ctx.reply(
        formatFailed({
          title: 'Shop Purchase',
          reason: `Insufficient wallet coins. Needed: ${money(totalCost)}, You have: ${money(me.wallet)}`,
          tryHint: 'Withdraw coins from your bank with .bank withdraw <amount>',
        })
      );
      return;
    }

    me.wallet -= totalCost;
    addItem(me, itemKey, qty);
    saveState(state);

    await ctx.reply(
      `🛒 *Purchase Successful!*\n\nBought *${qty}× ${def.emoji} ${def.name}* for *${money(totalCost)}*.\nRemaining Wallet: ${money(me.wallet)}`
    );
  },
};

export const SellCommand: Command = {
  name: 'sell',
  aliases: ['sellitem', 'sellall'],
  category: CommandCategory.ECONOMY,
  description: 'Sell collected items and catches for coins',
  usage: 'sell <item|all> [qty]',
  examples: ['sell all', 'sell fish 5', 'sell gold 2'],
  inputs: 'Item code or "all", with optional quantity',
  async execute(ctx) {
    const state = loadState();
    const me = player(state, ctx);
    const itemKey = (ctx.args[0] || '').toLowerCase();

    if (!itemKey) {
      await ctx.reply(
        formatUsageError({
          command: 'sell',
          reason: 'Specify an item or "all".',
          examples: ['sell all', 'sell fish 10', 'sell gold 1'],
          hint: 'Use .inventory to check what sellable items you have.',
        })
      );
      return;
    }

    if (itemKey === 'all') {
      let total = 0;
      const soldLines: string[] = [];

      for (const [key, count] of Object.entries(me.inventory)) {
        const def = ITEMS[key];
        if (!def || def.sellPrice <= 0 || count <= 0) continue;
        const earnings = def.sellPrice * count;
        total += earnings;
        soldLines.push(`• ${def.emoji} ${def.name} × ${count} → +${money(earnings)}`);
        addItem(me, key, -count);
      }

      if (!total) {
        await ctx.reply('⚠️ No sellable items in your inventory.');
        return;
      }

      me.wallet += total;
      saveState(state);

      await ctx.reply(
        `💰 *Sold All Items*\n\n${soldLines.join('\n')}\n\n*Total Profit:* +${money(total)}\nNew Wallet: ${money(me.wallet)}`
      );
      return;
    }

    const def = ITEMS[itemKey];
    const owned = me.inventory[itemKey] || 0;
    const qty = parseAmount(ctx.args[1] || '1', owned) || (ctx.args[1]?.toLowerCase() === 'all' ? owned : 1);

    if (!def || def.sellPrice <= 0 || !qty || owned < qty) {
      await ctx.reply(
        formatFailed({
          title: 'Sell Items',
          reason: `You do not have ${qty} of "${itemKey}" to sell (Owned: ${owned}).`,
        })
      );
      return;
    }

    const earnings = def.sellPrice * qty;
    addItem(me, itemKey, -qty);
    me.wallet += earnings;
    saveState(state);

    await ctx.reply(
      `💰 *Sold Items*\n\nSold *${qty}× ${def.emoji} ${def.name}* for *+${money(earnings)}*.\nWallet: ${money(me.wallet)}`
    );
  },
};

export const UpgradeCommand: Command = {
  name: 'upgrade',
  aliases: ['toolupgrade', 'upgradetool'],
  category: CommandCategory.ECONOMY,
  description: 'Upgrade your gathering tools (rod, pickaxe, sword, hoe) to higher tiers for better drops',
  usage: 'upgrade <rod|pickaxe|sword|hoe>',
  examples: ['upgrade rod', 'upgrade pickaxe', 'upgrade sword', 'upgrade hoe'],
  inputs: 'Tool type: rod, pickaxe, sword, hoe',
  async execute(ctx) {
    const tool = (ctx.args[0] || '').toLowerCase() as ToolType;
    const state = loadState();
    const me = player(state, ctx);

    if (!tool || !TOOL_UPGRADES[tool]) {
      const statusList = (Object.keys(TOOL_NAMES) as ToolType[])
        .map((t) => {
          const curTier = me.tools?.[t] || 0;
          const name = TOOL_TIER_NAMES[curTier] || 'Basic';
          const nextPlan = TOOL_UPGRADES[t][curTier];
          const nextText = nextPlan
            ? `Next: ${TOOL_TIER_NAMES[curTier + 1]} (${money(nextPlan.cost)} + ${nextPlan.matQty} ${ITEMS[nextPlan.material]?.name || nextPlan.material})`
            : 'MAX LEVEL 🌟';
          return `• ${TOOL_NAMES[t]}: *${name}* (Tier ${curTier + 1})\n   ${nextText}`;
        })
        .join('\n\n');

      await ctx.reply(
        `🔨 *Tool Upgrades Hub*\n\n${statusList}\n\n👉 Upgrade with: \`.upgrade <tool>\` (e.g. \`.upgrade rod\`)`
      );
      return;
    }

    const currentTier = me.tools?.[tool] || 0;
    const maxTier = TOOL_TIER_NAMES.length - 1;

    if (currentTier >= maxTier) {
      await ctx.reply(`🌟 Your ${TOOL_NAMES[tool]} is already at maximum tier (${TOOL_TIER_NAMES[maxTier]})!`);
      return;
    }

    const upgradeReq = TOOL_UPGRADES[tool][currentTier];
    if (me.wallet < upgradeReq.cost) {
      await ctx.reply(
        formatFailed({
          title: 'Upgrade Tool',
          reason: `Need ${money(upgradeReq.cost)} coins. You have ${money(me.wallet)}.`,
        })
      );
      return;
    }

    const ownedMaterial = me.inventory[upgradeReq.material] || 0;
    if (ownedMaterial < upgradeReq.matQty) {
      const matDef = ITEMS[upgradeReq.material];
      await ctx.reply(
        formatFailed({
          title: 'Upgrade Tool',
          reason: `Need ${upgradeReq.matQty}× ${matDef?.emoji || ''} ${matDef?.name || upgradeReq.material}. You only have ${ownedMaterial}.`,
          tryHint: 'Gather the required materials from hunting/mining/fishing before upgrading!',
        })
      );
      return;
    }

    me.wallet -= upgradeReq.cost;
    addItem(me, upgradeReq.material, -upgradeReq.matQty);
    me.tools = me.tools || { rod: 0, pickaxe: 0, sword: 0, hoe: 0 };
    me.tools[tool] = currentTier + 1;
    addXp(me, 100, 'crafting');
    saveState(state);

    const newTierName = TOOL_TIER_NAMES[currentTier + 1];
    await ctx.reply(
      `🎉 *Tool Upgraded!*\n\nYour *${TOOL_NAMES[tool]}* is now *${newTierName}* (Tier ${currentTier + 2})!\nEnjoy increased drop rates and coin boosts.`
    );
  },
};

// ----------------------------------------------------
// GATHERING ACTIVITIES: HUNT, FISH, MINE, FARM
// ----------------------------------------------------

function runGatherActivity(
  ctx: BotContext,
  configActivity: {
    skill: SkillName;
    toolType: ToolType;
    actionName: string;
    cooldownSec: number;
    statKey: 'hunts' | 'fishes' | 'mines' | 'farms';
    dropTable: { itemKey: string; weight: number; countRange: [number, number] }[];
  }
): Promise<void> {
  const state = loadState();
  const me = player(state, ctx);

  const cd = checkCooldown(me, configActivity.actionName, configActivity.cooldownSec);
  if (!cd.ready) {
    return ctx.reply(`⏳ *Cooldown Active:* You can ${configActivity.actionName} again in *${formatDuration(cd.remainingSec)}*.`);
  }

  const toolTier = me.tools?.[configActivity.toolType] || 0;
  const sLvl = skillLevel(me.skills[configActivity.skill]);

  // Determine loot
  const roll = Math.random() * 100 + toolTier * 6;
  const eligibleDrops = configActivity.dropTable.filter((d) => {
    const item = ITEMS[d.itemKey];
    if (!item) return false;
    if (item.rarity === 'legendary') return roll >= 90;
    if (item.rarity === 'epic') return roll >= 70;
    if (item.rarity === 'rare') return roll >= 40;
    return true;
  });

  const totalWeight = eligibleDrops.reduce((acc, d) => acc + d.weight, 0);
  let randomWeight = Math.random() * totalWeight;
  let pickedDrop = eligibleDrops[0];

  for (const d of eligibleDrops) {
    if (randomWeight < d.weight) {
      pickedDrop = d;
      break;
    }
    randomWeight -= d.weight;
  }

  const count = Math.floor(Math.random() * (pickedDrop.countRange[1] - pickedDrop.countRange[0] + 1)) + pickedDrop.countRange[0];
  const itemDef = ITEMS[pickedDrop.itemKey] || { name: pickedDrop.itemKey, emoji: '📦', rarity: 'common' as ItemRarity };
  const coinsEarned = 40 + Math.floor(Math.random() * 80) + toolTier * 30 + sLvl * 10;
  const xpEarned = 25 + Math.floor(Math.random() * 35) + toolTier * 10;

  me.wallet += coinsEarned;
  addItem(me, pickedDrop.itemKey, count);
  me.stats ||= { hunts: 0, fishes: 0, mines: 0, farms: 0, bossWins: 0 };
  me.stats[configActivity.statKey] = (me.stats[configActivity.statKey] || 0) + 1;
  const { leveledUp, newLevel } = addXp(me, xpEarned, configActivity.skill);
  saveState(state);

  const lines = [
    `🎯 *${configActivity.actionName.toUpperCase()} REWARD*`,
    `• Item Loot: ${itemDef.emoji} *${count}× ${itemDef.name}* (${rarityBadge(itemDef.rarity)})`,
    `• Coins: +*${money(coinsEarned)}*`,
    `• XP: +*${xpEarned} XP* (${configActivity.skill})`,
    `• Tool in use: ${TOOL_TIER_NAMES[toolTier]} ${TOOL_NAMES[configActivity.toolType]}`,
  ];

  if (leveledUp) {
    lines.push(`\n🎉 *Level Up!* You advanced to Level ${newLevel}! (+250 bonus coins)`);
  }

  return ctx.reply(lines.join('\n'));
}

export const HuntCommand: Command = {
  name: 'hunt',
  aliases: ['hunting'],
  category: CommandCategory.ECONOMY,
  description: 'Hunt wild beasts in the forest for meat, pelts, and mythical monster parts',
  usage: 'hunt',
  examples: ['hunt'],
  limits: '3-minute cooldown',
  async execute(ctx) {
    await runGatherActivity(ctx, {
      skill: 'hunting',
      toolType: 'sword',
      actionName: 'hunt',
      cooldownSec: 180,
      statKey: 'hunts',
      dropTable: [
        { itemKey: 'meat', weight: 40, countRange: [1, 3] },
        { itemKey: 'leather', weight: 30, countRange: [1, 2] },
        { itemKey: 'feather', weight: 25, countRange: [1, 3] },
        { itemKey: 'antler', weight: 15, countRange: [1, 2] },
        { itemKey: 'wolf_pelt', weight: 12, countRange: [1, 1] },
        { itemKey: 'bear_claw', weight: 6, countRange: [1, 1] },
        { itemKey: 'tiger_fang', weight: 4, countRange: [1, 1] },
        { itemKey: 'dragon_scale', weight: 2, countRange: [1, 1] },
        { itemKey: 'unicorn_horn', weight: 1, countRange: [1, 1] },
      ],
    });
  },
};

export const FishCommand: Command = {
  name: 'fish',
  aliases: ['fishing'],
  category: CommandCategory.ECONOMY,
  description: 'Cast your line to catch fish, black pearls, and legendary sunken treasures',
  usage: 'fish',
  examples: ['fish'],
  limits: '3-minute cooldown',
  async execute(ctx) {
    await runGatherActivity(ctx, {
      skill: 'fishing',
      toolType: 'rod',
      actionName: 'fish',
      cooldownSec: 180,
      statKey: 'fishes',
      dropTable: [
        { itemKey: 'fish', weight: 45, countRange: [1, 3] },
        { itemKey: 'seaweed', weight: 30, countRange: [1, 2] },
        { itemKey: 'prawn', weight: 18, countRange: [1, 2] },
        { itemKey: 'pufferfish', weight: 12, countRange: [1, 1] },
        { itemKey: 'pearl', weight: 6, countRange: [1, 1] },
        { itemKey: 'squid', weight: 4, countRange: [1, 1] },
        { itemKey: 'megalodon_tooth', weight: 2, countRange: [1, 1] },
        { itemKey: 'sunken_chest', weight: 1, countRange: [1, 1] },
      ],
    });
  },
};

export const MineCommand: Command = {
  name: 'mine',
  aliases: ['mining'],
  category: CommandCategory.ECONOMY,
  description: 'Excavate cavern depths for iron, gold, diamonds, and meteorite shards',
  usage: 'mine',
  examples: ['mine'],
  limits: '3-minute cooldown',
  async execute(ctx) {
    await runGatherActivity(ctx, {
      skill: 'mining',
      toolType: 'pickaxe',
      actionName: 'mine',
      cooldownSec: 180,
      statKey: 'mines',
      dropTable: [
        { itemKey: 'stone', weight: 45, countRange: [2, 5] },
        { itemKey: 'wood', weight: 25, countRange: [1, 2] },
        { itemKey: 'iron', weight: 20, countRange: [1, 3] },
        { itemKey: 'gold', weight: 8, countRange: [1, 2] },
        { itemKey: 'diamond', weight: 4, countRange: [1, 1] },
        { itemKey: 'meteorite', weight: 1, countRange: [1, 1] },
      ],
    });
  },
};

export const FarmCommand: Command = {
  name: 'farm',
  aliases: ['farming'],
  category: CommandCategory.ECONOMY,
  description: 'Tend your farm to harvest wheat, strawberries, melons, and golden apples',
  usage: 'farm',
  examples: ['farm'],
  limits: '3-minute cooldown',
  async execute(ctx) {
    await runGatherActivity(ctx, {
      skill: 'farming',
      toolType: 'hoe',
      actionName: 'farm',
      cooldownSec: 180,
      statKey: 'farms',
      dropTable: [
        { itemKey: 'wheat', weight: 40, countRange: [2, 4] },
        { itemKey: 'carrot', weight: 30, countRange: [1, 3] },
        { itemKey: 'crop', weight: 25, countRange: [1, 2] },
        { itemKey: 'strawberry', weight: 15, countRange: [1, 2] },
        { itemKey: 'corn', weight: 10, countRange: [1, 2] },
        { itemKey: 'grape', weight: 6, countRange: [1, 1] },
        { itemKey: 'melon', weight: 4, countRange: [1, 1] },
        { itemKey: 'golden_apple', weight: 2, countRange: [1, 1] },
        { itemKey: 'lotus', weight: 1, countRange: [1, 1] },
      ],
    });
  },
};

export const GambleCommand: Command = {
  name: 'gamble',
  aliases: ['bet', 'dicebet'],
  category: CommandCategory.ECONOMY,
  description: 'Gamble wallet coins in a high-stakes coin toss',
  usage: 'gamble <amount>',
  examples: ['gamble 100', 'gamble 500', 'gamble all'],
  inputs: 'Bet amount or "all"',
  limits: '10-second cooldown',
  async execute(ctx) {
    const state = loadState();
    const me = player(state, ctx);
    const value = parseAmount(ctx.args[0], me.wallet);

    if (!value || value <= 0 || value > me.wallet) {
      await ctx.reply(
        formatUsageError({
          command: 'gamble',
          reason: `Specify a valid bet amount (Wallet: ${money(me.wallet)}).`,
          examples: ['gamble 100', 'gamble 500'],
        })
      );
      return;
    }

    const cd = checkCooldown(me, 'gamble', 10);
    if (!cd.ready) {
      await ctx.reply(`⏳ You must wait ${formatDuration(cd.remainingSec)} before betting again.`);
      return;
    }

    const win = Math.random() < 0.49;
    me.wallet += win ? value : -value;
    const xpGain = win ? 25 : 5;
    const { leveledUp, newLevel } = addXp(me, xpGain);
    saveState(state);

    let msg = win
      ? `🎰 *JACKPOT!* You won *+${money(value)}*!\nWallet: ${money(me.wallet)} (+${xpGain} XP)`
      : `💸 *Bust!* You lost *-${money(value)}*.\nWallet: ${money(me.wallet)} (+${xpGain} XP)`;

    if (leveledUp) {
      msg += `\n\n🎉 *Level Up!* You reached Level ${newLevel}!`;
    }

    await ctx.reply(msg);
  },
};

export const RobCommand: Command = {
  name: 'rob',
  aliases: ['steal'],
  category: CommandCategory.ECONOMY,
  description: 'Attempt to sneakily pickpocket another player\'s wallet',
  usage: 'rob @user',
  examples: ['rob @user'],
  inputs: 'Mention target @user',
  limits: '10-minute cooldown',
  async execute(ctx) {
    const state = loadState();
    const me = player(state, ctx);
    const jid = targetJid(ctx);

    if (!jid || jid === me.jid) {
      await ctx.reply(
        formatUsageError({
          command: 'rob',
          reason: 'Mention a target player to rob.',
          examples: ['rob @user'],
        })
      );
      return;
    }

    const cd = checkCooldown(me, 'rob', 600);
    if (!cd.ready) {
      await ctx.reply(`⏳ You must wait *${formatDuration(cd.remainingSec)}* before attempting another robbery.`);
      return;
    }

    const other = targetPlayer(state, jid);
    if (other.wallet < 100) {
      await ctx.reply(`⚠️ ${targetName(state, jid)} has too little wallet cash (<100 coins) to rob.`);
      return;
    }

    const success = Math.random() < 0.40;
    if (success) {
      const stolen = Math.max(50, Math.min(other.wallet, Math.floor(other.wallet * (0.15 + Math.random() * 0.25))));
      other.wallet -= stolen;
      me.wallet += stolen;
      addXp(me, 45);
      saveState(state);
      await ctx.reply(`🥷 *Robbery Succeeded!* You swiped *${money(stolen)}* from *${targetName(state, jid)}*!`);
      return;
    }

    const fine = Math.min(me.wallet, 150);
    me.wallet -= fine;
    other.wallet += fine;
    addXp(me, 10);
    saveState(state);
    await ctx.reply(`🚨 *Caught by the Guards!* You failed and paid a fine of *${money(fine)}* to *${targetName(state, jid)}*.`);
  },
};

export const BossCommand: Command = {
  name: 'boss',
  aliases: ['bossfight', 'dungeon'],
  category: CommandCategory.ECONOMY,
  description: 'Challenge a terrifying Dungeon Titan for massive gold and boss trophies',
  usage: 'boss',
  examples: ['boss'],
  limits: '15-minute cooldown',
  async execute(ctx) {
    const state = loadState();
    const me = player(state, ctx);

    const cd = checkCooldown(me, 'boss', 900);
    if (!cd.ready) {
      await ctx.reply(`⏳ The dungeon gates are locked! You can challenge the boss in *${formatDuration(cd.remainingSec)}*.`);
      return;
    }

    const swordTier = me.tools?.sword || 0;
    const cLvl = skillLevel(me.skills.combat);
    const pLvl = levelForXp(me.xp);
    const hasPotion = (me.inventory.potion || 0) > 0;

    let combatScore = pLvl * 2 + cLvl * 3 + swordTier * 5;
    if (hasPotion) {
      combatScore += 8;
      addItem(me, 'potion', -1);
    }

    const requiredScore = 15 + Math.floor(Math.random() * 20);
    const success = combatScore >= requiredScore;

    if (!success) {
      addXp(me, 30, 'combat');
      saveState(state);
      await ctx.reply(
        `💀 *Defeat!* The Dungeon Titan overpowered you.\nScore: ${combatScore} vs Required: ${requiredScore}\n+30 Combat XP. Upgrade your sword or brew potions with .craft to defeat him!`
      );
      return;
    }

    const rewardCoins = 800 + Math.floor(Math.random() * 800) + swordTier * 200;
    const rewardXp = 200 + swordTier * 50;
    me.wallet += rewardCoins;
    addItem(me, 'boss_trophy', 1);
    me.stats ||= { hunts: 0, fishes: 0, mines: 0, farms: 0, bossWins: 0 };
    me.stats.bossWins = (me.stats.bossWins || 0) + 1;
    const { leveledUp, newLevel } = addXp(me, rewardXp, 'combat');
    saveState(state);

    let msg = `🏆 *VICTORY!* You vanquished the Dungeon Titan!\n\n• Loot: +*${money(rewardCoins)}*\n• XP: +*${rewardXp} Combat XP*\n• Trophy: 🏆 *1× Ancient Boss Trophy*`;
    if (leveledUp) {
      msg += `\n\n🎉 *Level Up!* You reached Level ${newLevel}!`;
    }

    await ctx.reply(msg);
  },
};

export const LeaderboardCommand: Command = {
  name: 'leaderboard',
  aliases: ['lb', 'top', 'rank'],
  category: CommandCategory.ECONOMY,
  description: 'View the global economy leaderboard rankings (wealth, level, hunt, fish, mine)',
  usage: 'leaderboard [wealth|level|hunt|fish|mine]',
  examples: ['leaderboard', 'leaderboard level', 'leaderboard fish'],
  inputs: 'Category (wealth, level, hunt, fish, mine)',
  async execute(ctx) {
    const state = loadState();
    const mode = (ctx.args[0] || 'wealth').toLowerCase();

    const scoreFn = (p: Player): number => {
      if (mode === 'level' || mode === 'xp') return p.xp;
      if (mode === 'hunt' || mode === 'hunting') return p.stats?.hunts || 0;
      if (mode === 'fish' || mode === 'fishing') return p.stats?.fishes || 0;
      if (mode === 'mine' || mode === 'mining') return p.stats?.mines || 0;
      if (mode === 'farm' || mode === 'farming') return p.stats?.farms || 0;
      return p.wallet + p.bank;
    };

    const players = Object.values(state.players).sort((a, b) => scoreFn(b) - scoreFn(a));
    if (!players.length) {
      await ctx.reply('📊 Leaderboard is currently empty.');
      return;
    }

    const myJid = userJid(ctx);
    const myRank = players.findIndex((p) => p.jid === myJid) + 1;

    const top10 = players.slice(0, 10).map((p, i) => {
      const rankBadge = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      const score = scoreFn(p);
      const valText = mode === 'level' || mode === 'xp'
        ? `Lvl ${levelForXp(p.xp)} (${p.xp.toLocaleString()} XP)`
        : mode === 'hunt' || mode === 'fish' || mode === 'mine' || mode === 'farm'
          ? `${score.toLocaleString()} times`
          : money(score);
      return `${rankBadge} *${p.name}* — ${valText}`;
    });

    const text = [
      `🏆 *Global Leaderboard (${mode.toUpperCase()})*`,
      `\n${top10.join('\n')}`,
      `\n📍 *Your Position:* Rank #${myRank || 'Unranked'} of ${players.length}`,
      `\n💡 _Categories: .leaderboard [wealth|level|hunt|fish|mine|farm]_`,
    ].join('\n');

    await ctx.reply(text);
  },
};

export const CraftCommand: Command = {
  name: 'craft',
  aliases: ['crafting', 'recipes'],
  category: CommandCategory.ECONOMY,
  description: 'Craft consumable items and gear from raw materials',
  usage: 'craft [item]',
  examples: ['craft', 'craft potion', 'craft petfood'],
  async execute(ctx) {
    const itemKey = (ctx.args[0] || '').toLowerCase();
    const state = loadState();
    const me = player(state, ctx);

    if (!itemKey || !RECIPES[itemKey]) {
      const recipesList = Object.entries(RECIPES).map(([prod, ing]) => {
        const prodDef = ITEMS[prod];
        const needStr = Object.entries(ing)
          .map(([mat, qty]) => `${qty}× ${ITEMS[mat]?.name || mat}`)
          .join(', ');
        return `• ${prodDef?.emoji || '🔨'} *${prodDef?.name || prod}* (\`${prod}\`):\n   Requires: ${needStr}`;
      });

      await ctx.reply(`⚒️ *Crafting Workshop*\n\n${recipesList.join('\n\n')}\n\n👉 Craft with: \`.craft <item_code>\` (e.g. \`.craft potion\`)`);
      return;
    }

    const recipe = RECIPES[itemKey];
    for (const [mat, needQty] of Object.entries(recipe)) {
      const owned = me.inventory[mat] || 0;
      if (owned < needQty) {
        const matDef = ITEMS[mat];
        await ctx.reply(
          formatFailed({
            title: 'Crafting',
            reason: `Missing ingredients. Need ${needQty}× ${matDef?.name || mat} (You have ${owned}).`,
          })
        );
        return;
      }
    }

    for (const [mat, needQty] of Object.entries(recipe)) {
      addItem(me, mat, -needQty);
    }
    addItem(me, itemKey, 1);
    addXp(me, 50, 'crafting');
    saveState(state);

    const resultDef = ITEMS[itemKey];
    await ctx.reply(`⚒️ *Crafting Complete!*\n\nCreated *1× ${resultDef?.emoji || ''} ${resultDef?.name || itemKey}* (+50 Crafting XP).`);
  },
};

export const PetCommand: Command = {
  name: 'pet',
  aliases: ['pets'],
  category: CommandCategory.ECONOMY,
  description: 'Adopt, feed, and care for a pet companion',
  usage: 'pet <adopt|feed|status> [name]',
  examples: ['pet adopt Shadow', 'pet feed', 'pet status'],
  async execute(ctx) {
    const action = (ctx.args[0] || 'status').toLowerCase();
    const state = loadState();
    const me = player(state, ctx);

    if (action === 'adopt') {
      if (me.pet) {
        await ctx.reply(`You already have a pet named ${me.pet.name}!`);
        return;
      }
      const petName = ctx.args.slice(1).join(' ').trim() || 'Buddy';
      me.pet = { name: petName, type: 'Wolf Companion', hunger: 80, xp: 0 };
      saveState(state);
      await ctx.reply(`🐾 *New Pet Adopted!*\n\nWelcome your companion *${petName}*! Feed them with \`.pet feed\` to level them up.`);
      return;
    }

    if (!me.pet) {
      await ctx.reply(`⚠️ You don't have a pet yet! Use \`.pet adopt <name>\` to adopt one.`);
      return;
    }

    if (action === 'feed') {
      if ((me.inventory.petfood || 0) < 1) {
        await ctx.reply(`⚠️ You have no pet food! Buy some from \`.shop buy petfood\`.`);
        return;
      }
      addItem(me, 'petfood', -1);
      me.pet.hunger = Math.min(100, me.pet.hunger + 30);
      me.pet.xp += 25;
      saveState(state);
      await ctx.reply(`🍖 Fed *${me.pet.name}*! Hunger is now ${me.pet.hunger}/100 (+25 Pet XP).`);
      return;
    }

    await ctx.reply(
      `🐾 *Pet Status: ${me.pet.name}*\n• Species: ${me.pet.type}\n• Level: ${skillLevel(me.pet.xp)} (${me.pet.xp} XP)\n• Hunger: ${me.pet.hunger}/100`
    );
  },
};

export const ClanCommand: Command = {
  name: 'clan',
  aliases: ['guild'],
  category: CommandCategory.ECONOMY,
  description: 'Create, join, or manage an adventurer clan',
  usage: 'clan <create|join|leave|info|kick> [name|@user]',
  examples: ['clan create Valkyrie', 'clan join Valkyrie', 'clan info', 'clan leave'],
  async execute(ctx) {
    const action = (ctx.args[0] || 'info').toLowerCase();
    const name = ctx.args.slice(1).join(' ').trim().replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 30);
    const state = loadState();
    const me = player(state, ctx);

    if (action === 'create') {
      if (!name) {
        await ctx.reply('Usage: .clan create <clan_name>');
        return;
      }
      const key = name.toLowerCase();
      if (me.clan || state.clans[key]) {
        await ctx.reply(me.clan ? 'Leave your existing clan first.' : 'A clan with that name already exists.');
        return;
      }
      state.clans[key] = { name, ownerJid: me.jid, members: [me.jid] };
      me.clan = key;
      saveState(state);
      await ctx.reply(`🛡️ *Clan Created:* **${name}**! Invite members with \`.clan join ${name}\`.`);
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
      await ctx.reply(`🛡️ Joined clan **${clan.name}**!`);
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
      await ctx.reply('🛡️ You left your clan.');
      return;
    }

    const clan = state.clans[name.toLowerCase()] || (me.clan ? state.clans[me.clan] : undefined);
    if (!clan) {
      await ctx.reply('No clan found. Create one with `.clan create <name>` or join with `.clan join <name>`.');
      return;
    }

    await ctx.reply(`🛡️ *Clan: ${clan.name}*\n• Leader: ${targetName(state, clan.ownerJid)}\n• Total Members: ${clan.members.length}`);
  },
};

export const CooldownsCommand: Command = {
  name: 'cooldowns',
  aliases: ['cd', 'timers', 'cooldown'],
  category: CommandCategory.ECONOMY,
  description: 'Check all remaining activity cooldown timers and available actions',
  usage: 'cooldowns',
  examples: ['cooldowns', 'cd'],
  async execute(ctx) {
    const state = loadState();
    const me = player(state, ctx);
    const now = Math.floor(Date.now() / 1000);

    const getStatus = (action: string, cdSec: number) => {
      const last = me.cooldowns?.[action] || 0;
      const elapsed = now - last;
      if (elapsed >= cdSec) return '✅ *Ready*';
      return `⏳ *${formatDuration(cdSec - elapsed)} remaining*`;
    };

    const dailyStatus = me.lastDaily === today() ? '⏳ *Claimed (Resets at 00:00 UTC)*' : '✅ *Ready to claim! (.daily)*';

    const lines = [
      `⏱️ *Activity Cooldowns: ${me.name}*`,
      `\n🎁 *Daily Bonus:* ${dailyStatus}`,
      `🏹 *Hunting (.hunt):* ${getStatus('hunt', 180)}`,
      `🎣 *Fishing (.fish):* ${getStatus('fish', 180)}`,
      `⛏️ *Mining (.mine):* ${getStatus('mine', 180)}`,
      `🌾 *Farming (.farm):* ${getStatus('farm', 180)}`,
      `💀 *Dungeon Boss (.boss):* ${getStatus('boss', 900)}`,
      `🥷 *Robbery (.rob):* ${getStatus('rob', 600)}`,
      `🎰 *Gamble (.gamble):* ${getStatus('gamble', 10)}`,
      `\n💡 _Tip: Upgrade your tools with .upgrade to increase rewards!_`,
    ];

    await ctx.reply(lines.join('\n'));
  },
};

export const StatsCommand: Command = {
  name: 'stats',
  aliases: ['stat', 'rpgstats', 'gamestats'],
  category: CommandCategory.ECONOMY,
  description: 'View in-depth RPG lifetime statistics and achievements',
  usage: 'stats [@user]',
  examples: ['stats', 'rpgstats', 'stats @user'],
  async execute(ctx) {
    const state = loadState();
    const target = targetJid(ctx);
    const p = target ? targetPlayer(state, target) : player(state, ctx);

    const lvl = levelForXp(p.xp);
    const prevLvlXp = (lvl - 1) * (lvl - 1) * 100;
    const nextLvlXp = lvl * lvl * 100;
    const currentProgress = Math.max(0, p.xp - prevLvlXp);
    const totalRequired = Math.max(1, nextLvlXp - prevLvlXp);
    const pct = Math.min(100, Math.floor((currentProgress / totalRequired) * 100));

    const totalBars = 10;
    const filledBars = Math.floor((pct / 100) * totalBars);
    const progressBar = '█'.repeat(filledBars) + '░'.repeat(totalBars - filledBars);

    const totalItems = Object.values(p.inventory).reduce((acc, c) => acc + c, 0);

    const lines = [
      `📊 *RPG Statistics: ${p.name}*`,
      `⭐ *Level:* ${lvl} (${p.xp.toLocaleString()} XP)`,
      `📈 *Progress:* [${progressBar}] ${pct}% (${currentProgress.toLocaleString()} / ${totalRequired.toLocaleString()} XP to Lvl ${lvl + 1})`,
      `\n💰 *Finances:*`,
      `• Wallet: ${money(p.wallet)}`,
      `• Bank: ${money(p.bank)}`,
      `• Total Net Worth: ${money(p.wallet + p.bank)}`,
      `• Inventory Capacity: ${totalItems.toLocaleString()} items (${Object.keys(p.inventory).length} types)`,
      `\n🏹 *Lifetime Activities:*`,
      `• Hunting Expeditions: ${(p.stats?.hunts || 0).toLocaleString()}`,
      `• Fishing Catches: ${(p.stats?.fishes || 0).toLocaleString()}`,
      `• Cavern Excavations: ${(p.stats?.mines || 0).toLocaleString()}`,
      `• Farm Harvests: ${(p.stats?.farms || 0).toLocaleString()}`,
      `• Dungeon Boss Triumphs: ${(p.stats?.bossWins || 0).toLocaleString()}`,
      p.pet ? `\n🐾 *Companion:* ${p.pet.name} (Lvl ${skillLevel(p.pet.xp)} ${p.pet.type}, Hunger: ${p.pet.hunger}/100)` : undefined,
    ].filter(Boolean);

    await ctx.reply(lines.join('\n'));
  },
};

export const QuestsCommand: Command = {
  name: 'quests',
  aliases: ['quest', 'tasks', 'dailyquests'],
  category: CommandCategory.ECONOMY,
  description: 'View and claim rewards for daily adventurer quests',
  usage: 'quests [claim <all|quest_id>]',
  examples: ['quests', 'quests claim 1', 'quests claim all'],
  async execute(ctx) {
    const state = loadState();
    const me = player(state, ctx);

    me.quests ||= { date: today(), hunts: 0, fishes: 0, mines: 0, farms: 0, boss: 0, claimed: [] };
    if (me.quests.date !== today()) {
      me.quests = { date: today(), hunts: 0, fishes: 0, mines: 0, farms: 0, boss: 0, claimed: [] };
    }

    const questList = [
      { id: '1', title: 'Wild Game Tracker', goal: 'Hunt 3 times', count: me.quests.hunts, target: 3, rewardCoins: 350, rewardXp: 75 },
      { id: '2', title: 'Deep River Angler', goal: 'Fish 3 times', count: me.quests.fishes, target: 3, rewardCoins: 350, rewardXp: 75 },
      { id: '3', title: 'Subterranean Miner', goal: 'Mine 3 times', count: me.quests.mines, target: 3, rewardCoins: 350, rewardXp: 75 },
      { id: '4', title: 'Abundant Harvest', goal: 'Farm 3 times', count: me.quests.farms, target: 3, rewardCoins: 350, rewardXp: 75 },
      { id: '5', title: 'Titan Vanquisher', goal: 'Defeat 1 Dungeon Boss', count: me.quests.boss, target: 1, rewardCoins: 800, rewardXp: 200 },
    ];

    const action = (ctx.args[0] || '').toLowerCase();
    const targetId = (ctx.args[1] || '').toLowerCase();

    if (action === 'claim') {
      let totalCoins = 0;
      let totalXp = 0;
      const claimedTitles: string[] = [];

      for (const q of questList) {
        if (targetId && targetId !== 'all' && targetId !== q.id) continue;
        if (me.quests.claimed.includes(q.id)) continue;
        if (q.count >= q.target) {
          me.quests.claimed.push(q.id);
          totalCoins += q.rewardCoins;
          totalXp += q.rewardXp;
          claimedTitles.push(`• *${q.title}:* +${money(q.rewardCoins)}, +${q.rewardXp} XP`);
        }
      }

      if (!totalCoins) {
        await ctx.reply('⚠️ No completed unclaimed quests found.');
        return;
      }

      me.wallet += totalCoins;
      const { leveledUp, newLevel } = addXp(me, totalXp);
      logTransaction(me, 'quest', totalCoins, `Claimed ${claimedTitles.length} daily quests`);
      saveState(state);

      let msg = `📜 *Quests Claimed!*\n\n${claimedTitles.join('\n')}\n\n*Total:* +${money(totalCoins)}, +${totalXp} XP\nWallet: ${money(me.wallet)}`;
      if (leveledUp) {
        msg += `\n\n🎉 *Level Up!* You advanced to Level ${newLevel}!`;
      }
      await ctx.reply(msg);
      return;
    }

    const rendered = questList.map((q) => {
      const done = q.count >= q.target;
      const claimed = me.quests?.claimed.includes(q.id);
      const statusIcon = claimed ? '🎁 *[CLAIMED]*' : done ? '✨ *[COMPLETED - .quests claim ' + q.id + ']*' : `⏳ [${q.count}/${q.target}]`;
      return `*#${q.id}. ${q.title}*\n• Objective: ${q.goal} ${statusIcon}\n• Reward: ${money(q.rewardCoins)} + ${q.rewardXp} XP`;
    });

    const text = [
      `📜 *Daily Quest Board (${today()})*`,
      `\n${rendered.join('\n\n')}`,
      `\n💡 _Claim completed quests with: \`.quests claim <id>\` or \`.quests claim all\`_`,
    ].join('\n');

    await ctx.reply(text);
  },
};

export const BuyCommand: Command = {
  name: 'buy',
  aliases: ['purchase'],
  category: CommandCategory.ECONOMY,
  description: 'Quickly buy items directly from the village shop',
  usage: 'buy <item> [qty]',
  examples: ['buy bait 5', 'buy seed 10', 'buy potion 2', 'buy elixir 1'],
  inputs: 'Item code and quantity',
  async execute(ctx) {
    ctx.args = ['buy', ...ctx.args];
    await ShopCommand.execute(ctx);
  },
};

export const HistoryCommand: Command = {
  name: 'history',
  aliases: ['transactions', 'ecohistory', 'trans'],
  category: CommandCategory.ECONOMY,
  description: 'View your recent economic transactions and activity history',
  usage: 'history',
  examples: ['history', 'transactions'],
  async execute(ctx) {
    const state = loadState();
    const me = player(state, ctx);

    if (!me.history || !me.history.length) {
      await ctx.reply(`📜 *Transaction History: ${me.name}*\n\nNo recent transactions recorded.`);
      return;
    }

    const lines = me.history.slice(0, 10).map((t, idx) => {
      const timeStr = new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const sign = t.amount >= 0 ? '+' : '';
      return `${idx + 1}. [${timeStr}] *${t.description}* (${sign}${money(t.amount)})`;
    });

    await ctx.reply(`📜 *Recent Transactions: ${me.name}*\n\n${lines.join('\n')}\n\nCurrent Wallet: *${money(me.wallet)}* | Bank: *${money(me.bank)}*`);
  },
};

export const EconomyCommands: Command[] = [
  EconomyProfileCommand,
  BalanceCommand,
  DailyCommand,
  BankCommand,
  TransferCommand,
  ShopCommand,
  BuyCommand,
  InventoryCommand,
  SellCommand,
  UpgradeCommand,
  HuntCommand,
  FishCommand,
  MineCommand,
  FarmCommand,
  GambleCommand,
  RobCommand,
  BossCommand,
  LeaderboardCommand,
  CooldownsCommand,
  StatsCommand,
  QuestsCommand,
  HistoryCommand,
  CraftCommand,
  PetCommand,
  ClanCommand,
];

export default EconomyCommands;
