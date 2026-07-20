import type { GroupMetadata, GroupParticipant, WAMessageKey } from '@whiskeysockets/baileys';
import * as fs from 'fs';
import * as path from 'path';
import config from '../config';
import { Command, CommandCategory } from '../types';

type GroupContext = Parameters<Command['execute']>[0];
type Target = { jid: string; fromArg: boolean };
type WarningEntry = { count: number; lastReason?: string; updatedAt: string };
type WarningStore = Record<string, Record<string, WarningEntry>>;

const WARN_LIMIT = 3;
const warningsPath = path.join(config.SESSION_PATH, 'group-warnings.json');
let warningStore: WarningStore | null = null;

function isGroupJid(jid?: string | null): jid is string {
  return Boolean(jid?.endsWith('@g.us'));
}

function jidNumber(jid?: string | null): string {
  return jid?.split('@')[0].split(':')[0].replace(/\D/g, '') || '';
}

function displayJid(jid: string): string {
  return `@${jid.split('@')[0]}`;
}

async function getGroup(ctx: GroupContext): Promise<GroupMetadata | null> {
  const jid = ctx.message.key.remoteJid;
  return isGroupJid(jid) ? ctx.socket.groupMetadata(jid) : null;
}

function isAdmin(participant?: GroupParticipant): boolean {
  return Boolean(participant?.admin || participant?.isAdmin || participant?.isSuperAdmin);
}

function sameUser(a?: string | null, b?: string | null): boolean {
  const aNumber = jidNumber(a);
  const bNumber = jidNumber(b);
  return Boolean(a && b && (a === b || (aNumber && bNumber && aNumber === bNumber)));
}

function findParticipant(group: GroupMetadata, jid?: string): GroupParticipant | undefined {
  return group.participants.find((p) => sameUser(p.id, jid));
}

function senderJid(ctx: GroupContext): string | undefined {
  return ctx.sender.jid || ctx.message.key.participant || ctx.message.key.remoteJid || undefined;
}

function isOwner(jid?: string): boolean {
  const owner = config.OWNER_NUMBER?.replace(/\D/g, '');
  return Boolean(owner && jid?.startsWith(owner));
}

function resolveTarget(ctx: GroupContext, group: GroupMetadata): Target | null {
  const context = ctx.message.message?.extendedTextMessage?.contextInfo;
  const raw = context?.mentionedJid?.[0] || context?.participant || ctx.args[0];
  if (!raw) return null;

  const direct = findParticipant(group, raw);
  if (direct) return { jid: direct.id, fromArg: Boolean(context?.mentionedJid?.[0] || !context?.participant) };

  const number = jidNumber(raw);
  if (!number) return null;

  const byNumber = group.participants.find((p) => jidNumber(p.id) === number);
  return byNumber ? { jid: byNumber.id, fromArg: true } : null;
}

function readWarnings(): WarningStore {
  if (warningStore) return warningStore;
  try {
    warningStore = JSON.parse(fs.readFileSync(warningsPath, 'utf8')) as WarningStore;
  } catch {
    warningStore = {};
  }
  return warningStore;
}

function saveWarnings(): void {
  fs.mkdirSync(path.dirname(warningsPath), { recursive: true });
  fs.writeFileSync(warningsPath, JSON.stringify(readWarnings(), null, 2));
}

function warningReason(ctx: GroupContext, target: Target): string | undefined {
  const raw = (ctx.rawArgs || ctx.args.join(' ')).trim();
  const reason = target.fromArg ? raw.replace(/^\S+\s*/, '').trim() : raw;
  return reason || undefined;
}

function quotedDeleteKey(ctx: GroupContext, groupId: string): WAMessageKey | null {
  const context = ctx.message.message?.extendedTextMessage?.contextInfo;
  if (!context?.stanzaId) return null;

  const socketUser = ctx.socket.user as { id?: string; lid?: string } | undefined;
  return {
    remoteJid: groupId,
    id: context.stanzaId,
    participant: context.participant,
    fromMe: sameUser(context.participant, socketUser?.id) || sameUser(context.participant, socketUser?.lid),
  };
}

async function requireGroup(ctx: GroupContext): Promise<GroupMetadata | null> {
  const group = await getGroup(ctx);
  if (!group) {
    await ctx.reply('This command only works in groups.');
  }
  return group;
}

async function requireGroupManager(ctx: GroupContext, group: GroupMetadata): Promise<boolean> {
  const sender = senderJid(ctx);
  const senderParticipant = findParticipant(group, sender);
  if (!isOwner(sender) && !isAdmin(senderParticipant)) {
    await ctx.reply('Only group admins can use this command.');
    return false;
  }

  const socketUser = ctx.socket.user as { id?: string; lid?: string } | undefined;
  const botParticipant = findParticipant(group, socketUser?.id) || findParticipant(group, socketUser?.lid);
  if (!isAdmin(botParticipant)) {
    await ctx.reply('I need to be a group admin to do that.');
    return false;
  }

  return true;
}

async function updateParticipant(ctx: GroupContext, action: 'remove' | 'promote' | 'demote', success: string): Promise<void> {
  const group = await requireGroup(ctx);
  if (!group || !(await requireGroupManager(ctx, group))) return;

  const target = resolveTarget(ctx, group);
  if (!target) {
    const commandName = action === 'remove' ? 'kick' : action;
    await ctx.reply(`Usage: .${commandName} @user`);
    return;
  }

  const socketUser = ctx.socket.user as { id?: string; lid?: string } | undefined;
  if (sameUser(target.jid, socketUser?.id) || sameUser(target.jid, socketUser?.lid)) {
    await ctx.reply('I cannot target myself.');
    return;
  }

  try {
    await ctx.socket.groupParticipantsUpdate(group.id, [target.jid], action);
    await ctx.socket.sendMessage(group.id, { text: `${success} ${displayJid(target.jid)}`, mentions: [target.jid] });
  } catch {
    await ctx.reply('Could not update that group member.');
  }
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

export const KickCommand: Command = {
  name: 'kick',
  aliases: ['remove', 'ban'],
  category: CommandCategory.GROUP,
  description: 'Remove a member from the group, admin only',
  usage: 'kick @user|<number>',
  async execute(ctx) {
    await updateParticipant(ctx, 'remove', 'Removed');
  },
};

export const PromoteCommand: Command = {
  name: 'promote',
  aliases: ['makeadmin'],
  category: CommandCategory.GROUP,
  description: 'Promote a group member to admin',
  usage: 'promote @user|<number>',
  async execute(ctx) {
    await updateParticipant(ctx, 'promote', 'Promoted');
  },
};

export const DemoteCommand: Command = {
  name: 'demote',
  aliases: ['unadmin'],
  category: CommandCategory.GROUP,
  description: 'Demote a group admin',
  usage: 'demote @user|<number>',
  async execute(ctx) {
    await updateParticipant(ctx, 'demote', 'Demoted');
  },
};

export const GroupModeCommand: Command = {
  name: 'groupmode',
  aliases: ['groupchat', 'gcsetting'],
  category: CommandCategory.GROUP,
  description: 'Open or close group chat, admin only',
  usage: 'groupmode <open|close>',
  async execute(ctx) {
    const group = await requireGroup(ctx);
    if (!group || !(await requireGroupManager(ctx, group))) return;

    const mode = (ctx.args[0] || '').toLowerCase();
    if (!['open', 'close'].includes(mode)) {
      await ctx.reply('Usage: .groupmode <open|close>');
      return;
    }

    try {
      await ctx.socket.groupSettingUpdate(group.id, mode === 'close' ? 'announcement' : 'not_announcement');
      await ctx.reply(mode === 'close' ? 'Group chat is now admin-only.' : 'Group chat is now open to all members.');
    } catch {
      await ctx.reply('Could not update group chat mode.');
    }
  },
};

export const GroupLinkCommand: Command = {
  name: 'grouplink',
  aliases: ['gclink', 'invitelink'],
  category: CommandCategory.GROUP,
  description: 'Show the group invite link, admin only',
  usage: 'grouplink',
  async execute(ctx) {
    const group = await requireGroup(ctx);
    if (!group || !(await requireGroupManager(ctx, group))) return;

    try {
      const code = await ctx.socket.groupInviteCode(group.id);
      await ctx.reply(code ? `https://chat.whatsapp.com/${code}` : 'No group invite link available.');
    } catch {
      await ctx.reply('Could not get the group invite link.');
    }
  },
};

export const ResetLinkCommand: Command = {
  name: 'resetlink',
  aliases: ['newlink', 'relink'],
  category: CommandCategory.GROUP,
  description: 'Reset the group invite link, admin only',
  usage: 'resetlink',
  async execute(ctx) {
    const group = await requireGroup(ctx);
    if (!group || !(await requireGroupManager(ctx, group))) return;

    try {
      const code = await ctx.socket.groupRevokeInvite(group.id);
      await ctx.reply(code ? `Invite link reset:\nhttps://chat.whatsapp.com/${code}` : 'Invite link reset.');
    } catch {
      await ctx.reply('Could not reset the group invite link.');
    }
  },
};

export const SetSubjectCommand: Command = {
  name: 'setsubject',
  aliases: ['setname', 'gcname'],
  category: CommandCategory.GROUP,
  description: 'Change the group name, admin only',
  usage: 'setsubject <new name>',
  async execute(ctx) {
    const group = await requireGroup(ctx);
    if (!group || !(await requireGroupManager(ctx, group))) return;

    const subject = (ctx.rawArgs || ctx.args.join(' ')).trim();
    if (!subject) {
      await ctx.reply('Usage: .setsubject <new name>');
      return;
    }

    try {
      await ctx.socket.groupUpdateSubject(group.id, subject.slice(0, 100));
      await ctx.reply('Group name updated.');
    } catch {
      await ctx.reply('Could not update the group name.');
    }
  },
};

export const SetDescriptionCommand: Command = {
  name: 'setdesc',
  aliases: ['setdescription', 'gcdesc'],
  category: CommandCategory.GROUP,
  description: 'Change the group description, admin only',
  usage: 'setdesc <new description>',
  async execute(ctx) {
    const group = await requireGroup(ctx);
    if (!group || !(await requireGroupManager(ctx, group))) return;

    const description = (ctx.rawArgs || ctx.args.join(' ')).trim();
    if (!description) {
      await ctx.reply('Usage: .setdesc <new description>');
      return;
    }

    try {
      await ctx.socket.groupUpdateDescription(group.id, description);
      await ctx.reply('Group description updated.');
    } catch {
      await ctx.reply('Could not update the group description.');
    }
  },
};

export const DeleteMessageCommand: Command = {
  name: 'del',
  aliases: ['delete', 'deletemsg'],
  category: CommandCategory.GROUP,
  description: 'Delete a replied message, admin only',
  usage: 'del <reply to message>',
  async execute(ctx) {
    const group = await requireGroup(ctx);
    if (!group || !(await requireGroupManager(ctx, group))) return;

    const key = quotedDeleteKey(ctx, group.id);
    if (!key) {
      await ctx.reply('Reply to a message with .del to delete it.');
      return;
    }

    try {
      await ctx.socket.sendMessage(group.id, { delete: key });
    } catch {
      await ctx.reply('Could not delete that message.');
    }
  },
};

export const WarnCommand: Command = {
  name: 'warn',
  aliases: ['warning'],
  category: CommandCategory.GROUP,
  description: 'Warn a member; 3 warnings removes them',
  usage: 'warn @user|<number> [reason]',
  async execute(ctx) {
    const group = await requireGroup(ctx);
    if (!group || !(await requireGroupManager(ctx, group))) return;

    const target = resolveTarget(ctx, group);
    if (!target) {
      await ctx.reply('Usage: .warn @user [reason]');
      return;
    }

    const targetParticipant = findParticipant(group, target.jid);
    const socketUser = ctx.socket.user as { id?: string; lid?: string } | undefined;
    if (isAdmin(targetParticipant) || sameUser(target.jid, socketUser?.id) || sameUser(target.jid, socketUser?.lid) || isOwner(target.jid)) {
      await ctx.reply('I will not warn admins, the owner, or myself.');
      return;
    }

    const groupWarnings = (readWarnings()[group.id] ||= {});
    const entry = (groupWarnings[target.jid] ||= { count: 0, updatedAt: new Date().toISOString() });
    entry.count += 1;
    entry.lastReason = warningReason(ctx, target);
    entry.updatedAt = new Date().toISOString();

    if (entry.count >= WARN_LIMIT) {
      delete groupWarnings[target.jid];
      saveWarnings();
      try {
        await ctx.socket.groupParticipantsUpdate(group.id, [target.jid], 'remove');
        await ctx.socket.sendMessage(group.id, {
          text: `${displayJid(target.jid)} reached ${WARN_LIMIT}/${WARN_LIMIT} warnings and was removed.`,
          mentions: [target.jid],
        });
      } catch {
        await ctx.reply('Warning limit reached, but I could not remove that member.');
      }
      return;
    }

    saveWarnings();
    await ctx.socket.sendMessage(group.id, {
      text: `${displayJid(target.jid)} warned (${entry.count}/${WARN_LIMIT}).${entry.lastReason ? `\nReason: ${entry.lastReason}` : ''}`,
      mentions: [target.jid],
    });
  },
};

export const UnwarnCommand: Command = {
  name: 'unwarn',
  aliases: ['removewarn'],
  category: CommandCategory.GROUP,
  description: 'Remove one warning from a member',
  usage: 'unwarn @user|<number>',
  async execute(ctx) {
    const group = await requireGroup(ctx);
    if (!group || !(await requireGroupManager(ctx, group))) return;

    const target = resolveTarget(ctx, group);
    if (!target) {
      await ctx.reply('Usage: .unwarn @user');
      return;
    }

    const entry = readWarnings()[group.id]?.[target.jid];
    if (!entry) {
      await ctx.reply('That member has no warnings.');
      return;
    }

    entry.count -= 1;
    if (entry.count <= 0) delete readWarnings()[group.id][target.jid];
    saveWarnings();
    await ctx.socket.sendMessage(group.id, {
      text: `${displayJid(target.jid)} now has ${Math.max(0, entry.count)}/${WARN_LIMIT} warnings.`,
      mentions: [target.jid],
    });
  },
};

export const WarningsCommand: Command = {
  name: 'warnings',
  aliases: ['warns'],
  category: CommandCategory.GROUP,
  description: 'Show group warnings',
  usage: 'warnings [@user]',
  async execute(ctx) {
    const group = await requireGroup(ctx);
    if (!group) return;

    const target = resolveTarget(ctx, group);
    const groupWarnings = readWarnings()[group.id] || {};
    if (target) {
      const count = groupWarnings[target.jid]?.count || 0;
      await ctx.socket.sendMessage(group.id, { text: `${displayJid(target.jid)} has ${count}/${WARN_LIMIT} warnings.`, mentions: [target.jid] });
      return;
    }

    const rows = Object.entries(groupWarnings).filter(([, entry]) => entry.count > 0);
    if (!rows.length) {
      await ctx.reply('No warnings in this group.');
      return;
    }

    await ctx.socket.sendMessage(group.id, {
      text: rows.map(([jid, entry]) => `${displayJid(jid)}: ${entry.count}/${WARN_LIMIT}`).join('\n'),
      mentions: rows.map(([jid]) => jid),
    });
  },
};

export const ClearWarningsCommand: Command = {
  name: 'clearwarns',
  aliases: ['resetwarns'],
  category: CommandCategory.GROUP,
  description: 'Clear warnings for a member or all members',
  usage: 'clearwarns @user|all',
  async execute(ctx) {
    const group = await requireGroup(ctx);
    if (!group || !(await requireGroupManager(ctx, group))) return;

    const mode = (ctx.args[0] || '').toLowerCase();
    if (mode === 'all') {
      delete readWarnings()[group.id];
      saveWarnings();
      await ctx.reply('Cleared all warnings in this group.');
      return;
    }

    const target = resolveTarget(ctx, group);
    if (!target) {
      await ctx.reply('Usage: .clearwarns @user|all');
      return;
    }

    delete (readWarnings()[group.id] ||= {})[target.jid];
    saveWarnings();
    await ctx.socket.sendMessage(group.id, { text: `Cleared warnings for ${displayJid(target.jid)}.`, mentions: [target.jid] });
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
    const senderParticipant = findParticipant(group, sender);
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
