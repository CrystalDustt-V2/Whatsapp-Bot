// Run after npm run build: node --test scripts/media-extraction.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { test } = require('node:test');
const sharp = require('sharp');
const qrcode = require('qrcode');
const types = require('../dist/types');

// Load the real compiled commands with offline media/provider adapters.
function load(file, dependencies) {
  const exports = {};
  const code = fs.readFileSync(path.join(__dirname, '../dist', file), 'utf8');
  new Function('require', 'exports', code)((name) => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}

function context(message = {}, args = []) {
  const replies = [], sends = [];
  return {
    args, replies, sends,
    message: { key: { remoteJid: 'test@s.whatsapp.net', fromMe: false }, message },
    reply: async (text) => { replies.push(text); },
    socket: { sendMessage: async (...data) => { sends.push(data); } },
  };
}

function downloader(chunks) {
  let stream, calls = 0;
  const helpers = load('commands/media/helpers.js', {
    '@whiskeysockets/baileys': {
      downloadContentFromMessage: async () => {
        calls++;
        stream = Readable.from(chunks);
        return stream;
      },
    },
  });
  return { ...helpers, get calls() { return calls; }, get stream() { return stream; } };
}

const MediaSizeError = downloader([]).MediaSizeError;

function commands(media, options = {}) {
  const providerCalls = [], downloadCalls = [];
  const config = {
    PUTER_AUTH_TOKEN: 'offline-test', PUTER_TIMEOUT_MS: 30000,
    AI_STT_MODEL: '', PUTER_STT_MODEL: 'test-model', AI_STT_TIMEOUT_MS: 60000,
    AI_STT_LANGUAGE: 'id', ...options.config,
  };
  const helpers = {
    MediaSizeError,
    downloadMediaFromContext: async (...args) => {
      downloadCalls.push(args);
      if (options.downloadError) throw options.downloadError;
      return media;
    },
  };
  const service = {};
  for (const name of ['analyzeImage', 'speechToText']) {
    service[name] = async (...args) => {
      providerCalls.push({ name, args });
      if (options.providerError) throw options.providerError;
      return { text: options.text ?? 'Extracted text' };
    };
  }
  const extraction = load('commands/utility/extract.js', {
    sharp, '../../config': config, '../../services/ai-service': service,
    '../../types': types, '../media/helpers': helpers,
  });
  const qr = load('commands/utility/qr.js', {
    sharp, jsqr: require('jsqr'), '../../types': types,
    '../../services/text-utils': {}, '../media/helpers': helpers,
  });
  return { ...extraction, ...qr, providerCalls, downloadCalls };
}

test('download resolves nested quoted media and keeps the unlimited default', async () => {
  const helpers = downloader([Buffer.from('ab'), Buffer.from('cd')]);
  const ctx = context({ ephemeralMessage: { message: { extendedTextMessage: { contextInfo: {
    quotedMessage: { viewOnceMessageV2: { message: { imageMessage: { mimetype: 'image/jpeg' } } } },
  } } } } });
  const media = await helpers.downloadMediaFromContext(ctx, ['image']);
  assert.equal(media.buffer.toString(), 'abcd');
  assert.equal(media.extension, 'jpg');
  assert.equal(media.kind, 'image');
});

test('download refuses oversized declared lengths before opening a stream', async () => {
  const helpers = downloader([Buffer.from('a')]);
  await assert.rejects(helpers.downloadMediaFromContext(context({ audioMessage: { fileLength: 5 } }), ['audio'], 4), helpers.MediaSizeError);
  assert.equal(helpers.calls, 0);
});

test('download enforces actual byte count and closes the stream on overflow', async () => {
  const helpers = downloader([Buffer.from('abc'), Buffer.from('def')]);
  await assert.rejects(helpers.downloadMediaFromContext(context({ imageMessage: {} }), ['image'], 5), helpers.MediaSizeError);
  assert.equal(helpers.stream.destroyed, true);
});

test('download accepts the exact limit and ignores unsupported media', async () => {
  const helpers = downloader([Buffer.from('1234')]);
  assert.equal((await helpers.downloadMediaFromContext(context({ audioMessage: {} }), ['audio'], 4)).buffer.length, 4);
  assert.equal(await helpers.downloadMediaFromContext(context({ videoMessage: {} }), ['image']), null);
  assert.equal(helpers.calls, 1);
});

test('QR decoder reads regular, rotated, grayscale and inverted codes', async () => {
  const { decodeQRCode } = commands(null);
  const text = 'CrystalDust QR round trip';
  const png = await qrcode.toBuffer(text, { width: 320 });
  const variants = [png, await sharp(png).rotate(90).png().toBuffer(),
    await sharp(png).greyscale().png().toBuffer(), await sharp(png).negate({ alpha: false }).png().toBuffer()];
  for (const image of variants) assert.equal(await decodeQRCode(image), text);
  const blank = await sharp({ create: { width: 64, height: 64, channels: 3, background: 'white' } }).png().toBuffer();
  assert.equal(await decodeQRCode(blank), null);
  await assert.rejects(decodeQRCode(Buffer.from('invalid image')));
});

test('QR command returns decoded URLs with preview fetching disabled', async () => {
  const buffer = await qrcode.toBuffer('https://example.com/qr-test');
  const { QRReaderCommand } = commands({ buffer, kind: 'image', mimetype: 'image/png' });
  const ctx = context();
  await QRReaderCommand.execute(ctx);
  assert.equal(ctx.sends[0][1].text, 'QR code text:\nhttps://example.com/qr-test');
  assert.equal(ctx.sends[0][1].linkPreview, null);
  assert.equal(ctx.sends[0][2].quoted, ctx.message);
});

test('OCR normalizes images, strips metadata and chunks Unicode text without loss', async () => {
  const buffer = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'white' } }).withMetadata().jpeg().toBuffer();
  const text = '🙂'.repeat(3501) + '\nFinal line';
  const loaded = commands({ buffer, kind: 'document', mimetype: 'image/jpeg' }, { text });
  const ctx = context();
  await loaded.OCRCommand.execute(ctx);
  assert.equal(ctx.replies.join(''), text);
  assert.equal(ctx.replies.length, 2);
  const call = loaded.providerCalls[0];
  assert.equal(call.name, 'analyzeImage');
  const metadata = await sharp(call.args[0]).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.exif, undefined);
  assert.equal(call.args[1].mimeType, 'image/png');
  assert.equal(loaded.downloadCalls[0][2], 20 * 1024 * 1024);
});

test('STT preserves audio and uses explicit language with configured model fallback', async () => {
  const buffer = Buffer.from('offline audio fixture');
  const loaded = commands({ buffer, kind: 'audio', mimetype: 'audio/ogg; codecs=opus' });
  const ctx = context({}, ['en-US']);
  await loaded.SpeechToTextCommand.execute(ctx);
  assert.equal(ctx.replies[0], 'Extracted text');
  assert.equal(loaded.providerCalls[0].args[0], buffer);
  assert.deepEqual(loaded.providerCalls[0].args[1], {
    mimeType: 'audio/ogg; codecs=opus', language: 'en-US', model: 'test-model', timeoutMs: 60000,
  });
});

test('STT handles configured language, audio documents and empty transcripts', async () => {
  const loaded = commands({ buffer: Buffer.from('audio'), kind: 'document', mimetype: 'audio/mpeg' }, { text: '  ' });
  const ctx = context();
  await loaded.SpeechToTextCommand.execute(ctx);
  assert.equal(loaded.providerCalls[0].args[1].language, 'id');
  assert.match(ctx.replies[0], /No speech/);
});

test('AI commands without credentials skip downloads and provider calls', async () => {
  const loaded = commands(null, { config: { PUTER_AUTH_TOKEN: '' } });
  for (const command of [loaded.OCRCommand, loaded.SpeechToTextCommand]) {
    const ctx = context();
    await command.execute(ctx);
    assert.match(ctx.replies[0], /PUTER_AUTH_TOKEN/);
  }
  assert.equal(loaded.downloadCalls.length, 0);
  assert.equal(loaded.providerCalls.length, 0);
});

test('invalid STT arguments skip download and return usage', async () => {
  const loaded = commands(null);
  for (const args of [['invalid-language-code'], ['en', 'extra']]) {
    const ctx = context({}, args);
    await loaded.SpeechToTextCommand.execute(ctx);
    assert.match(ctx.replies[0], /Usage/);
  }
  assert.equal(loaded.downloadCalls.length, 0);
});

test('missing and unsupported documents produce help without provider calls', async () => {
  for (const media of [null, { buffer: Buffer.from('pdf'), kind: 'document', mimetype: 'application/pdf' }]) {
    const loaded = commands(media);
    for (const command of [loaded.QRReaderCommand, loaded.OCRCommand, loaded.SpeechToTextCommand]) {
      const ctx = context();
      await command.execute(ctx);
      assert.equal(ctx.replies.length, 1);
      assert.equal(ctx.sends.length, 0);
    }
    assert.equal(loaded.providerCalls.length, 0);
  }
});

test('size and provider failures return actionable replies', async () => {
  const sizeError = new MediaSizeError(20 * 1024 * 1024);
  const limited = commands(null, { downloadError: sizeError });
  const failed = commands({ buffer: Buffer.from('audio'), kind: 'audio', mimetype: 'audio/ogg' }, { providerError: new Error('offline') });
  const ctx = context();
  await failed.SpeechToTextCommand.execute(ctx);
  assert.match(ctx.replies[0], /Transcription failed/);
  for (const command of [limited.QRReaderCommand, limited.OCRCommand, limited.SpeechToTextCommand]) {
    const limitCtx = context();
    await command.execute(limitCtx);
    assert.equal(limitCtx.replies[0], 'Media exceeds the 20 MB limit.');
  }
});
