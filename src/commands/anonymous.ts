import type { BotContext, Command } from '../types';
import { CommandCategory } from '../types';

type Profile = {
  jid: string;
  chatJid: string;
  name: string;
  bio: string;
  updatedAt: number;
};

type Pair = {
  a: string;
  b: string;
};

// ponytail: in-memory social state is enough for casual public-bot features; persist/moderate if this becomes a real community system.
const anonymousQueue: string[] = [];
const anonymousPairs = new Map<string, Pair>();
const profiles = new Map<string, Profile>();

function command(name: string, aliases: string[], description: string, usage: string, execute: Command['execute']): Command {
  return { name, aliases, category: CommandCategory.ANONYMOUS, description, usage, execute };
}

function userJid(ctx: BotContext): string {
  return ctx.sender.jid || `${ctx.sender.phoneNumber}@s.whatsapp.net`;
}

function chatJid(ctx: BotContext): string {
  return ctx.message.key.remoteJid || ctx.sender.chatJid || userJid(ctx);
}

function mentionedJid(ctx: BotContext): string | null {
  return ctx.message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || null;
}

function numberJid(value?: string): string | null {
  const phone = value?.replace(/\D/g, '');
  return phone && phone.length >= 6 ? `${phone}@s.whatsapp.net` : null;
}

function displayName(ctx: BotContext): string {
  return ctx.sender.displayName || ctx.sender.phoneNumber || 'Someone';
}

function profile(ctx: BotContext, bio = ''): Profile {
  const jid = userJid(ctx);
  const current = profiles.get(jid);
  const next = {
    jid,
    chatJid: chatJid(ctx),
    name: displayName(ctx),
    bio: bio.trim() || current?.bio || 'No bio yet.',
    updatedAt: Date.now(),
  };
  profiles.set(jid, next);
  return next;
}

function removeFromQueue(jid: string): void {
  const index = anonymousQueue.indexOf(jid);
  if (index >= 0) anonymousQueue.splice(index, 1);
}

async function leaveAnonymous(ctx: BotContext, silent = false): Promise<void> {
  const jid = userJid(ctx);
  const pair = anonymousPairs.get(jid);
  removeFromQueue(jid);

  if (pair) {
    const partner = pair.a === jid ? pair.b : pair.a;
    anonymousPairs.delete(jid);
    anonymousPairs.delete(partner);
    const target = profiles.get(partner)?.chatJid || partner;
    await ctx.socket.sendMessage(target, { text: 'Anonymous chat ended.' }).catch(() => undefined);
  }

  if (!silent) await ctx.reply('Anonymous chat stopped.');
}

async function joinAnonymous(ctx: BotContext): Promise<void> {
  const me = profile(ctx);
  const waiting = anonymousQueue.find((jid) => jid !== me.jid);

  if (anonymousPairs.has(me.jid)) {
    await ctx.reply('You are already in anonymous chat. Use .anonymous send <message> or .anonymous stop.');
    return;
  }

  if (!waiting) {
    if (!anonymousQueue.includes(me.jid)) anonymousQueue.push(me.jid);
    await ctx.reply('Waiting for an anonymous chat partner.');
    return;
  }

  removeFromQueue(waiting);
  const pair = { a: me.jid, b: waiting };
  anonymousPairs.set(me.jid, pair);
  anonymousPairs.set(waiting, pair);
  await ctx.reply('Anonymous partner found. Use .anonymous send <message>.');
  await ctx.socket.sendMessage(profiles.get(waiting)?.chatJid || waiting, {
    text: 'Anonymous partner found. Use .anonymous send <message>.',
  });
}

function splitPipe(raw = ''): [string, string] {
  const index = raw.indexOf('|');
  return index >= 0 ? [raw.slice(0, index).trim(), raw.slice(index + 1).trim()] : ['', raw.trim()];
}

function matchScore(a: string, b: string): number {
  const left = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const right = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  let score = 0;
  for (const token of left) if (right.has(token)) score += 25;
  return Math.min(100, score + hash(`${a}|${b}`) % 51);
}

function hash(value: string): number {
  let result = 0;
  for (const char of value) result = (result * 31 + char.charCodeAt(0)) >>> 0;
  return result;
}

function mention(jid: string): string {
  return `@${jid.split('@')[0].split(':')[0]}`;
}

async function sendMentionList(ctx: BotContext, title: string, rows: Profile[]): Promise<void> {
  if (!rows.length) {
    await ctx.reply('No profiles found yet. Use .friendfinder <bio> first.');
    return;
  }

  await ctx.socket.sendMessage(chatJid(ctx), {
    text: `${title}\n${rows.map((item, index) => `${index + 1}. ${mention(item.jid)} - ${item.bio}`).join('\n')}`,
    mentions: rows.map((item) => item.jid),
  });
}

export const AnonymousChatCommand = command('anonymous', ['anon', 'anonchat'], 'Anonymous command-based chat pairing', 'anonymous <start|send|next|stop> [message]', async (ctx) => {
  const action = (ctx.args[0] || 'start').toLowerCase();
  profile(ctx);

  if (action === 'start') {
    await joinAnonymous(ctx);
    return;
  }

  if (action === 'stop') {
    await leaveAnonymous(ctx);
    return;
  }

  if (action === 'next') {
    await leaveAnonymous(ctx, true);
    await joinAnonymous(ctx);
    return;
  }

  if (action === 'send') {
    const text = (ctx.rawArgs || '').replace(/^send\s+/i, '').trim();
    const pair = anonymousPairs.get(userJid(ctx));
    if (!pair || !text) {
      await ctx.reply('Usage: .anonymous send <message>');
      return;
    }

    const partner = pair.a === userJid(ctx) ? pair.b : pair.a;
    await ctx.socket.sendMessage(profiles.get(partner)?.chatJid || partner, { text: `Anonymous: ${text}` });
    await ctx.reply('Sent anonymously.');
    return;
  }

  await ctx.reply('Usage: .anonymous <start|send|next|stop> [message]');
});

export const ConfessCommand = command('confess', ['confession'], 'Post an anonymous confession to this chat', 'confess <text>', async (ctx) => {
  const text = (ctx.rawArgs || '').trim();
  if (!text) {
    await ctx.reply('Usage: .confess <text>');
    return;
  }

  await ctx.socket.sendMessage(chatJid(ctx), { text: `Anonymous confession:\n${text}` });
});

export const MenfessCommand = command('menfess', ['menfes', 'fess'], 'Send an anonymous message to a mentioned user or number', 'menfess @user | <message>', async (ctx) => {
  const [targetText, messageFromPipe] = splitPipe(ctx.rawArgs);
  const target = mentionedJid(ctx) || numberJid(targetText || ctx.args[0]);
  const message = targetText ? messageFromPipe : ctx.args.slice(1).join(' ');

  if (!target || !message) {
    await ctx.reply('Usage: .menfess @user | <message>\nOr: .menfess <number> | <message>');
    return;
  }

  await ctx.socket.sendMessage(target, { text: `Menfess:\n${message}` });
  await ctx.reply('Menfess sent.');
});

export const FriendFinderCommand = command('friendfinder', ['friend', 'findfriend'], 'Register or browse friend finder profiles', 'friendfinder [bio|list|off]', async (ctx) => {
  const action = (ctx.args[0] || '').toLowerCase();
  const jid = userJid(ctx);

  if (action === 'off') {
    profiles.delete(jid);
    await ctx.reply('Friend finder profile removed.');
    return;
  }

  if (action === 'list') {
    await sendMentionList(
      ctx,
      'Friend finder',
      [...profiles.values()].filter((item) => item.jid !== jid).slice(0, 8)
    );
    return;
  }

  const bio = (ctx.rawArgs || '').trim();
  if (!bio) {
    await ctx.reply('Usage: .friendfinder <short bio>\nUse .friendfinder list to browse, .friendfinder off to opt out.');
    return;
  }

  profile(ctx, bio);
  await ctx.reply('Friend finder profile saved. Use .friendfinder list.');
});

export const MatchmakingCommand = command('matchmaking', ['matchmake', 'carijodoh'], 'Find the closest matching friend profile', 'matchmaking [bio]', async (ctx) => {
  const me = profile(ctx, (ctx.rawArgs || '').trim());
  const candidates = [...profiles.values()].filter((item) => item.jid !== me.jid);
  const best = candidates
    .map((item) => ({ item, score: matchScore(me.bio, item.bio) }))
    .sort((a, b) => b.score - a.score)[0];

  if (!best) {
    await ctx.reply('No match found yet. Ask people to use .friendfinder <bio>.');
    return;
  }

  await ctx.socket.sendMessage(chatJid(ctx), {
    text: `Match found: ${mention(best.item.jid)}\nScore: ${best.score}%\nBio: ${best.item.bio}`,
    mentions: [best.item.jid],
  });
});

export const PartnerCommand = command('partner', ['pair', 'pasangan'], 'Pair with a mentioned user or random friend profile', 'partner [@user|number|random]', async (ctx) => {
  const target = mentionedJid(ctx) || numberJid(ctx.args[0]) || [...profiles.keys()].filter((jid) => jid !== userJid(ctx))[hash(userJid(ctx)) % Math.max(1, profiles.size - 1)];

  if (!target) {
    await ctx.reply('Usage: .partner @user\nOr register people with .friendfinder <bio> first.');
    return;
  }

  const score = hash(`${userJid(ctx)}:${target}`) % 101;
  await ctx.socket.sendMessage(chatJid(ctx), {
    text: `${displayName(ctx)} x ${mention(target)}\nPair score: ${score}%`,
    mentions: [target],
  });
});

export const AnonymousCommands = [
  AnonymousChatCommand,
  ConfessCommand,
  MenfessCommand,
  FriendFinderCommand,
  MatchmakingCommand,
  PartnerCommand,
];
