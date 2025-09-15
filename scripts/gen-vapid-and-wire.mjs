#!/usr/bin/env bun
import { $ } from 'bun';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

function upsertKV(text, key, value) {
  const lines = text.split(/\r?\n/);
  const idx = lines.findIndex((l) => l.trim().startsWith(key + '='));
  const entry = `${key}=${value}`;
  if (idx === -1) return lines.concat([entry]).join('\n') + '\n';
  lines[idx] = entry;
  return lines.join('\n');
}

function readFileIf(p) {
  try { return existsSync(p) ? readFileSync(p, 'utf8') : ''; } catch { return ''; }
}

async function main() {
  const repoRoot = process.cwd();
  const gwPath = path.join(repoRoot, 'apps', 'gateway');
  console.log('[vapid] generating keys via bunx web-push…');
  let pub = '', priv = '', subj = 'mailto:you@example.com';
  try {
    const proc = await $`bunx --bun web-push generate-vapid-keys --json`.quiet();
    const out = proc.stdout.toString();
    const data = JSON.parse(out);
    pub = data.publicKey;
    priv = data.privateKey;
  } catch (e) {
    console.error('[vapid] bunx web-push failed. Please install web-push globally or run manually. Error:', e);
    process.exit(1);
  }
  if (!pub || !priv) {
    console.error('[vapid] failed to parse keys from output:\n' + out);
    process.exit(1);
  }
  console.log('[vapid] public key:', pub.slice(0, 16) + '…');

  // Update web envs
  const webDir = path.join(repoRoot, 'apps', 'web');
  const prodEnvPath = path.join(webDir, '.env.production');
  let prodEnv = readFileIf(prodEnvPath);
  prodEnv = upsertKV(prodEnv, 'VITE_ENABLE_PUSH', '1');
  prodEnv = upsertKV(prodEnv, 'VITE_PUSH_PUBLIC_KEY', pub);
  writeFileSync(prodEnvPath, prodEnv);
  const devEnvPath = path.join(webDir, '.env.development');
  let devEnv = readFileIf(devEnvPath) || 'VITE_ENABLE_PUSH=1\n';
  devEnv = upsertKV(devEnv, 'VITE_ENABLE_PUSH', '1');
  devEnv = upsertKV(devEnv, 'VITE_PUSH_PUBLIC_KEY', pub);
  writeFileSync(devEnvPath, devEnv);
  console.log('[vapid] wrote web envs:', prodEnvPath, devEnvPath);

  // Update gateway env (root .env and apps/gateway/.env)
  const rootEnvPath = path.join(repoRoot, '.env');
  let rootEnv = readFileIf(rootEnvPath);
  rootEnv = upsertKV(rootEnv, 'VAPID_PRIVATE_KEY', priv);
  rootEnv = upsertKV(rootEnv, 'VAPID_SUBJECT', subj);
  rootEnv = upsertKV(rootEnv, 'VAPID_PUBLIC_KEY', pub);
  writeFileSync(rootEnvPath, rootEnv);
  const gwEnvDir = gwPath; // store alongside Cargo.toml
  const gwEnvPath = path.join(gwEnvDir, '.env');
  let gwEnv = readFileIf(gwEnvPath);
  gwEnv = upsertKV(gwEnv, 'VAPID_PRIVATE_KEY', priv);
  gwEnv = upsertKV(gwEnv, 'VAPID_SUBJECT', subj);
  gwEnv = upsertKV(gwEnv, 'VAPID_PUBLIC_KEY', pub);
  writeFileSync(gwEnvPath, gwEnv);
  console.log('[vapid] wrote gateway envs:', rootEnvPath, gwEnvPath);

  console.log('\nDone. Restart the gateway and web if running to pick up keys.');
}

main().catch((e) => {
  console.error('[vapid] error:', e);
  process.exit(1);
});
