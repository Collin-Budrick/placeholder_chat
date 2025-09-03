#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findRepoRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    const cargo = path.join(dir, 'Cargo.toml');
    const gw = path.join(dir, 'apps', 'gateway', 'Cargo.toml');
    if (existsSync(cargo) && existsSync(gw)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const repoRoot = findRepoRoot(__dirname);
if (!repoRoot) {
  console.error('Could not locate repo root containing Cargo.toml and apps/gateway/Cargo.toml');
  process.exit(1);
}

const manifestPath = path.join(repoRoot, 'apps', 'gateway', 'Cargo.toml');

const env = { ...process.env };
// Set helpful dev defaults if not provided
if (!env.CORS_ALLOW_ORIGINS || env.CORS_ALLOW_ORIGINS === '') {
  env.CORS_ALLOW_ORIGINS = 'http://127.0.0.1:5173,http://localhost:5173';
}
// If a forced dev URL is provided, include it for CORS
const forceUrl = env.WEB_FORCE_URL || env.DEV_SERVER_URL || env.LAN_DEV_URL;
if (forceUrl) {
  try {
    const u = new URL(forceUrl);
    const origin = `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}`;
    if (!env.CORS_ALLOW_ORIGINS.split(',').includes(origin)) {
      env.CORS_ALLOW_ORIGINS = env.CORS_ALLOW_ORIGINS + ',' + origin;
    }
  } catch {}
}
if (!env.RUST_LOG) env.RUST_LOG = 'info';

const args = ['run', '--manifest-path', manifestPath];
const child = spawn('cargo', args, {
  cwd: repoRoot,
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`gateway exited via signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 0);
});

process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
