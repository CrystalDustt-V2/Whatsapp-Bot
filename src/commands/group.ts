import type { GroupMetadata, GroupParticipant, WAMessageKey } from '@whiskeysockets/baileys';
import * as fs from 'fs';
import * as path from 'path';
import config from '../config';
import { Command, CommandCategory, PermissionLevel } from '../types';
import { formatUsageError, formatFailed } from '../core/response-formatter';

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
  description: 'Remove a member from the group (Admin only)',
  usage: 'kick @user|<number>',
  examples: ['kick @user', 'kick 628123456789'],
  inputs: 'Mention @user or phone number (or reply to user message)',
  permissions: PermissionLevel.GROUP_ADMIN,
  async execute(ctx) {
    await updateParticipant(ctx, 'remove', 'Removed');
  },
};

export const PromoteCommand: Command = {
  name: 'promote',
  aliases: ['makeadmin'],
  category: CommandCategory.GROUP,
  description: 'Promote a group member to admin (Admin only)',
  usage: 'promote @user|<number>',
  examples: ['promote @user', 'promote 628123456789'],
  inputs: 'Mention @user or phone number (or reply to user message)',
  permissions: PermissionLevel.GROUP_ADMIN,
  async execute(ctx) {
    await updateParticipant(ctx, 'promote', 'Promoted');
  },
};

export const DemoteCommand: Command = {
  name: 'demote',
  aliases: ['unadmin'],
  category: CommandCategory.GROUP,
  description: 'Demote a group admin to regular member (Admin only)',
  usage: 'demote @user|<number>',
  examples: ['demote @user', 'demote 628123456789'],
  inputs: 'Mention @user or phone number (or reply to user message)',
  permissions: PermissionLevel.GROUP_ADMIN,
  async execute(ctx) {
    await updateParticipant(ctx, 'demote', 'Demoted');
  },
};

export const GroupModeCommand: Command = {
  name: 'groupmode',
  aliases: ['groupchat', 'gcsetting'],
  category: CommandCategory.GROUP,
  description: 'Open or close group chat messages (Admin only)',
  usage: 'groupmode <open|close>',
  examples: ['groupmode open', 'groupmode close'],
  inputs: 'Option: "open" (all members) or "close" (admins only)',
  permissions: PermissionLevel.GROUP_ADMIN,
  async execute(ctx) {
    const group = await requireGroup(ctx);
    if (!group || !(await requireGroupManager(ctx, group))) return;

    const mode = (ctx.args[0] || '').toLowerCase();
    if (!['open', 'close'].includes(mode)) {
      await ctx.reply(
        formatUsageError({
          command: 'groupmode',
          reason: 'Specify whether to open or close the group.',
          examples: ['groupmode open', 'groupmode close'],
          hint: 'open = all members can send messages; close = announcement mode (admins only).',
        })
      );
      return;
    }

    try {
      await ctx.socket.groupSettingUpdate(group.id, mode === 'close' ? 'announcement' : 'not_announcement');
      await ctx.reply(mode === 'close' ? '🔒 Group chat is now admin-only.' : '🔓 Group chat is now open to all members.');
    } catch {
      await ctx.reply(
        formatFailed({
          title: 'Group Mode Update',
          reason: 'Could not change group chat settings. Check bot admin rights.',
        })
      );
    }
  },
};

export const GroupLinkCommand: Command = {
  name: 'grouplink',
  aliases: ['gclink', 'invitelink'],
  category: CommandCategory.GROUP,
  description: 'Fetch the active group invite link (Admin only)',
  usage: 'grouplink',
  examples: ['grouplink'],
  permissions: PermissionLevel.GROUP_ADMIN,
  async execute(ctx) {
    const group = await requireGroup(ctx);
    if (!group || !(await requireGroupManager(ctx, group))) return;

    try {
      const code = await ctx.socket.groupInviteCode(group.id);
      await ctx.reply(code ? `🔗 *Group Invite Link:*\nhttps://chat.whatsapp.com/${code}` : 'No group invite link available.');
    } catch {
      await ctx.reply(
        formatFailed({
          title: 'Group Link Lookup',
          reason: 'Could not fetch invite link. Ensure the bot is an admin.',
        })
      );
    }
  },
};

export const ResetLinkCommand: Command = {
  name: 'resetlink',
  aliases: ['newlink', 'relink'],
  category: CommandCategory.GROUP,
  description: 'Revoke and reset the group invite link (Admin only)',
  usage: 'resetlink',
  examples: ['resetlink'],
  permissions: PermissionLevel.GROUP_ADMIN,
  async execute(ctx) {
    const group = await requireGroup(ctx);
    if (!group || !(await requireGroupManager(ctx, group))) return;

    try {
      const code = await ctx.socket.groupRevokeInvite(group.id);
      await ctx.reply(code ? `🔄 *Invite link reset successfully!*\nNew Link: https://chat.whatsapp.com/${code}` : 'Invite link reset.');
    } catch {
      await ctx.reply(
        formatFailed({
          title: 'Reset Invite Link',
          reason: 'Could not reset group link. Ensure the bot is an admin.',
        })
      );
    }
  },
};

export const SetSubjectCommand: Command = {
  name: 'setsubject',
  aliases: ['setname', 'gcname'],
  category: CommandCategory.GROUP,
  description: 'Change the group subject/name (Admin only)',
  usage: 'setsubject <new name>',
  examples: ['setsubject Squad Lounge 🚀'],
  inputs: 'New group name string (max 100 characters)',
  permissions: PermissionLevel.GROUP_ADMIN,
  async execute(ctx) {
    const group = await requireGroup(ctx);
    if (!group || !(await requireGroupManager(ctx, group))) return;

    const subject = (ctx.rawArgs || ctx.args.join(' ')).trim();
    if (!subject) {
      await ctx.reply(
        formatUsageError({
          command: 'setsubject',
          reason: 'New group name is required.',
          examples: ['setsubject Gaming Hub 🎮'],
        })
      );
      return;
    }

    try {
      await ctx.socket.groupUpdateSubject(group.id, subject.slice(0, 100));
      await ctx.reply('✅ Group name updated successfully.');
    } catch {
      await ctx.reply(
        formatFailed({
          title: 'Update Group Name',
          reason: 'Could not change group name. Check bot permissions.',
        })
      );
    }
  },
};

export const SetDescriptionCommand: Command = {
  name: 'setdesc',
  aliases: ['setdescription', 'gcdesc'],
  category: CommandCategory.GROUP,
  description: 'Change the group description (Admin only)',
  usage: 'setdesc <new description>',
  examples: ['setdesc Welcome! Rules: Be respectful & no spam.'],
  inputs: 'New group description text',
  permissions: PermissionLevel.GROUP_ADMIN,
  async execute(ctx) {
    const group = await requireGroup(ctx);
    if (!group || !(await requireGroupManager(ctx, group))) return;

    const description = (ctx.rawArgs || ctx.args.join(' ')).trim();
    if (!description) {
      await ctx.reply(
        formatUsageError({
          command: 'setdesc',
          reason: 'New group description is required.',
          examples: ['setdesc Welcome to the group!'],
        })
      );
      return;
    }

    try {
      await ctx.socket.groupUpdateDescription(group.id, description);
      await ctx.reply('✅ Group description updated successfully.');
    } catch {
      await ctx.reply(
        formatFailed({
          title: 'Update Group Description',
          reason: 'Could not change group description.',
        })
      );
    }
  },
};

export const DeleteMessageCommand: Command = {
  name: 'del',
  aliases: ['delete', 'deletemsg'],
  category: CommandCategory.GROUP,
  description: 'Delete a replied message from the chat (Admin only)',
  usage: 'del <reply to message>',
  examples: ['del (as a reply to message)'],
  inputs: 'Reply to the target message',
  permissions: PermissionLevel.GROUP_ADMIN,
  async execute(ctx) {
    const group = await requireGroup(ctx);
    if (!group || !(await requireGroupManager(ctx, group))) return;

    const key = quotedDeleteKey(ctx, group.id);
    if (!key) {
      await ctx.reply(
        formatUsageError({
          command: 'del',
          reason: 'Must reply to the message you want to delete.',
          examples: ['del (reply to message)'],
          hint: 'The bot must be a group admin to delete others\' messages.',
        })
      );
      return;
    }

    try {
      await ctx.socket.sendMessage(group.id, { delete: key });
    } catch {
      await ctx.reply(
        formatFailed({
          title: 'Delete Message',
          reason: 'Could not delete that message. Ensure the bot has admin rights.',
        })
      );
    }
  },
};

export const WarnCommand: Command = {
  name: 'warn',
  aliases: ['warning'],
  category: CommandCategory.GROUP,
  description: 'Warn a member for rule violations; 3 warnings automatically kicks them (Admin only)',
  usage: 'warn @user|<number> [reason]',
  examples: ['warn @user Spamming links', 'warn 628123456789 Inappropriate behavior'],
  inputs: 'Mention @user or number, and optional reason',
  permissions: PermissionLevel.GROUP_ADMIN,
  async execute(ctx) {
    const group = await requireGroup(ctx);
    if (!group || !(await requireGroupManager(ctx, group))) return;

    const target = resolveTarget(ctx, group);
    if (!target) {
      await ctx.reply(
        formatUsageError({
          command: 'warn',
          reason: 'Target member to warn is required.',
          examples: ['warn @user Spamming', 'warn @user Toxic language'],
          hint: 'Mention @user or reply to their message.',
        })
      );
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
          text: `🚨 ${displayJid(target.jid)} reached ${WARN_LIMIT}/${WARN_LIMIT} warnings and was removed from the group.`,
          mentions: [target.jid],
        });
      } catch {
        await ctx.reply('Warning limit reached, but I could not remove that member.');
      }
      return;
    }

    saveWarnings();
    await ctx.socket.sendMessage(group.id, {
      text: `⚠️ *Warning Issued:*\n${displayJid(target.jid)} received a warning (*${entry.count}/${WARN_LIMIT}*).${entry.lastReason ? `\n• *Reason:* ${entry.lastReason}` : ''}\n\n_Reaching ${WARN_LIMIT} warnings will result in an automatic ban._`,
      mentions: [target.jid],
    });
  },
};

export const UnwarnCommand: Command = {
  name: 'unwarn',
  aliases: ['removewarn'],
  category: CommandCategory.GROUP,
  description: 'Remove one warning from a member (Admin only)',
  usage: 'unwarn @user|<number>',
  examples: ['unwarn @user'],
  inputs: 'Mention @user or number',
  permissions: PermissionLevel.GROUP_ADMIN,
  async execute(ctx) {
    const group = await requireGroup(ctx);
    if (!group || !(await requireGroupManager(ctx, group))) return;

    const target = resolveTarget(ctx, group);
    if (!target) {
      await ctx.reply(
        formatUsageError({
          command: 'unwarn',
          reason: 'Target member to unwarn is required.',
          examples: ['unwarn @user'],
        })
      );
      return;
    }

    const entry = readWarnings()[group.id]?.[target.jid];
    if (!entry) {
      await ctx.reply('That member has no recorded warnings.');
      return;
    }

    entry.count -= 1;
    if (entry.count <= 0) delete readWarnings()[group.id][target.jid];
    saveWarnings();
    await ctx.socket.sendMessage(group.id, {
      text: `✅ ${displayJid(target.jid)} now has *${Math.max(0, entry.count)}/${WARN_LIMIT}* warnings.`,
      mentions: [target.jid],
    });
  },
};

export const WarningsCommand: Command = {
  name: 'warnings',
  aliases: ['warns'],
  category: CommandCategory.GROUP,
  description: 'Show active group warnings for a user or the entire group',
  usage: 'warnings [@user]',
  examples: ['warnings', 'warnings @user'],
  inputs: 'Optional user mention',
  async execute(ctx) {
    const group = await requireGroup(ctx);
    if (!group) return;

    const target = resolveTarget(ctx, group);
    const groupWarnings = readWarnings()[group.id] || {};
    if (target) {
      const count = groupWarnings[target.jid]?.count || 0;
      await ctx.socket.sendMessage(group.id, { text: `📊 ${displayJid(target.jid)} has *${count}/${WARN_LIMIT}* warnings.`, mentions: [target.jid] });
      return;
    }

    const rows = Object.entries(groupWarnings).filter(([, entry]) => entry.count > 0);
    if (!rows.length) {
      await ctx.reply('✅ No active warnings in this group.');
      return;
    }

    await ctx.socket.sendMessage(group.id, {
      text: `📋 *Group Warnings List:*\n\n` + rows.map(([jid, entry]) => `• ${displayJid(jid)}: *${entry.count}/${WARN_LIMIT}* warnings`).join('\n'),
      mentions: rows.map(([jid]) => jid),
    });
  },
};

export const ClearWarningsCommand: Command = {
  name: 'clearwarns',
  aliases: ['resetwarns'],
  category: CommandCategory.GROUP,
  description: 'Clear all warnings for a member or all members in the group (Admin only)',
  usage: 'clearwarns @user|all',
  examples: ['clearwarns @user', 'clearwarns all'],
  inputs: 'Mention @user or "all"',
  permissions: PermissionLevel.GROUP_ADMIN,
  async execute(ctx) {
    const group = await requireGroup(ctx);
    if (!group || !(await requireGroupManager(ctx, group))) return;

    const mode = (ctx.args[0] || '').toLowerCase();
    if (mode === 'all') {
      delete readWarnings()[group.id];
      saveWarnings();
      await ctx.reply('✅ Cleared all warnings in this group.');
      return;
    }

    const target = resolveTarget(ctx, group);
    if (!target) {
      await ctx.reply(
        formatUsageError({
          command: 'clearwarns',
          reason: 'Specify a member or "all".',
          examples: ['clearwarns @user', 'clearwarns all'],
        })
      );
      return;
    }

    delete (readWarnings()[group.id] ||= {})[target.jid];
    saveWarnings();
    await ctx.socket.sendMessage(group.id, { text: `✅ Cleared all warnings for ${displayJid(target.jid)}.`, mentions: [target.jid] });
  },
};

export const TagAllCommand: Command = {
  name: 'tagall',
  aliases: ['hidetag'],
  category: CommandCategory.GROUP,
  description: 'Mention all group members with an announcement message (Admin only)',
  usage: 'tagall [message]',
  examples: ['tagall Meeting starting in 5 minutes!', 'tagall'],
  inputs: 'Optional announcement text',
  permissions: PermissionLevel.GROUP_ADMIN,
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
    const text = ctx.args.join(' ').trim() || '📢 Attention everyone!';
    await ctx.socket.sendMessage(ctx.message.key.remoteJid!, {
      text: `${text}\n\n${members.map(displayJid).join(' ')}`,
      mentions: members,
    });
  },
};
