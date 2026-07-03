import type { GroupMetadata, GroupParticipant } from '@whiskeysockets/baileys';
import config from '../config';
import { Command, CommandCategory } from '../types';

function isGroupJid(jid?: string | null): jid is string {
  return Boolean(jid?.endsWith('@g.us'));
}

function displayJid(jid: string): string {
  return `@${jid.split('@')[0]}`;
}

async function getGroup(ctx: Parameters<Command['execute']>[0]): Promise<GroupMetadata | null> {
  const jid = ctx.message.key.remoteJid;
  return isGroupJid(jid) ? ctx.socket.groupMetadata(jid) : null;
}

function isAdmin(participant?: GroupParticipant): boolean {
  return Boolean(participant?.admin || participant?.isAdmin || participant?.isSuperAdmin);
}

function senderJid(ctx: Parameters<Command['execute']>[0]): string | undefined {
  return ctx.message.key.participant || ctx.message.key.remoteJid || undefined;
}

function isOwner(jid?: string): boolean {
  const owner = config.OWNER_NUMBER?.replace(/\D/g, '');
  return Boolean(owner && jid?.startsWith(owner));
}

async function requireGroup(ctx: Parameters<Command['execute']>[0]): Promise<GroupMetadata | null> {
  const group = await getGroup(ctx);
  if (!group) {
    await ctx.reply('This command only works in groups.');
  }
  return group;
}

export const GroupInfoCommand: Command = {
  name: 'groupinfo',
  aliases: ['infogroup', 'gcinfo'],
  category: CommandCategory.GROUP,
  description: 'Show group info',
  usage: 'groupinfo',
  async execute(ctx) {
    const group = await requireGroup(ctx);
    if (!group) return;

    const admins = group.participants.filter(isAdmin).length;
    await ctx.reply(
      `*${group.subject}*\n` +
        `Members: ${group.participants.length}\n` +
        `Admins: ${admins}\n` +
        `Announce only: ${group.announce ? 'yes' : 'no'}\n` +
        `Description: ${group.desc || '-'}`
    );
  },
};

export const AdminListCommand: Command = {
  name: 'admins',
  aliases: ['adminlist'],
  category: CommandCategory.GROUP,
  description: 'List group admins',
  usage: 'admins',
  async execute(ctx) {
    const group = await requireGroup(ctx);
    if (!group) return;

    const admins = group.participants.filter(isAdmin).map((p) => p.id);
    await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
      text: admins.length ? admins.map(displayJid).join('\n') : 'No admins found.',
      mentions: admins,
    });
  },
};

export const MemberListCommand: Command = {
  name: 'members',
  aliases: ['memberlist'],
  category: CommandCategory.GROUP,
  description: 'List group members',
  usage: 'members',
  async execute(ctx) {
    const group = await requireGroup(ctx);
    if (!group) return;

    const members = group.participants.map((p) => p.id);
    await ctx.reply(members.map(displayJid).join('\n'));
  },
};

export const GroupStatsCommand: Command = {
  name: 'groupstats',
  aliases: ['gcstats'],
  category: CommandCategory.GROUP,
  description: 'Show quick group stats',
  usage: 'groupstats',
  async execute(ctx) {
    const group = await requireGroup(ctx);
    if (!group) return;

    const admins = group.participants.filter(isAdmin).length;
    const members = group.participants.length;
    await ctx.reply(
      `*Group Stats*\n` +
        `Name: ${group.subject}\n` +
        `Members: ${members}\n` +
        `Admins: ${admins}\n` +
        `Regular members: ${members - admins}\n` +
        `Announce only: ${group.announce ? 'yes' : 'no'}`
    );
  },
};

export const TagAllCommand: Command = {
  name: 'tagall',
  aliases: ['hidetag'],
  category: CommandCategory.GROUP,
  description: 'Mention all group members, admin only',
  usage: 'tagall [message]',
  async execute(ctx) {
    const group = await requireGroup(ctx);
    if (!group) return;

    const sender = senderJid(ctx);
    const senderParticipant = group.participants.find((p) => p.id === sender);
    if (!isOwner(sender) && !isAdmin(senderParticipant)) {
      await ctx.reply('Only group admins can use tagall.');
      return;
    }

    const members = group.participants.map((p) => p.id);
    const text = ctx.args.join(' ').trim() || 'Tag all';
    await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
      text: `${text}\n\n${members.map(displayJid).join(' ')}`,
      mentions: members,
    });
  },
};
