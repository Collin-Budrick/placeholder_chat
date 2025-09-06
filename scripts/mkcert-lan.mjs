#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
    child.on('exit', (code) => resolve(code ?? 0));
  });
}

async function main() {
  const certDir = path.resolve('apps/web/certs');
  const hostsFile = path.join(certDir, '.hosts');
  if (!fs.existsSync(hostsFile)) {
    console.log('[mkcert:lan] Hosts file missing; preparing...');
    const code = await run('bun', ['scripts/regen-mkcert-hosts.mjs']);
    if (code !== 0) process.exit(code);
  }
  const hostsRaw = fs.readFileSync(hostsFile, 'utf8').trim();
  const hosts = hostsRaw.split(/[\s,]+/).filter(Boolean);
  if (hosts.length === 0) {
    console.error('[mkcert:lan] No hosts found. Edit apps/web/certs/.hosts');
    process.exit(1);
  }
  console.log('[mkcert:lan] Installing local CA (if needed) ...');
  let code = await run('mkcert', ['-install']);
  if (code !== 0) {
    console.error('[mkcert:lan] mkcert not found or failed. Install it first:');
    console.error('  Windows (choco): choco install mkcert');
    console.error('  macOS (brew):   brew install mkcert && brew install nss # for Firefox');
    console.error('  Linux:          See https://github.com/FiloSottile/mkcert');
    process.exit(code);
  }
  fs.mkdirSync(certDir, { recursive: true });
  const crt = path.join(certDir, 'dev.crt');
  const key = path.join(certDir, 'dev.key');
  try { if (fs.existsSync(crt)) fs.rmSync(crt); } catch {}
  try { if (fs.existsSync(key)) fs.rmSync(key); } catch {}
  console.log('[mkcert:lan] Generating certificate for:', hosts.join(', '));
  code = await run('mkcert', ['-cert-file', crt, '-key-file', key, ...hosts]);
  if (code !== 0) process.exit(code);
  console.log(`[mkcert:lan] Wrote cert: ${crt}`);
  console.log(`[mkcert:lan] Wrote key:  ${key}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

