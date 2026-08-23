import type { BotContext, Command } from '../types';
import { CommandCategory } from '../types';
import { formatUsageError, formatFailed, formatSuccess } from '../core/response-formatter';

export type Profile = {
  jid: string;
  chatJid: string;
  name: string;
  bio: string;
  updatedAt: number;
};

export type Pair = {
  a: string;
  b: string;
};

export interface MenfessEntry {
  id: string;
  senderJid: string;
  senderChatJid: string;
  senderAlias: string;
  targetJid: string;
  message: string;
  createdAt: number;
  replies: Array<{ fromSender: boolean; text: string; time: number }>;
}

const anonymousQueue: string[] = [];
const anonymousPairs = new Map<string, Pair>();
const profiles = new Map<string, Profile>();
const menfessTunnels = new Map<string, MenfessEntry>();

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

function splitPipe(raw = ''): [string, string] {
  const index = raw.indexOf('|');
  return index >= 0 ? [raw.slice(0, index).trim(), raw.slice(index + 1).trim()] : ['', raw.trim()];
}

function menfessId(): string {
  return `MFS-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
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

async function leaveAnonymous(ctx: BotContext, silent = false): Promise<void> {
  const jid = userJid(ctx);
  const pair = anonymousPairs.get(jid);
  removeFromQueue(jid);

  if (pair) {
    const partner = pair.a === jid ? pair.b : pair.a;
    anonymousPairs.delete(jid);
    anonymousPairs.delete(partner);
    const target = profiles.get(partner)?.chatJid || partner;
    await ctx.socket.sendMessage(target, { text: '📴 *Anonymous Partner Left:* The anonymous session has ended.' }).catch(() => undefined);
  }

  if (!silent) await ctx.reply('📴 You left the anonymous queue/chat.');
}

async function joinAnonymous(ctx: BotContext): Promise<void> {
  const me = profile(ctx);
  const waiting = anonymousQueue.find((jid) => jid !== me.jid);

  if (anonymousPairs.has(me.jid)) {
    await ctx.reply('⚠️ You are already in an active anonymous chat. Type `.anonymous send <message>` to chat or `.anonymous stop` to leave.');
    return;
  }

  if (!waiting) {
    if (!anonymousQueue.includes(me.jid)) anonymousQueue.push(me.jid);
    await ctx.reply('⏳ *Searching for an anonymous partner...*\nPlease wait while someone connects. (Type `.anonymous stop` to cancel)');
    return;
  }

  removeFromQueue(waiting);
  const pair = { a: me.jid, b: waiting };
  anonymousPairs.set(me.jid, pair);
  anonymousPairs.set(waiting, pair);

  const matchedText = '🎉 *Anonymous Partner Found!*\nYou are now connected in a secret 1-on-1 session.\n\n💬 *Commands:*' +
    '\n• `.anonymous send <message>` : Send a message' +
    '\n• `.anonymous next` : Skip to next partner' +
    '\n• `.anonymous stop` : Disconnect';

  await ctx.reply(matchedText);
  await ctx.socket.sendMessage(profiles.get(waiting)?.chatJid || waiting, {
    text: matchedText,
  });
}

// ----------------------------------------------------
// COMMANDS
// ----------------------------------------------------

export const AnonymousChatCommand: Command = {
  name: 'anonymous',
  aliases: ['anon', 'anonchat'],
  category: CommandCategory.ANONYMOUS,
  description: 'Anonymous 1-on-1 chat matchmaking across WhatsApp users',
  usage: 'anonymous <start|send|next|stop> [message]',
  examples: [
    'anonymous start',
    'anonymous send Hey there!',
    'anonymous next',
    'anonymous stop',
  ],
  inputs: 'Subcommand and optional text message',
  async execute(ctx) {
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
        await ctx.reply(
          formatUsageError({
            command: 'anonymous',
            customUsage: 'anonymous send <message>',
            reason: !pair ? 'You are not currently in an active anonymous session.' : 'Message cannot be empty.',
            examples: ['anonymous send Hello!', 'anonymous start'],
          })
        );
        return;
      }

      const partner = pair.a === userJid(ctx) ? pair.b : pair.a;
      await ctx.socket.sendMessage(profiles.get(partner)?.chatJid || partner, { text: `🎭 *Anonymous Partner:*\n${text}` });
      await ctx.reply('✅ _Sent anonymously._');
      return;
    }

    await ctx.reply(
      formatUsageError({
        command: 'anonymous',
        examples: ['anonymous start', 'anonymous send Hello', 'anonymous stop'],
        hint: 'Actions: start (find partner), send (chat), next (skip partner), stop (disconnect).',
      })
    );
  },
};

export const ConfessCommand: Command = {
  name: 'confess',
  aliases: ['confession', 'secretpost'],
  category: CommandCategory.ANONYMOUS,
  description: 'Post an anonymous confession to this chat or group',
  usage: 'confess <confession_text>',
  examples: ['confess I secretly love listening to 80s synthwave while coding.'],
  inputs: 'Confession text',
  async execute(ctx) {
    const text = (ctx.rawArgs || ctx.args.join(' ')).trim();
    if (!text) {
      await ctx.reply(
        formatUsageError({
          command: 'confess',
          reason: 'Confession message cannot be empty.',
          examples: ['confess I accidentally dropped my ice cream today.'],
          hint: 'Your name will NOT be revealed in the posted message.',
        })
      );
      return;
    }

    const confId = `CONFESS-${Math.floor(100 + Math.random() * 900)}`;
    const confessionCard = [
      `🤫 *ANONYMOUS CONFESSION (#${confId})*`,
      `━━━━━━━━━━━━━━━━━━━━━━`,
      `"${text}"`,
      `━━━━━━━━━━━━━━━━━━━━━━`,
      `⏱️ _Posted on ${new Date().toLocaleTimeString()} • Sender identity hidden_`,
    ].join('\n');

    await ctx.socket.sendMessage(chatJid(ctx), { text: confessionCard });
  },
};

export const MenfessCommand: Command = {
  name: 'menfess',
  aliases: ['menfes', 'fess', 'secretmsg'],
  category: CommandCategory.ANONYMOUS,
  description: 'Send a secret anonymous message to any WhatsApp contact with a private reply tunnel',
  usage: 'menfess <@user|number> | <message> [--from <alias>]',
  examples: [
    'menfess 628123456789 | Hey, great work on the project today!',
    'menfess @user | You are an awesome friend! --from Secret Admirer',
  ],
  inputs: 'Recipient tag/phone number, separator "|", and message text',
  async execute(ctx) {
    const rawArgs = ctx.rawArgs || ctx.args.join(' ');
    const [targetPart, messagePart] = splitPipe(rawArgs);

    let alias = 'Secret Admirer';
    let messageText = messagePart;

    const aliasMatch = messagePart.match(/--from\s+(.+)$/i);
    if (aliasMatch) {
      alias = aliasMatch[1].trim();
      messageText = messagePart.replace(/--from\s+.+$/i, '').trim();
    }

    const target = mentionedJid(ctx) || numberJid(targetPart || ctx.args[0]);
    const message = (targetPart ? messageText : ctx.args.slice(1).join(' ')).trim();

    if (!target || !message) {
      await ctx.reply(
        formatUsageError({
          command: 'menfess',
          customUsage: 'menfess <@user|phone_number> | <message> [--from <alias>]',
          reason: !target ? 'Target recipient is missing or invalid.' : 'Menfess message cannot be empty.',
          examples: [
            'menfess 628123456789 | Keep up the amazing work! --from A Friend',
            'menfess @user | Happy Birthday! 🎂',
          ],
          hint: 'Remember to separate the recipient and message with a vertical bar "|".',
        })
      );
      return;
    }

    const id = menfessId();
    const entry: MenfessEntry = {
      id,
      senderJid: userJid(ctx),
      senderChatJid: chatJid(ctx),
      senderAlias: alias,
      targetJid: target,
      message,
      createdAt: Date.now(),
      replies: [],
    };

    menfessTunnels.set(id, entry);

    const recipientCard = [
      `💌 *NEW SECRET MENFESS MESSAGE!*`,
      `━━━━━━━━━━━━━━━━━━━━━━`,
      `• *Menfess ID:* \`${id}\``,
      `• *From:* 🕵️ *${alias}*`,
      `• *Time:* ⏱️ ${new Date().toLocaleTimeString()}`,
      `\n💬 *Message:*`,
      `"${message}"`,
      `━━━━━━━━━━━━━━━━━━━━━━`,
      `\n↩️ *How to Reply Secretly:*`,
      `Type \`.menfessreply ${id} <your reply message>\` to send a response back anonymously!`,
    ].join('\n');

    try {
      await ctx.socket.sendMessage(target, { text: recipientCard });

      await ctx.reply(
        formatSuccess({
          title: 'Secret Menfess Delivered!',
          fields: {
            'Menfess ID': id,
            'Sender Alias': alias,
            'Status': 'Delivered privately to recipient',
          },
          footer: `When they reply using \`.menfessreply ${id}\`, you will receive their message here!`,
        })
      );
    } catch {
      await ctx.reply(
        formatFailed({
          title: 'Menfess Delivery',
          reason: 'Could not deliver message to the recipient phone number. Verify the number is on WhatsApp.',
        })
      );
    }
  },
};

export const MenfessReplyCommand: Command = {
  name: 'menfessreply',
  aliases: ['replymenfess', 'fessreply'],
  category: CommandCategory.ANONYMOUS,
  description: 'Reply to a received secret menfess message via its private tunnel',
  usage: 'menfessreply <menfess_id> <reply_message>',
  examples: ['menfessreply MFS-A1B2 Thank you so much! 😊'],
  inputs: 'Menfess ID and reply message',
  async execute(ctx) {
    const id = (ctx.args[0] || '').toUpperCase().trim();
    const replyText = ctx.args.slice(1).join(' ').trim();

    if (!id || !replyText) {
      await ctx.reply(
        formatUsageError({
          command: 'menfessreply',
          reason: 'Menfess ID and reply message are required.',
          examples: ['menfessreply MFS-7X9B Aww, thank you!'],
        })
      );
      return;
    }

    const tunnel = menfessTunnels.get(id);
    if (!tunnel) {
      await ctx.reply(
        formatFailed({
          title: 'Menfess Reply',
          reason: `Menfess tunnel "${id}" not found or expired.`,
        })
      );
      return;
    }

    const isOriginalSender = userJid(ctx) === tunnel.senderJid;
    const destinationJid = isOriginalSender ? tunnel.targetJid : tunnel.senderChatJid;
    const senderRole = isOriginalSender ? `🕵️ ${tunnel.senderAlias}` : 'Recipient';

    tunnel.replies.push({
      fromSender: isOriginalSender,
      text: replyText,
      time: Date.now(),
    });

    const forwardText = [
      `💌 *Secret Menfess Reply (#${tunnel.id})*`,
      `• *From:* ${senderRole}`,
      `• *Time:* ⏱️ ${new Date().toLocaleTimeString()}`,
      `\n💬 *Reply:*`,
      `"${replyText}"`,
      `━━━━━━━━━━━━━━━━━━━━━━`,
      `↩️ _Continue replying with: \`.menfessreply ${tunnel.id} <message>\`_`,
    ].join('\n');

    await ctx.socket.sendMessage(destinationJid, { text: forwardText });

    await ctx.reply(
      formatSuccess({
        title: 'Reply Forwarded!',
        fields: {
          'Menfess ID': tunnel.id,
          'Status': 'Delivered secretly through tunnel',
        },
      })
    );
  },
};

export const FriendFinderCommand: Command = {
  name: 'friendfinder',
  aliases: ['friend', 'findfriend', 'cari-teman'],
  category: CommandCategory.ANONYMOUS,
  description: 'Register a public friend profile or browse other members',
  usage: 'friendfinder [bio|list|off]',
  examples: [
    'friendfinder Love anime, gaming, and TypeScript!',
    'friendfinder list',
    'friendfinder off',
  ],
  inputs: 'Short bio, "list" keyword, or "off" to delete',
  async execute(ctx) {
    const action = (ctx.args[0] || '').toLowerCase();
    const jid = userJid(ctx);

    if (action === 'off') {
      profiles.delete(jid);
      await ctx.reply('Friend finder profile removed.');
      return;
    }

    if (action === 'list') {
      const rows = [...profiles.values()].filter((item) => item.jid !== jid).slice(0, 10);
      if (!rows.length) {
        await ctx.reply('No other profiles found yet. Be the first to register with `.friendfinder <bio>`!');
        return;
      }

      await ctx.socket.sendMessage(chatJid(ctx), {
        text: `🤝 *Friend Finder Profiles*\n\n${rows.map((item, idx) => `${idx + 1}. ${mention(item.jid)}\n   📝 _${item.bio}_`).join('\n\n')}\n\n👉 Register your own: \`.friendfinder <short bio>\``,
        mentions: rows.map((item) => item.jid),
      });
      return;
    }

    const bio = (ctx.rawArgs || ctx.args.join(' ')).trim();
    if (!bio) {
      await ctx.reply(
        formatUsageError({
          command: 'friendfinder',
          examples: [
            'friendfinder Gamer, student, and coder looking for friends!',
            'friendfinder list',
            'friendfinder off',
          ],
          hint: 'Type .friendfinder list to browse other profiles.',
        })
      );
      return;
    }

    profile(ctx, bio);
    await ctx.reply(
      formatSuccess({
        title: 'Friend Finder Profile Saved!',
        fields: {
          'Name': displayName(ctx),
          'Bio': `"${bio}"`,
        },
        footer: 'Browse other members with `.friendfinder list` or find a match with `.matchmaking`.',
      })
    );
  },
};

export const MatchmakingCommand: Command = {
  name: 'matchmaking',
  aliases: ['matchmake', 'carijodoh'],
  category: CommandCategory.ANONYMOUS,
  description: 'Find your best compatible friend based on profile bios',
  usage: 'matchmaking [bio]',
  examples: ['matchmaking', 'matchmaking Likes gaming and anime'],
  async execute(ctx) {
    const me = profile(ctx, (ctx.rawArgs || ctx.args.join(' ')).trim());
    const candidates = [...profiles.values()].filter((item) => item.jid !== me.jid);
    const best = candidates
      .map((item) => ({ item, score: matchScore(me.bio, item.bio) }))
      .sort((a, b) => b.score - a.score)[0];

    if (!best) {
      await ctx.reply('No match candidates found yet. Ask group members to register using `.friendfinder <bio>`!');
      return;
    }

    await ctx.socket.sendMessage(chatJid(ctx), {
      text: `💘 *Best Matchmaking Result!*\n\n• Candidate: ${mention(best.item.jid)}\n• Compatibility: *${best.score}%*\n• Bio: _"${best.item.bio}"_\n\n👉 Say hi or pair up with \`.partner @user\`!`,
      mentions: [best.item.jid],
    });
  },
};

export const PartnerCommand: Command = {
  name: 'partner',
  aliases: ['pair', 'pasangan', 'shipment'],
  category: CommandCategory.ANONYMOUS,
  description: 'Calculate pair compatibility percentage with a mentioned contact',
  usage: 'partner [@user|phone_number]',
  examples: ['partner @user', 'partner 628123456789'],
  async execute(ctx) {
    const target = mentionedJid(ctx) || numberJid(ctx.args[0]) || [...profiles.keys()].filter((jid) => jid !== userJid(ctx))[hash(userJid(ctx)) % Math.max(1, profiles.size - 1)];

    if (!target) {
      await ctx.reply('Usage: `.partner @user` (or register profiles with `.friendfinder <bio>`)');
      return;
    }

    const score = hash(`${userJid(ctx)}:${target}`) % 101;
    const bar = '█'.repeat(Math.floor(score / 10)) + '░'.repeat(10 - Math.floor(score / 10));

    await ctx.socket.sendMessage(chatJid(ctx), {
      text: `💞 *Compatibility Meter*\n\n${displayName(ctx)} 💖 ${mention(target)}\n\n*Score:* ${score}%\n[${bar}]\n\n${score > 80 ? '🌟 Soulmates destined for greatness!' : score > 50 ? '✨ Great dynamic and chemistry!' : '⚡ An intriguing, mysterious duo!'}`,
      mentions: [target],
    });
  },
};

export const AnonymousCommands: Command[] = [
  AnonymousChatCommand,
  ConfessCommand,
  MenfessCommand,
  MenfessReplyCommand,
  FriendFinderCommand,
  MatchmakingCommand,
  PartnerCommand,
];

export default AnonymousCommands;
