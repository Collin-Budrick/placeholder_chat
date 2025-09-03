#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import fssync from 'node:fs';

const repoRoot = process.cwd();
const webDir = path.join(repoRoot, 'apps', 'web');
const sharedDir = path.join(repoRoot, 'packages', 'shared');

const PORT = process.env.PORT || process.env.WEB_PORT || '5173';
const SCHEME = 'https';

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
  // Compose mkcert hosts for LAN access and trusted TLS
  const lanHosts = (() => {
    const ifs = os.networkInterfaces();
    const addrs = [];
    for (const name of Object.keys(ifs)) {
      for (const addr of ifs[name] || []) {
        if (addr.family === 'IPv4' && !addr.internal) addrs.push(addr.address);
      }
    }
    // Prefer 192.168.* by default; allow overriding via WEB_LAN_HOST
    const prefer = (h) => {
      if (process.env.WEB_LAN_HOST && h === process.env.WEB_LAN_HOST) return -1;
      if (/^192\.168\./.test(h)) return 0;
      if (/^10\./.test(h)) return 1;
      if (/^172\./.test(h)) return 2;
      return 3;
    };
    const uniq = Array.from(new Set(addrs));
    return uniq.sort((a, b) => prefer(a) - prefer(b));
  })();
  const forcedUrl = process.env.WEB_FORCE_URL || process.env.DEV_SERVER_URL || '';
  let forcedHost = '';
  try { forcedHost = forcedUrl ? new URL(forcedUrl).hostname : ''; } catch {}
  const mkcertHosts = Array.from(new Set([
    ...(process.env.MKCERT_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean),
    'localhost','127.0.0.1','::1',
    ...(process.env.WEB_LAN_HOST ? [process.env.WEB_LAN_HOST] : []),
    ...(forcedHost ? [forcedHost] : []),
    ...(lanHosts.length ? [lanHosts[0]] : []),
  ]));
  // Propagate computed hosts to env so downstream helpers can reuse
  process.env.MKCERT_HOSTS = process.env.MKCERT_HOSTS || mkcertHosts.join(',');
  // Ensure a trusted mkcert cert exists at apps/web/certs/dev.* with LAN host
  function ensureMkcertCert() {
    const saveDir = path.join(webDir, 'certs');
    const keyPath = path.join(saveDir, 'dev.key');
    const certPath = path.join(saveDir, 'dev.crt');
    const hostsPath = path.join(saveDir, '.hosts');
    try { fssync.mkdirSync(saveDir, { recursive: true }); } catch {}
    const prevHosts = (() => { try { return fssync.readFileSync(hostsPath, 'utf8').trim(); } catch { return ''; } })();
    const envHosts = (process.env.MKCERT_HOSTS || '').split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
    const hosts = Array.from(new Set([
      ...envHosts,
      ...lanHosts.slice(0,1),
      'localhost', '127.0.0.1', '::1',
    ].filter(Boolean)));
    const hostsStr = hosts.join(',');
    const need = process.env.MKCERT_FORCE === '1' || !fssync.existsSync(keyPath) || !fssync.existsSync(certPath) || hostsStr !== prevHosts;
    if (!need) return { keyPath, certPath };
    // find mkcert
    const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['mkcert'], { encoding: 'utf8' });
    if (which.status !== 0) {
      console.warn('[prod:all] mkcert not found; continuing with existing certs if present.');
      return { keyPath, certPath };
    }
    // install CA silently
    spawnSync('mkcert', ['-install'], { stdio: 'ignore', shell: process.platform === 'win32' });
    const args = ['-key-file', keyPath, '-cert-file', certPath, ...hosts];
    console.log('[prod:all] Generating mkcert certificate for hosts:', hosts.join(', '));
    const r = spawnSync('mkcert', args, { stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.status !== 0) console.warn('[prod:all] mkcert generation failed; reusing existing certs if any.');
    try { fssync.writeFileSync(hostsPath, hostsStr, 'utf8'); } catch {}
    return { keyPath, certPath };
  }

  const { keyPath, certPath } = ensureMkcertCert();

  // Use the same HTTPS approach as dev: direct vite preview with preview.https
  const env = {
    ...process.env,
    // Ensure HTTPS is enabled; use explicit cert paths from apps/web/certs
    NO_HTTPS: process.env.NO_HTTPS || '0',
    USE_MKCERT: '0',
    DEV_TLS_KEY_FILE: process.env.DEV_TLS_KEY_FILE || path.relative(webDir, keyPath),
    DEV_TLS_CERT_FILE: process.env.DEV_TLS_CERT_FILE || path.relative(webDir, certPath),
  };
  const child = spawn('vite', ['preview', '--host', '0.0.0.0', '--port', String(PORT), '--strictPort'], {
    stdio: 'inherit',
    cwd: webDir,
    env,
    shell: process.platform === 'win32',
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  console.error('[prod:all] Failed:', err);
  process.exit(1);
});
