#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import fssync from 'node:fs';

const repoRoot = process.cwd();
const webDir = path.join(repoRoot, 'apps', 'web');
const sharedDir = path.join(repoRoot, 'packages', 'shared');

const PORT = process.env.PORT || process.env.WEB_PORT || '5173';

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      ...opts,
    });
    child.on('exit', (code, signal) => {
      if (signal) return resolve({ code: 1, signal });
      resolve({ code: code ?? 0 });
    });
  });
}

async function main() {
  console.log('[prod:all] Building shared package...');
  const shared = await run('bun', ['run', 'build'], { cwd: sharedDir });
  if (shared.code !== 0) {
    console.error('[prod:all] Shared build failed');
    process.exit(shared.code);
  }

  console.log('[prod:all] Building web (preview/SSR bundle) ...');
  // Clean previous outputs to avoid manifest/hash mismatches
  const outDir = path.join(webDir, 'dist');
  const serverDir = path.join(webDir, 'server');
  try {
    if (fssync.existsSync(outDir)) await fs.rm(outDir, { recursive: true, force: true });
    if (fssync.existsSync(serverDir)) await fs.rm(serverDir, { recursive: true, force: true });
  } catch {}
  // Build preview SSR output
  let r = await run('bun', ['run', 'qwik', 'build', 'preview'], { cwd: webDir });
  if (r.code !== 0) {
    // Some shells don't forward args; fall back to npm-style script
    r = await run('npx', ['qwik', 'build', 'preview'], { cwd: webDir });
    if (r.code !== 0) {
      console.error('[prod:all] Qwik preview build failed');
      process.exit(r.code);
    }
  }
  console.log(`[prod:all] Starting HTTPS preview on https://localhost:${PORT}`);
  // Serve using custom HTTPS wrapper to avoid Vite's lack of --https for preview
  const child = spawn('node', ['scripts/preview-https.js', '--host', '0.0.0.0', '--port', PORT], {
    stdio: 'inherit',
    cwd: webDir,
    shell: process.platform === 'win32',
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  console.error('[prod:all] Failed:', err);
  process.exit(1);
});
