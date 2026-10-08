import * as fs from 'fs';
import * as path from 'path';
import type { DashboardChatMessage } from '../core/api-server';

export interface MessageEdit {
  chatJid: string;
  messageId: string;
  text: string;
  type: string;
  editedAt: string;
}

export interface StarredMessage {
  chatJid: string;
  messageId: string;
  fromMe: boolean;
  starredAt: string;
  message?: DashboardChatMessage;
}

export class DashboardState {
  private edits = new Map<string, MessageEdit>();
  private stars = new Map<string, StarredMessage>();
  private timers = new Map<string, number>();

  constructor(private directory: string) {
    for (const edit of this.read<MessageEdit>('message-edits.json')) this.edits.set(this.key(edit.chatJid, edit.messageId), edit);
    for (const star of this.read<StarredMessage>('starred-messages.json')) this.stars.set(this.key(star.chatJid, star.messageId), star);
    for (const setting of this.read<{ chatJid: string; duration: number }>('chat-settings.json')) this.timers.set(setting.chatJid, setting.duration);
  }

  private key(chatJid: string, messageId: string): string { return `${chatJid}\0${messageId}`; }

  private read<T>(name: string): T[] {
    const file = path.join(this.directory, name);
    if (!fs.existsSync(file)) return [];
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(data)) throw new Error(`Invalid dashboard data: ${name}`);
    return data;
  }

  private write(name: string, data: unknown): void {
    fs.mkdirSync(this.directory, { recursive: true });
    const file = path.join(this.directory, name);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(data), 'utf8');
    fs.renameSync(`${file}.tmp`, file);
  }

  getEdit(chatJid: string, id: string): MessageEdit | undefined { return this.edits.get(this.key(chatJid, id)); }

  edit(edit: MessageEdit): boolean {
    const key = this.key(edit.chatJid, edit.messageId);
    const previous = this.edits.get(key);
    if (previous && previous.editedAt >= edit.editedAt) return false;
    const next = new Map(this.edits).set(key, edit);
    this.write('message-edits.json', [...next.values()]);
    this.edits = next;
    const star = this.stars.get(key);
    if (star?.message) this.star({ ...star, message: { ...star.message, text: edit.text, type: edit.type, isEdited: true, editedAt: edit.editedAt } }, true);
    return true;
  }

  isStarred(chatJid: string, id: string): boolean { return this.stars.has(this.key(chatJid, id)); }
  listStars(): StarredMessage[] { return [...this.stars.values()].sort((a, b) => b.starredAt.localeCompare(a.starredAt)); }

  star(record: StarredMessage, enabled: boolean): void {
    const key = this.key(record.chatJid, record.messageId);
    const previous = this.stars.get(key);
    if (!enabled && !previous) return;
    const next = new Map(this.stars);
    if (enabled) {
      const updated = { ...previous, ...record, starredAt: previous?.starredAt || record.starredAt };
      if (JSON.stringify(previous) === JSON.stringify(updated)) return;
      next.set(key, updated);
    }
    else next.delete(key);
    this.write('starred-messages.json', [...next.values()]);
    this.stars = next;
  }

  timer(chatJid: string): number | undefined { return this.timers.get(chatJid); }
  setTimer(chatJid: string, duration: number): void {
    if (this.timers.get(chatJid) === duration) return;
    const next = new Map(this.timers).set(chatJid, duration);
    this.write('chat-settings.json', [...next].map(([chatJid, duration]) => ({ chatJid, duration })));
    this.timers = next;
  }
}
