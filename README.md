# WhatsApp Hybrid Bot Platform

Production-grade modular WhatsApp automation platform built with Node.js, TypeScript, Baileys, Redis, and BullMQ.

## Features

- ✅ Hybrid operation (personal + bot)
- ✅ Prefix-based command system
- ✅ Modular plugin architecture
- ✅ Queue-based workers with BullMQ
- ✅ Redis caching and session management
- ✅ Enterprise-grade media processing
- ✅ Docker and docker-compose support

## Tech Stack

- Node.js 20+
- TypeScript 5
- Baileys (WhatsApp Web)
- Redis
- BullMQ
- FFmpeg
- Sharp

## Quick Start

### Prerequisites

- Node.js 20 or later
- Redis server
- FFmpeg

### Installation

```bash
# Clone repository
git clone <your-repo-url>
cd whatsapp-half-bot-trae-ai

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your configuration
```

### Development

```bash
npm run dev
```

### Production

```bash
npm run build
npm start
```

### Docker

```bash
docker-compose up -d
```

## Project Structure

```scheme
├── src/
│   ├── commands/       # Command definitions
│   ├── core/           # Core bot infrastructure
│   ├── config/         # Configuration files
│   ├── types/          # TypeScript types
│   ├── services/       # Business logic services
│   ├── workers/        # BullMQ workers
│   └── index.ts        # Entry point
├── docker-compose.yml
├── Dockerfile
├── package.json
└── tsconfig.json
```

## License

MIT
