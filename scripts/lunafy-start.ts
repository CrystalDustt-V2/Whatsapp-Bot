#!/usr/bin/env ts-node-esm

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const shell = process.platform === 'win32';

function enabled(name: string, fallback = true): boolean {
  const value = process.env[name];

  if (value === undefined || value === '') {
    return fallback;
  }

  return !['0', 'false', 'no', 'off'].includes(value.toLowerCase());
}

function run(command: string, args: string[]): void {
  console.log(`> ${command} ${args.join(' ')}`);

  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    shell,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function output(command: string, args: string[]): string {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    shell,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  return result.status === 0 ? result.stdout.trim() : '';
}

function updateFromGit(): void {
  if (!enabled('AUTO_GIT_PULL')) {
    console.log('Skipping git update: AUTO_GIT_PULL is disabled.');
    return;
  }

  if (!existsSync(path.join(root, '.git'))) {
    console.log('Skipping git update: .git directory not found.');
    return;
  }

  const remote = process.env.GIT_REMOTE || 'origin';
  const branch =
    process.env.GIT_BRANCH ||
    output('git', ['rev-parse', '--abbrev-ref', 'HEAD']);

  if (!branch || branch === 'HEAD') {
    console.log('Skipping git update: set GIT_BRANCH for detached checkouts.');
    return;
  }

  run('git', ['fetch', '--prune', remote]);
  run('git', ['merge', '--ff-only', `${remote}/${branch}`]);
}

function installDependencies(): void {
  if (!enabled('AUTO_NPM_INSTALL')) {
    console.log('Skipping npm install: AUTO_NPM_INSTALL is disabled.');
    return;
  }

  if (!existsSync(path.join(root, 'package.json'))) {
    console.log('Skipping npm install: package.json not found.');
    return;
  }

  run('npm', ['install', '--include=dev']);
}

function generatePrisma(): void {
  if (!enabled('AUTO_PRISMA_GENERATE')) {
    console.log('Skipping Prisma generate: AUTO_PRISMA_GENERATE is disabled.');
    return;
  }

  if (!existsSync(path.join(root, 'prisma', 'schema.prisma'))) {
    console.log('Skipping Prisma generate: prisma/schema.prisma not found.');
    return;
  }

  run('npx', ['prisma', 'generate']);
}

function buildProject(): void {
  if (!enabled('AUTO_BUILD')) {
    console.log('Skipping build: AUTO_BUILD is disabled.');
    return;
  }

  if (!existsSync(path.join(root, 'package.json'))) {
    console.log('Skipping build: package.json not found.');
    return;
  }

  run('npm', ['run', 'build']);
}

function ensureRuntimeDirs(): void {
  const sessionPath = process.env.SESSION_PATH || './sessions';
  const absoluteSessionPath = path.isAbsolute(sessionPath)
    ? sessionPath
    : path.join(root, sessionPath);

  mkdirSync(absoluteSessionPath, { recursive: true });
  mkdirSync(path.join(root, 'logs'), { recursive: true });
  mkdirSync(path.join(root, 'temp'), { recursive: true });

  process.env.SESSION_PATH = sessionPath;
}

function getBotEntryFile(): string {
  const configuredEntry = process.env.BOT_ENTRY || 'dist/index.js';
  const absoluteEntry = path.isAbsolute(configuredEntry)
    ? configuredEntry
    : path.join(root, configuredEntry);

  if (!existsSync(absoluteEntry)) {
    console.error(`Bot entry file not found: ${absoluteEntry}`);
    console.error('Make sure npm run build creates dist/index.js.');
    console.error('Or set BOT_ENTRY to the correct startup file.');
    process.exit(1);
  }

  return absoluteEntry;
}

function startBot(): void {
  process.env.NODE_ENV ||= 'production';
  process.env.PORT ||= process.env.SERVER_PORT || '3001';

  const entryFile = getBotEntryFile();

  console.log(`Starting bot from: ${entryFile}`);
  console.log(`NODE_ENV=${process.env.NODE_ENV}`);
  console.log(`PORT=${process.env.PORT}`);
  console.log(`SESSION_PATH=${process.env.SESSION_PATH || './sessions'}`);

  const child = spawn(process.execPath, [entryFile], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      child.kill(signal);
    });
  }

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code || 0);
  });
}

try {
  updateFromGit();
  installDependencies();
  generatePrisma();
  buildProject();
  ensureRuntimeDirs();
  startBot();
} catch (error) {
  console.error('Startup failed.');

  if (error instanceof Error) {
    console.error(error.stack || error.message);
  } else {
    console.error(error);
  }

  process.exit(1);
}