#!/usr/bin/env node
const { spawn, spawnSync } = require('node:child_process');
const { existsSync, mkdirSync, readFileSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const shell = process.platform === 'win32';

function loadDotEnv() {
  const envPath = path.join(root, '.env');
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const equalsAt = trimmed.indexOf('=');
    if (equalsAt < 1) continue;

    const key = trimmed.slice(0, equalsAt).trim();
    let value = trimmed.slice(equalsAt + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] ??= value;
  }
}

function enabled(name, fallback = true) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(value.toLowerCase());
}

function run(command, args) {
  console.log(`> ${command} ${args.join(' ')}`);

  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    shell,
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

function output(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    shell,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  return result.status === 0 ? result.stdout.trim() : '';
}

function updateFromGit() {
  if (!enabled('AUTO_GIT_PULL')) {
    console.log('Skipping git update: AUTO_GIT_PULL is disabled.');
    return;
  }

  if (!existsSync(path.join(root, '.git'))) {
    console.log('Skipping git update: .git directory not found.');
    return;
  }

  const remote = process.env.GIT_REMOTE || 'origin';
  const branch = process.env.GIT_BRANCH || output('git', ['rev-parse', '--abbrev-ref', 'HEAD']);

  if (!branch || branch === 'HEAD') {
    console.log('Skipping git update: set GIT_BRANCH for detached checkouts.');
    return;
  }

  run('git', ['fetch', '--prune', remote]);
  run('git', ['merge', '--ff-only', `${remote}/${branch}`]);
}

function installDependencies() {
  if (!enabled('AUTO_NPM_INSTALL')) {
    console.log('Skipping npm install: AUTO_NPM_INSTALL is disabled.');
    return;
  }

  if (existsSync(path.join(root, 'package-lock.json'))) {
    run('npm', ['ci', '--include=dev']);
    return;
  }

  run('npm', ['install', '--include=dev']);
}

function generatePrisma() {
  if (!enabled('AUTO_PRISMA_GENERATE')) {
    console.log('Skipping Prisma generate: AUTO_PRISMA_GENERATE is disabled.');
    return;
  }

  if (existsSync(path.join(root, 'prisma', 'schema.prisma'))) {
    run('npx', ['prisma', 'generate']);
  }
}

function buildProject() {
  if (enabled('AUTO_BUILD')) {
    run('npm', ['run', 'build']);
  }
}

function ensureRuntimeDirs() {
  const sessionPath = process.env.SESSION_PATH || './sessions';
  const absoluteSessionPath = path.isAbsolute(sessionPath) ? sessionPath : path.join(root, sessionPath);

  mkdirSync(absoluteSessionPath, { recursive: true });
  mkdirSync(path.join(root, 'logs'), { recursive: true });
  mkdirSync(path.join(root, 'temp'), { recursive: true });

  process.env.SESSION_PATH = sessionPath;
}

function getBotEntryFile() {
  const configuredEntry = process.env.BOT_ENTRY || 'dist/index.js';
  const absoluteEntry = path.isAbsolute(configuredEntry) ? configuredEntry : path.join(root, configuredEntry);

  if (!existsSync(absoluteEntry)) {
    console.error(`Bot entry file not found: ${absoluteEntry}`);
    console.error('Make sure npm run build creates dist/index.js, or set BOT_ENTRY.');
    process.exit(1);
  }

  return absoluteEntry;
}

function startBot() {
  process.env.NODE_ENV ||= 'production';
  process.env.PORT = process.env.SERVER_PORT || process.env.PORT || '3001';

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

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal));
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
  loadDotEnv();
  updateFromGit();
  installDependencies();
  generatePrisma();
  buildProject();
  ensureRuntimeDirs();
  startBot();
} catch (error) {
  console.error('Startup failed.');
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
}
