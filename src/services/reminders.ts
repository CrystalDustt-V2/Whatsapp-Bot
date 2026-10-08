import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { WASocket } from '@whiskeysockets/baileys';
import config from '../config';
import logger from '../core/logger';

export interface Reminder {
  id: string;
  chatJid: string;
  ownerId: string;
  ownerJid: string;
  text: string;
  dueAt: number;
  nextAttemptAt?: number;
}

export const MAX_REMINDER_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_REMINDER_TEXT = 1000;

export class ReminderService {
  private reminders = new Map<string, Reminder>();
  private socket?: Pick<WASocket, 'sendMessage'>;
  private timer?: NodeJS.Timeout;
  private delivering = false;

  constructor(private file: string) {
    if (!fs.existsSync(file)) return;
    const data: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(data) || data.length > 100) throw new Error('Invalid reminder store');
    for (const item of data) {
      if (!item || typeof item.id !== 'string' || !item.id ||
        ![item.chatJid, item.ownerId, item.ownerJid, item.text].every((value) => typeof value === 'string' && value.length > 0) ||
        item.text.length > MAX_REMINDER_TEXT || !Number.isFinite(item.dueAt) || item.dueAt <= 0 ||
        (item.nextAttemptAt !== undefined && !Number.isFinite(item.nextAttemptAt)) || this.reminders.has(item.id)) {
        throw new Error('Invalid reminder store');
      }
      this.reminders.set(item.id, { ...item });
    }
  }

  private save(next: Map<string, Reminder>): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify([...next.values()], null, 2));
    fs.renameSync(temporary, this.file);
    this.reminders = next;
  }

  add(input: Omit<Reminder, 'id' | 'nextAttemptAt'>): Reminder {
    if (this.reminders.size >= 100) throw new Error('Reminder queue is full. Try again later.');
    if (!input.text.trim() || input.text.length > MAX_REMINDER_TEXT ||
      !Number.isFinite(input.dueAt) || input.dueAt <= Date.now() || input.dueAt > Date.now() + MAX_REMINDER_MS) {
      throw new Error('Invalid reminder');
    }
    const reminder = { ...input, id: randomUUID() };
    this.save(new Map(this.reminders).set(reminder.id, reminder));
    return { ...reminder };
  }

  list(chatJid: string, ownerId: string): Reminder[] {
    return [...this.reminders.values()].filter((item) => item.chatJid === chatJid && item.ownerId === ownerId)
      .sort((a, b) => a.dueAt - b.dueAt).map((item) => ({ ...item }));
  }

  cancel(id: string, chatJid: string, ownerId: string): boolean {
    const item = this.reminders.get(id);
    if (!item || item.chatJid !== chatJid || item.ownerId !== ownerId) return false;
    const next = new Map(this.reminders);
    next.delete(id);
    this.save(next);
    return true;
  }

  start(socket: Pick<WASocket, 'sendMessage'>): void {
    this.stop();
    this.socket = socket;
    this.timer = setInterval(() => {
      void this.deliverDue().catch((err) => logger.error({ err }, 'Reminder delivery failed'));
    }, 1000);
    this.timer.unref();
    void this.deliverDue().catch((err) => logger.error({ err }, 'Reminder delivery failed'));
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.socket = undefined;
  }

  async deliverDue(now = Date.now()): Promise<void> {
    if (!this.socket || this.delivering) return;
    this.delivering = true;
    try {
      for (const item of [...this.reminders.values()]) {
        if (!this.socket) break;
        if (!this.reminders.has(item.id) || Math.max(item.dueAt, item.nextAttemptAt || 0) > now) continue;
        try {
          await this.socket.sendMessage(item.chatJid, {
            text: `Reminder: ${item.text}`,
            ...(item.chatJid.endsWith('@g.us') ? { mentions: [item.ownerJid] } : {}),
          });
          const next = new Map(this.reminders);
          next.delete(item.id);
          this.save(next);
        } catch (err) {
          logger.warn({ err, reminderId: item.id }, 'Reminder retained for retry');
          if (!this.reminders.has(item.id)) continue;
          const retry = { ...item, nextAttemptAt: Date.now() + 60000 };
          const next = new Map(this.reminders).set(item.id, retry);
          // Keep the retry delay in memory even when the disk is temporarily unavailable.
          this.reminders = next;
          this.save(next);
        }
      }
    } finally {
      this.delivering = false;
    }
  }
}

let reminders: ReminderService | undefined;
export function getReminderService(): ReminderService {
  return reminders ||= new ReminderService(path.join(config.SESSION_PATH, 'reminders.json'));
}
