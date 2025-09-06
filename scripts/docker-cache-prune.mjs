#!/usr/bin/env node
import { spawn } from 'node:child_process';
import readline from 'node:readline';

function sh(cmd, args = [], opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { shell: process.platform === 'win32', ...opts });
    let out = '';
    let err = '';
    if (child.stdout) child.stdout.on('data', (d) => (out += d.toString()))
    if (child.stderr) child.stderr.on('data', (d) => (err += d.toString()))
    child.on('exit', (code) => resolve({ code: code ?? 0, out, err }));
  });
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans.trim()); }));
}

function parseArgs(argv) {
  const opts = { buildkit: false, volumes: false, all: false, yes: false, dry: false };
  for (const a of argv.slice(2)) {
    if (a === '--buildkit') opts.buildkit = true;
    else if (a === '--volumes') opts.volumes = true;
    else if (a === '--all') opts.all = true;
    else if (a === '--yes' || a === '-y') opts.yes = true;
    else if (a === '--dry-run' || a === '--dry') opts.dry = true;
    else if (a === '--help' || a === '-h') opts.help = true;
  }
  if (opts.all) { opts.buildkit = true; opts.volumes = true; }
  if (!opts.buildkit && !opts.volumes && !opts.help) opts.help = true;
  return opts;
}

function help() {
  console.log(`docker:cache:prune helper

Usage: bun scripts/docker-cache-prune.mjs [--buildkit] [--volumes] [--all] [--yes] [--dry-run]

Options:
  --buildkit   Prune Docker BuildKit/builder caches (safe)
  --volumes    Remove named volumes ending with: cargo-registry, cargo-git, cargo-target, sccache
  --all        Do both of the above
  --yes,-y     Skip confirmation prompt (non-interactive)
  --dry-run    Show what would be done without executing
`);
}

async function findTargetVolumes() {
  const names = ['cargo-registry', 'cargo-git', 'cargo-target', 'sccache'];
  const res = await sh('docker', ['volume', 'ls', '--format', '{{.Name}}']);
  if (res.code !== 0) return [];
  const lines = res.out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return lines.filter((n) => names.some((suf) => n.endsWith(`_${suf}`) || n.endsWith(`-${suf}`) || n === suf));
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) { help(); return; }
  const vols = opts.volumes ? await findTargetVolumes() : [];
  const actions = [];
  if (opts.buildkit) actions.push('Prune Docker BuildKit cache (docker builder prune, docker buildx prune)');
  if (opts.volumes) actions.push(`Remove volumes: ${vols.length ? vols.join(', ') : '(none found)'}`);
  if (!opts.yes) {
    console.log('About to perform:');
    for (const a of actions) console.log(` - ${a}`);
    const ans = await ask('Proceed? [y/N] ');
    if (!/^y(es)?$/i.test(ans)) { console.log('Aborted.'); return; }
  }
  if (opts.dry) { console.log('[dry-run] No changes made.'); return; }
  if (opts.buildkit) {
    console.log('[prune] docker builder prune -f');
    await sh('docker', ['builder', 'prune', '-f']);
    console.log('[prune] docker buildx prune -f');
    await sh('docker', ['buildx', 'prune', '-f']);
  }
  if (opts.volumes) {
    if (vols.length) {
      console.log('[prune] Removing volumes:', vols.join(', '));
      await sh('docker', ['volume', 'rm', '-f', ...vols]);
    } else {
      console.log('[prune] No matching volumes found.');
    }
  }
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });

