# QR reading, OCR and transcription

- `.qrread` (aliases `.readqr`, `.scanqr`, `.qrreader`): reply to an image or sticker to read one QR code. Decoding runs locally; decoded links are returned as text without fetching a preview. `.qr <text>` still generates QR codes.
- `.ocr` (aliases `.imagetotext`, `.image2text`, `.readtext`): reply to an image or sticker to extract its text through the existing Puter OCR service. You can also send an image with `.ocr` or `.qrread` in its caption.
- `.stt [language code]` (aliases `.transcribe`, `.speech2text`, `.speechtotext`): reply to an audio message or voice note to transcribe it through Puter. Example: `.stt id` or `.stt en-US`. Without an argument, the command uses `AI_STT_LANGUAGE`.

Image documents work with QR reading and OCR; audio documents work with transcription. Inputs are limited to 20 MB. Image decoding accepts up to 16,777,216 pixels and resizes to fit within 2048 × 2048 pixels. Long OCR results and transcripts are split into replies.

OCR and transcription require `PUTER_AUTH_TOKEN`. Transcription uses the existing `AI_STT_MODEL` / `PUTER_STT_MODEL` and `AI_STT_TIMEOUT_MS` settings. See [Puter setup](puter-ai-setup.md). These commands send media to Puter only when invoked; they do not automatically process incoming messages. OCR strips image metadata before upload.

Verification, from PowerShell:

```powershell
npm run build
node --test scripts/media-extraction.test.cjs
```

The tests use actual image processing and QR decoding with mocked WhatsApp downloads and AI providers. Live Puter authentication and transcription are not exercised by this suite.
