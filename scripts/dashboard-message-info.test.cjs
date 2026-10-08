// Run after npm run build: node --test scripts/dashboard-message-info.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test, after } = require('node:test');
const os = require('node:os');
const { DashboardState } = require('../dist/services/dashboard-state');
const testDirectories = [];
function testDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crystaldust-dashboard-test-'));
  testDirectories.push(directory);
  return directory;
}
after(() => {
  for (const directory of testDirectories) {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep + 'crystaldust-dashboard-test-')) throw new Error('Invalid cleanup path');
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
const info = require('../dist/services/dashboard-message-info');
const { messageInfo, mergeMessageInfo, receiptInfo, whatsappTimestamp } = info;
const pn = '123@s.whatsapp.net';
const lid = '456@lid';
const key = { remoteJid: pn, id: 'message-1', fromMe: true };
const timestamp = 1700000000;

// Exercise the actual API methods without starting a server or accessing session files.
function dashboard() {
  const events = [];
  const routes = new Map();
  const state = { messages: [], deleted: [], viewOnce: [] };
  const queued = [];
  const memoryEdits = [];
  const exports = {};
  const dependencies = {
    '../services/dashboard-message-info': info,
    '../services/message-memory': {
      getPhoneFromLid: (jid) => jid === lid ? pn : undefined,
      getLidFromPhone: (jid) => jid === pn ? lid : undefined,
      getSenderIdentity: (message, socket) => ({ jid: message.key.fromMe ? socket.user.id : message.key.participant || message.key.remoteJid }),
      editAiMemoryMessage: (...args) => memoryEdits.push(args),
      findAiMemoryMessage: () => undefined,
    },
    '../services/deleted-message-recovery': { loadState: () => state, unwrapMessageInfo: (message) => ({ message }), findStoredMessageById: () => undefined },
    './outbound-queue': { UnrecoverableError: class extends Error {} },
    '../config': { SESSION_PATH: 'unused-test-session' },
    fs: { existsSync: () => false },
    path,
    express: { static: () => () => {} },
  };
  const compiled = fs.readFileSync(path.join(__dirname, '../dist/core/api-server.js'), 'utf8');
  new Function('require', 'exports', compiled)((name) => dependencies[name] || {}, exports);
  const api = Object.create(exports.ApiServer.prototype);
  Object.assign(api, {
    liveMessageStore: new Map(), messageInfoStore: new Map(), reactionStore: new Map(), rawMessageMap: new Map(), chatLastActiveMap: new Map(),
    io: { emit() {}, to: (room) => ({ emit: (event, payload) => events.push({ room, event, payload }) }) },
    getStatusPayload: () => ({}),
    dashboardState: new DashboardState(testDirectory()),
    outboundQueue: { start() {}, enqueue: async (...args) => { queued.push(args); return 'queued-job'; }, list: async () => [] },
    app: {
      get: (route, ...handlers) => routes.set(route, handlers.at(-1)),
      post: (route, ...handlers) => routes.set(route, handlers.at(-1)), delete() {}, use() {},
    },
  });
  api.setupRoutes();
  return { api, events, routes, state, queued, memoryEdits };
}

function chatMessage(chatJid = pn) {
  return { id: key.id, chatJid, senderJid: pn, senderName: 'Sender', senderNumber: '123', fromMe: true,
    timestamp: whatsappTimestamp(timestamp), text: 'Hello', type: 'conversation' };
}

test('timestamps support protobuf Long values and reject invalid dates', () => {
  assert.equal(whatsappTimestamp({ toString: () => String(timestamp) }), '2023-11-14T22:13:20.000Z');
  for (const value of [undefined, null, 0, -1, NaN, Infinity, 9e15]) assert.equal(whatsappTimestamp(value), undefined);
});

test('unknown stays unknown; status zero and stub zero are preserved', () => {
  assert.deepEqual(messageInfo({}), {});
  assert.deepEqual(messageInfo({ status: 0, messageStubType: 0, messageStubParameters: ['detail'] }), {
    status: 'error', statusCode: 0, messageStubType: 0, messageStubParameters: ['detail'],
  });
  assert.equal(messageInfo({ key: { senderLid: '456:2@lid' } }).senderLid, lid);
});

test('confirmed status never regresses on delayed ACKs or replayed upserts', () => {
  for (const status of [0, 1, 2, 3]) {
    assert.equal(mergeMessageInfo(messageInfo({ status: 4 }), messageInfo({ status })).status, 'read');
  }
  assert.equal(mergeMessageInfo(messageInfo({ status: 1 }), messageInfo({ status: 0 })).status, 'error');
  assert.equal(mergeMessageInfo(messageInfo({ status: 0 }), messageInfo({ status: 2 })).status, 'sent');
});

test('partial and duplicate recipient receipts retain each supplied timestamp', () => {
  const read = receiptInfo({ userJid: pn, readTimestamp: timestamp + 10 });
  const delivered = receiptInfo({ userJid: '123:2@s.whatsapp.net', receiptTimestamp: timestamp });
  let merged = mergeMessageInfo({ receipts: [read] }, { receipts: [delivered] }, true);
  merged = mergeMessageInfo(merged, { receipts: [read] }, true);
  assert.equal(merged.status, 'read');
  assert.equal(merged.receipts.length, 1);
  assert.equal(merged.receipts[0].deliveredAt, whatsappTimestamp(timestamp));
  assert.equal(merged.receipts[0].readAt, whatsappTimestamp(timestamp + 10));
  assert.equal(merged.receipts[0].playedAt, undefined);
  merged = mergeMessageInfo(merged, { receipts: [receiptInfo({ userJid: pn, playedTimestamp: timestamp + 20 })] }, true);
  assert.equal(merged.status, 'played');
  assert.equal(merged.receipts[0].playedAt, whatsappTimestamp(timestamp + 20));
});

test('one group member reading does not imply everyone has read', () => {
  const merged = mergeMessageInfo(messageInfo({ status: 2 }), {
    receipts: [receiptInfo({ userJid: pn, readTimestamp: timestamp })],
  });
  assert.equal(merged.status, 'sent');
});

test('early receipt survives later message insertion and phone/LID aliases', () => {
  const { api, events } = dashboard();
  api.handleMessageUpdates([{ key: { ...key, remoteJid: lid }, update: { status: 4 } }]);
  assert.equal(api.liveMessageStore.size, 0);
  const message = chatMessage();
  api.addMessageToStore(message, { key, status: 1, messageTimestamp: timestamp });
  assert.equal(message.status, 'read');
  assert.equal(message.serverTimestamp, whatsappTimestamp(timestamp));
  assert.equal(message.senderLid, lid);
  const activity = api.chatLastActiveMap.get(pn);
  api.handleMessageReceipts([{ key, receipt: { userJid: lid, playedTimestamp: timestamp + 20 } }]);
  assert.equal(message.status, 'played');
  assert.equal(message.receipts[0].userJid, pn);
  assert.equal(api.chatLastActiveMap.get(pn), activity);
  assert.ok(events.every((event) => event.room === 'auth' && event.event === 'chat:message-info'));
});

test('same message ID in a different chat cannot receive the wrong status', () => {
  const { api } = dashboard();
  const other = chatMessage('789@s.whatsapp.net');
  api.addMessageToStore(other);
  api.handleMessageUpdates([{ key, update: { status: 4 } }]);
  assert.equal(other.status, undefined);
});

test('snapshot and live receipts merge across recipient phone/LID aliases', () => {
  const { api } = dashboard();
  const groupKey = { ...key, remoteJid: 'group@g.us' };
  const message = chatMessage(groupKey.remoteJid);
  api.addMessageToStore(message, { key: groupKey, status: 2, userReceipt: [{ userJid: lid, receiptTimestamp: timestamp }] });
  api.handleMessageReceipts([{ key: groupKey, receipt: { userJid: pn, readTimestamp: timestamp + 10 } }]);
  assert.equal(message.receipts.length, 1);
  assert.equal(message.receipts[0].userJid, pn);
  assert.equal(message.receipts[0].deliveredAt, whatsappTimestamp(timestamp));
  assert.equal(message.receipts[0].readAt, whatsappTimestamp(timestamp + 10));
  assert.equal(message.status, 'sent');
});

test('live status survives metadata cache eviction without leaking message bodies', () => {
  const { api, events } = dashboard();
  const message = chatMessage();
  api.addMessageToStore(message, { key, status: 4 });
  api.messageInfoStore.clear();
  api.handleMessageUpdates([{ key, update: { status: 2 } }]);
  assert.equal(message.status, 'read');
  assert.equal(events.at(-1).payload.text, undefined);
});

test('history reload preserves receipt metadata and existing rich message fields', async () => {
  const { api, routes, state } = dashboard();
  const message = { ...chatMessage(), poll: { name: 'Question', options: ['A'], selectableCount: 1 } };
  api.addMessageToStore(message, { key, status: 2 });
  api.handleMessageUpdates([{ key, update: { status: 4, messageStubType: 1, messageStubParameters: ['detail'] } }]);
  state.messages.push({ ...chatMessage(), messageId: key.id, messageType: 'conversation' });
  let response;
  await routes.get('/api/chats/:jid/messages')({ params: { jid: pn }, query: {} }, { json: (data) => { response = data; } });
  assert.equal(response.messages.length, 1);
  assert.equal(response.messages[0].status, 'read');
  assert.equal(response.messages[0].messageStubType, 1);
  assert.equal(response.messages[0].poll.name, 'Question');
});

test('history-only metadata is bounded and does not create chat activity', () => {
  const { api } = dashboard();
  for (let i = 0; i < 1005; i++) api.handleMessageUpdates([{ key: { ...key, id: String(i) }, update: { status: 3 } }]);
  assert.equal(api.messageInfoStore.size, 1000);
  assert.equal(api.liveMessageStore.size, 0);
  assert.equal(api.chatLastActiveMap.size, 0);
});

test('reaction replacement, removal, duplicates, and delayed adds preserve counts', () => {
  const { api, events } = dashboard();
  const message = chatMessage('group@g.us');
  api.addMessageToStore(message);
  const react = (sender, emoji, timestamp) => api.handleMessageReactions([{
    key: { ...key, remoteJid: message.chatJid },
    reaction: { key: { remoteJid: message.chatJid, participant: sender }, text: emoji, senderTimestampMs: timestamp },
  }]);
  react(pn, '👍', 10);
  react(lid, '👍', 10);
  react('789@s.whatsapp.net', '👍', 11);
  assert.equal(message.reactions['👍'], 2);
  react(pn, '❤️', 12);
  assert.equal(message.reactions['👍'], 1);
  assert.equal(message.reactions['❤️'], 1);
  react(pn, '', 13);
  react(pn, '❤️', 12);
  assert.equal(message.reactions['❤️'], undefined);
  assert.equal(message.reactions['👍'], 1);
  const count = events.length;
  react(pn, '', 13);
  assert.equal(events.length, count);
  assert.equal(api.liveMessageStore.get(message.chatJid).length, 1);
  assert.ok(events.every((event) => event.room === 'auth' && event.event === 'chat:reaction'));
});

test('early reactions and removals survive message arrival and history reload', async () => {
  const { api, routes } = dashboard();
  api.applyReaction(lid, key.id, pn, '👍', 10);
  assert.equal(api.liveMessageStore.size, 0);
  const message = chatMessage();
  api.addMessageToStore(message);
  assert.equal(message.reactions['👍'], 1);
  api.applyReaction(pn, key.id, pn, '', 11);
  let response;
  await routes.get('/api/chats/:jid/messages')({ params: { jid: pn }, query: {} }, { json: (data) => { response = data; } });
  assert.deepEqual(Object.keys(response.messages[0].reactions), []);
});

test('dashboard send and its upsert/native echoes produce one own reaction', async () => {
  const { api, routes } = dashboard();
  const socket = { user: { id: '999:2@s.whatsapp.net' }, sendMessage: async () => ({
    message: { reactionMessage: { senderTimestampMs: 10 } },
  }) };
  api.setBotSocket(socket);
  const message = chatMessage();
  api.addMessageToStore(message);
  await routes.get('/api/chats/send-reaction')({ body: { jid: pn, messageId: key.id, emoji: '👍', fromMe: true } }, { json() {} });
  api.handleIncomingMessage({ key: { remoteJid: pn, id: 'reaction-1', fromMe: true }, message: {
    reactionMessage: { key, text: '👍', senderTimestampMs: 10 },
  } });
  api.handleMessageReactions([{ key, reaction: { key: { remoteJid: pn, fromMe: true }, text: '👍', senderTimestampMs: 10 } }]);
  assert.equal(message.reactions['👍'], 1);
  assert.equal(api.liveMessageStore.get(pn).length, 1);
  await routes.get('/api/chats/send-reaction')({ body: { jid: pn, messageId: key.id, emoji: '', fromMe: true } }, { json() {} });
  assert.deepEqual(Object.keys(message.reactions), []);
});

test('edits preserve original timing, reject stale changes, and survive replay/restart', () => {
  const { api, memoryEdits, events } = dashboard();
  const original = chatMessage();
  api.addMessageToStore(original, { key, messageTimestamp: timestamp, status: 2 });
  const edit = (text, seconds) => api.handleMessageUpdates([{ key, update: {
    message: { editedMessage: { message: { conversation: text } } }, messageTimestamp: seconds,
  } }]);
  edit('Corrected', timestamp + 60);
  edit('Stale', timestamp + 30);
  assert.equal(original.text, 'Corrected');
  assert.equal(original.timestamp, whatsappTimestamp(timestamp));
  assert.equal(original.serverTimestamp, whatsappTimestamp(timestamp));
  assert.equal(original.isEdited, true);
  assert.ok(memoryEdits.some((args) => args[1] === key.id && args[2] === 'Corrected'));
  api.dashboardState = new DashboardState(api.dashboardState.directory);
  const replay = chatMessage();
  api.addMessageToStore(replay);
  assert.equal(replay.text, 'Corrected');
  assert.equal(api.liveMessageStore.get(pn).length, 1);
  assert.ok(events.some((event) => event.event === 'chat:message-edited'));
});

test('AI memory edits change only the target and preserve unrelated/malformed lines', () => {
  const directory = testDirectory();
  const file = path.join(directory, 'memory.jsonl');
  fs.writeFileSync(file, [JSON.stringify({ chatJid: pn, messageId: key.id, text: 'Old', ts: 'original' }), 'malformed line', JSON.stringify({ chatJid: 'other', messageId: key.id, text: 'Keep' })].join('\n'));
  const exports = {};
  const dependencies = { fs, path, '../config': { SESSION_PATH: directory, AI_MEMORY_FILE: file, AI_MEMORY_MAX_TEXT_CHARS: 1000, AI_MEMORY_ENABLED: true }, '../core/logger': {} };
  new Function('require', 'exports', fs.readFileSync(path.join(__dirname, '../dist/services/message-memory.js'), 'utf8'))((name) => dependencies[name] || {}, exports);
  exports.editAiMemoryMessage([pn], key.id, 'New', 'conversation', '2026-10-05T01:00:00.000Z');
  exports.editAiMemoryMessage([pn], key.id, 'Stale', 'conversation', '2026-10-05T00:00:00.000Z');
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  assert.equal(JSON.parse(lines[0]).text, 'New');
  assert.equal(JSON.parse(lines[0]).ts, 'original');
  assert.equal(lines[1], 'malformed line');
  assert.equal(JSON.parse(lines[2]).text, 'Keep');
  exports.recordAiMemoryMessage({ key: { remoteJid: pn, id: 'edit-stanza' }, message: { protocolMessage: { type: 14 } } }, {}, '', 'protocolMessage', timestamp);
  assert.equal(fs.readFileSync(file, 'utf8'), lines.join('\n'));
});

test('native stars deduplicate aliases, persist snippets/edits, and unstar after restart', () => {
  const { api } = dashboard();
  api.addMessageToStore(chatMessage());
  api.handleMessageUpdates([{ key: { ...key, remoteJid: lid }, update: { starred: true } }]);
  assert.equal(api.dashboardState.listStars().length, 1);
  assert.equal(api.dashboardState.listStars()[0].message.text, 'Hello');
  api.handleMessageUpdates([{ key, update: { message: { editedMessage: { message: { conversation: 'Edited star' } } }, messageTimestamp: timestamp + 30 } }]);
  api.dashboardState = new DashboardState(api.dashboardState.directory);
  assert.equal(api.dashboardState.listStars()[0].message.text, 'Edited star');
  api.handleMessageUpdates([{ key, update: { starred: false } }]);
  assert.equal(new DashboardState(api.dashboardState.directory).listStars().length, 0);
});

test('star API synchronizes WhatsApp and avoids local stars when rejected', async () => {
  const { api, routes } = dashboard();
  api.addMessageToStore(chatMessage());
  const calls = [];
  api.setBotSocket({ user: { id: pn }, chatModify: async (...args) => { calls.push(args); } });
  const request = { params: { jid: pn }, body: { messageId: key.id, starred: true } };
  await routes.get('/api/chats/:jid/star')(request, { json() {} });
  assert.equal(calls[0][0].star.messages[0].fromMe, true);
  assert.equal(api.dashboardState.listStars().length, 1);
  let status;
  const response = { status: (value) => { status = value; return response; }, json() {} };
  api.setBotSocket({ user: { id: pn }, chatModify: async () => { throw new Error('Rejected'); } });
  await routes.get('/api/chats/:jid/star')({ ...request, body: { messageId: key.id, starred: false } }, response);
  assert.equal(status, 500);
  assert.equal(api.dashboardState.listStars().length, 1);
});

test('edit API rejects incoming/expired messages and retains text on WhatsApp failure', async () => {
  const { api, routes } = dashboard();
  const message = { ...chatMessage(), timestamp: new Date().toISOString(), fromMe: false };
  api.addMessageToStore(message);
  let status;
  const response = { status: (value) => { status = value; return response; }, json() {} };
  const request = { params: { jid: pn }, body: { messageId: key.id, text: 'New' } };
  await routes.get('/api/chats/:jid/edit-message')(request, response);
  assert.equal(status, 403);
  message.fromMe = true;
  message.timestamp = whatsappTimestamp(timestamp);
  await routes.get('/api/chats/:jid/edit-message')(request, response);
  assert.equal(status, 403);
  message.timestamp = new Date().toISOString();
  api.setBotSocket({ user: { id: pn }, sendMessage: async () => { throw new Error('Rejected'); } });
  await routes.get('/api/chats/:jid/edit-message')(request, response);
  assert.equal(status, 500);
  assert.equal(message.text, 'Hello');
});

test('ephemeral API validates durations and persists only successful changes', async () => {
  const { api, routes } = dashboard();
  const calls = [];
  api.setBotSocket({ user: { id: pn }, sendMessage: async (...args) => { calls.push(args); } });
  let status;
  const response = { status: (value) => { status = value; return response; }, json() {} };
  const route = routes.get('/api/chats/:jid/ephemeral'); // GET and POST share this path in the test registry; POST is last.
  await route({ params: { jid: pn }, body: { duration: 123 } }, response);
  assert.equal(status, 400);
  assert.equal(calls.length, 0);
  await route({ params: { jid: pn }, body: { duration: 604800 } }, response);
  assert.equal(calls[0][1].disappearingMessagesInChat, 604800);
  assert.equal(new DashboardState(api.dashboardState.directory).timer(pn), 604800);
  api.setBotSocket({ user: { id: pn }, sendMessage: async () => { throw new Error('Forbidden'); } });
  await route({ params: { jid: pn }, body: { duration: 86400 } }, response);
  assert.equal(status, 500);
  assert.equal(api.dashboardState.timer(pn), 604800);
  api.handleChatsUpdate([{ id: pn, ephemeralExpiration: null }]);
  assert.equal(api.dashboardState.timer(pn), 0);
});

test('outgoing dashboard text carries the observed disappearing timer', async () => {
  const { api, routes } = dashboard();
  const sent = [];
  api.dashboardState.setTimer(pn, 86400);
  api.setBotSocket({ user: { id: pn }, sendMessage: async (...args) => {
    sent.push(args);
    return { key: { remoteJid: pn, id: 'new-message', fromMe: true } };
  } });
  await routes.get('/api/chats/send')({ body: { jid: pn, text: 'Expires' } }, { json() {} });
  assert.equal(sent[0][2].ephemeralExpiration, 86400);
});

test('edit API sends the original key and updates one existing message on success', async () => {
  const { api, routes } = dashboard();
  const message = { ...chatMessage(), timestamp: new Date().toISOString() };
  api.addMessageToStore(message);
  const sent = [];
  api.setBotSocket({ user: { id: pn }, sendMessage: async (...args) => { sent.push(args); } });
  await routes.get('/api/chats/:jid/edit-message')({ params: { jid: pn }, body: { messageId: key.id, text: 'Correction' } }, { json() {} });
  assert.equal(sent[0][1].edit.id, key.id);
  assert.equal(sent[0][1].edit.fromMe, true);
  assert.equal(message.text, 'Correction');
  assert.equal(api.liveMessageStore.get(pn).length, 1);
});

test('offline send queues text/mentions and reports persistence failure', async () => {
  const { api, routes, queued } = dashboard();
  api.clearBotSocket();
  api.accountJid = () => pn;
  let response;
  let status;
  const res = { status: (code) => { status = code; return res; }, json: (data) => { response = data; } };
  const request = { body: { jid: pn, text: 'Queued', queueOnOffline: true, requestId: 'retry-key', mentionAll: true } };
  await routes.get('/api/chats/send')(request, res);
  assert.equal(response.queued, true);
  assert.equal(queued[0][0].accountJid, pn);
  assert.equal(queued[0][0].mentionAll, true);
  assert.equal(queued[0][1], 'retry-key');
  api.outboundQueue.enqueue = async () => { throw new Error('Redis unavailable'); };
  await routes.get('/api/chats/send')(request, res);
  assert.equal(status, 503);
  assert.equal(response.success, false);
});

test('queued delivery waits for group permissions and reuses its message ID', async () => {
  const { api } = dashboard();
  const metadata = { announce: true, participants: [{ id: pn }, { id: '789@s.whatsapp.net' }], ephemeralDuration: 86400 };
  const calls = [];
  const socket = { user: { id: pn }, groupMetadata: async () => metadata,
    sendMessage: async (...args) => { calls.push(args); return { key: { remoteJid: 'group@g.us', id: 'stable-id' } }; } };
  api.setBotSocket(socket);
  api.handleIncomingMessage = () => {};
  const message = { chatJid: 'group@g.us', accountJid: pn, text: '@everyone Hi', messageId: 'stable-id', queuedAt: new Date().toISOString() };
  assert.equal(await api.deliverQueuedMessage(message), false);
  assert.equal(calls.length, 0);
  metadata.announce = false;
  assert.equal(await api.deliverQueuedMessage(message), true);
  assert.equal(calls[0][2].messageId, 'stable-id');
  assert.equal(calls[0][2].ephemeralExpiration, 86400);
  assert.equal(calls[0][1].mentions.length, 2);
  await assert.rejects(api.deliverQueuedMessage({ ...message, accountJid: 'other@s.whatsapp.net' }), /another WhatsApp account/);
  assert.equal(calls.length, 1);
});

function outboundQueue(deliver, unavailable = false) {
  const jobs = new Map();
  class FakeQueue {
    on() {}
    async waitUntilReady() { if (unavailable) throw new Error('Redis unavailable'); }
    async add(name, data, options) { if (!jobs.has(options.jobId)) jobs.set(options.jobId, { name, data, options }); }
  }
  class FakeWorker { on() {} }
  const exports = {};
  const dependencies = { bullmq: { Queue: FakeQueue, Worker: FakeWorker, DelayedError: class extends Error {}, UnrecoverableError: class extends Error {} }, crypto: require('node:crypto'), '../config': {}, './logger': {} };
  new Function('require', 'exports', fs.readFileSync(path.join(__dirname, '../dist/core/outbound-queue.js'), 'utf8'))((name) => dependencies[name] || {}, exports);
  return { queue: new exports.OutboundQueue(deliver), jobs };
}

test('outbound jobs deduplicate request IDs and retain retry policy', async () => {
  const { queue, jobs } = outboundQueue(async () => true);
  const message = { chatJid: pn, accountJid: pn, text: 'Hello' };
  const first = await queue.enqueue(message, 'same-request');
  assert.equal(await queue.enqueue(message, 'same-request'), first);
  assert.equal(jobs.size, 1);
  const job = jobs.get(first);
  assert.equal(job.options.attempts, 5);
  assert.equal(job.options.backoff.type, 'exponential');
  assert.equal(job.data.messageId.length, 32);
  const unavailable = outboundQueue(async () => true, true);
  await assert.rejects(unavailable.queue.enqueue(message), /Redis unavailable/);
  assert.equal(unavailable.jobs.size, 0);
});

test('outbound jobs delay blocked sends and skip already delivered retries', async () => {
  let calls = 0;
  let allowed = false;
  const { queue } = outboundQueue(async () => { calls++; return allowed; });
  const job = { data: { messageId: 'stable-id' }, moveToDelayed: async (...args) => { job.delay = args; }, updateData: async (data) => { job.data = data; } };
  await assert.rejects(queue.process(job, 'token'));
  assert.equal(job.delay[1], 'token');
  assert.equal(job.data.delivered, undefined);
  allowed = true;
  await queue.process(job);
  await queue.process(job);
  assert.equal(job.data.delivered, true);
  assert.equal(job.data.messageId, 'stable-id');
  assert.equal(calls, 2);
});

const html = fs.readFileSync(path.join(__dirname, '../public/auth.html'), 'utf8');

test('all inline dashboard scripts parse', () => {
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(match[1]);
});

test('info modal escapes receipt/stub data and refreshes with live status', () => {
  const elements = {
    'message-info-content': {}, 'msg-status-message-1': { style: {} },
    'modal-message-info': { classList: { contains: () => true } },
  };
  const message = { ...chatMessage(), messageStubParameters: ['<script>bad</script>'],
    receipts: [{ userJid: '<img src=x>', readAt: whatsappTimestamp(timestamp) }] };
  const handlers = {};
  const context = vm.createContext({
    currentMessages: [message], selectedChat: { id: pn },
    document: { getElementById: (id) => elements[id] },
    openModal() {}, showToast() {}, socket: { on: (name, handler) => { handlers[name] = handler; } },
    escapeHtml: (value) => String(value).replace(/[<>&"']/g, (char) => `&#${char.charCodeAt(0)};`),
  });
  vm.runInContext(html.slice(html.indexOf('    // --- Message Information Modal Engine ---'), html.indexOf('    function copyRawMessageJson()')), context);
  vm.runInContext("showMessageInfo('message-1')", context);
  assert.match(elements['message-info-content'].innerHTML, /Unknown/);
  assert.match(elements['message-info-content'].innerHTML, /Unavailable/);
  assert.doesNotMatch(elements['message-info-content'].innerHTML, /<script>bad|<img src=x>|Read \/ Delivered/);
  const start = html.indexOf("      socket.on('chat:message-info'");
  vm.runInContext(html.slice(start, html.indexOf("      socket.on('chat:message-deleted'", start)), context);
  handlers['chat:message-info']({ chatJid: pn, messageId: key.id, status: 'read', statusCode: 4 });
  assert.equal(elements['msg-status-message-1'].textContent, '✓✓');
  assert.equal(elements['msg-status-message-1'].style.color, '#38bdf8');
  assert.match(elements['message-info-content'].innerHTML, />Read</);
});
