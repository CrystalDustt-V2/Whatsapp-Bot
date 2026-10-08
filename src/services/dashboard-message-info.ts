import type { MessageUserReceipt, WAMessage } from '@whiskeysockets/baileys';

export type DashboardMessageStatus = 'error' | 'pending' | 'sent' | 'delivered' | 'read' | 'played';

export interface DashboardReceipt {
  userJid: string;
  deliveredAt?: string;
  readAt?: string;
  playedAt?: string;
}

export interface DashboardMessageInfo {
  status?: DashboardMessageStatus;
  statusCode?: number;
  serverTimestamp?: string;
  senderLid?: string;
  messageStubType?: number;
  messageStubParameters?: string[];
  receipts?: DashboardReceipt[];
}

// Baileys WebMessageInfo.Status values, including ERROR (0).
const statuses: DashboardMessageStatus[] = ['error', 'pending', 'sent', 'delivered', 'read', 'played'];

export function whatsappTimestamp(value: WAMessage['messageTimestamp']): string | undefined {
  if (value == null) return undefined;
  const seconds = Number(value);
  const milliseconds = seconds * 1000;
  if (!Number.isFinite(milliseconds) || milliseconds <= 0 || milliseconds > 8.64e15) return undefined;
  return new Date(milliseconds).toISOString();
}

export function receiptInfo(receipt: MessageUserReceipt): DashboardReceipt | undefined {
  if (!receipt.userJid) return undefined;
  const result: DashboardReceipt = { userJid: receipt.userJid.replace(/:\d+(?=@)/, '') };
  const deliveredAt = whatsappTimestamp(receipt.receiptTimestamp);
  const readAt = whatsappTimestamp(receipt.readTimestamp);
  const playedAt = whatsappTimestamp(receipt.playedTimestamp);
  if (deliveredAt) result.deliveredAt = deliveredAt;
  if (readAt) result.readAt = readAt;
  if (playedAt) result.playedAt = playedAt;
  return result;
}

export function messageInfo(message: Partial<WAMessage>): DashboardMessageInfo {
  const info: DashboardMessageInfo = {};
  if (message.status != null && statuses[message.status]) {
    info.statusCode = message.status;
    info.status = statuses[message.status];
  }
  const timestamp = whatsappTimestamp(message.messageTimestamp);
  if (timestamp) info.serverTimestamp = timestamp;
  const senderLid = message.key?.participantLid || message.key?.senderLid;
  if (senderLid?.endsWith('@lid')) info.senderLid = senderLid.replace(/:\d+(?=@)/, '');
  if (message.messageStubType != null) info.messageStubType = message.messageStubType;
  if (message.messageStubParameters != null) info.messageStubParameters = [...message.messageStubParameters];
  if (message.userReceipt?.length) {
    info.receipts = message.userReceipt.map(receiptInfo).filter((r): r is DashboardReceipt => Boolean(r));
  }
  return info;
}

export function mergeMessageInfo(
  existing: DashboardMessageInfo,
  incoming: DashboardMessageInfo,
  isDirectOutgoing = false
): DashboardMessageInfo {
  const merged: DashboardMessageInfo = {};
  for (const info of [existing, incoming]) {
    for (const field of ['status', 'statusCode', 'serverTimestamp', 'senderLid', 'messageStubType', 'messageStubParameters', 'receipts'] as const) {
      if (info[field] !== undefined) Object.assign(merged, { [field]: info[field] });
    }
  }
  // Replayed upserts and delayed ACKs must not downgrade a confirmed status.
  if (existing.statusCode != null && incoming.statusCode != null && existing.statusCode >= 2 && incoming.statusCode < existing.statusCode) {
    merged.statusCode = existing.statusCode;
    merged.status = existing.status;
  }
  if (existing.receipts || incoming.receipts) {
    const receipts = new Map<string, DashboardReceipt>();
    for (const receipt of [...(existing.receipts || []), ...(incoming.receipts || [])]) {
      const previous = receipts.get(receipt.userJid);
      const next = { ...previous, ...receipt };
      for (const field of ['deliveredAt', 'readAt', 'playedAt'] as const) {
        if (previous?.[field] && receipt[field]) {
          next[field] = previous[field]! < receipt[field]! ? previous[field] : receipt[field];
        }
      }
      receipts.set(receipt.userJid, next);
    }
    merged.receipts = [...receipts.values()];
    // Group receipts describe individuals, never the entire group's ACK state.
    if (isDirectOutgoing) {
      for (const receipt of merged.receipts) {
        const code = receipt.playedAt ? 5 : receipt.readAt ? 4 : receipt.deliveredAt ? 3 : undefined;
        if (code != null && code > (merged.statusCode ?? -1)) {
          merged.statusCode = code;
          merged.status = statuses[code];
        }
      }
    }
  }
  return merged;
}
