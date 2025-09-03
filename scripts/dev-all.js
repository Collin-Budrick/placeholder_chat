#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, createWriteStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = process.cwd();
const logsDir = path.join(repoRoot, 'logs');
if (!existsSync(logsDir)) {
  mkdirSync(logsDir, { recursive: true });
}

// Use a single rolling log file that is overwritten on each run
const logPath = path.join(logsDir, 'dev-all.log');
const out = createWriteStream(logPath, { flags: 'w' });

// Ensure color output even when stdio is piped
if (!process.env.FORCE_COLOR) {
  process.env.FORCE_COLOR = '1';
}
// Allow local Node fetch calls in this script and child launcher scripts
// to connect to the self-signed dev certificate when using HTTPS.

const TAG_COLORS = {
  SHRD: '\u001b[1;32m', // bold green
  GW: '\u001b[1;33m',   // bold yellow
  WEB: '\u001b[1;36m',  // bold cyan
  LYNX: '\u001b[1;35m', // bold magenta
  DESK: '\u001b[1;34m', // bold blue
  LQR: '\u001b[1;35m',  // magenta for Lynx QR dev
};
const RESET = '\u001b[0m';

const buffers = new Map(); // tag -> pending partial line

function stripAnsi(s) {
  // strip common ANSI escape codes
  return s.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
}

function writeLines(source, tag, chunk) {
  const ts = new Date().toISOString();
  const prev = buffers.get(tag) || '';
  const str = prev + chunk.toString();
  const lines = str.split(/\r?\n/);
  buffers.set(tag, lines.pop() ?? ''); // keep last partial
  for (const raw of lines) {
    const line = raw; // keep ANSI for console
    const fileLine = stripAnsi(line);
    const fileFormatted = `${ts} [${tag}] ${fileLine}`;
    try { out.write(fileFormatted + '\n'); } catch {}
    const color = TAG_COLORS[tag] || '';
    const consoleTag = color ? `${color}[${tag}]${RESET}` : `[${tag}]`;
    const consoleLine = `${consoleTag} ${line}`;
    if (source === 'stdout') process.stdout.write(consoleLine + '\n');
    else process.stderr.write(consoleLine + '\n');
  }
}

function spawnTagged(tag, command, args = [], options = {}) {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '1' },
    shell: process.platform === 'win32',
    ...options,
  });
  child.stdout.on('data', (c) => writeLines('stdout', tag, c));
  child.stderr.on('data', (c) => writeLines('stderr', tag, c));
  return child;
}

const procs = [];
// Shared watch
procs.push(spawnTagged('SHRD', 'bun', ['run', 'shared:watch'], { cwd: repoRoot }));
// Gateway
procs.push(spawnTagged('GW', 'bun', ['run', 'gateway:dev'], { cwd: repoRoot }));
// Vite (web)
const forcedUrl = process.env.WEB_FORCE_URL || process.env.DEV_SERVER_URL || process.env.LAN_DEV_URL;
let webEnv = { ...process.env };
// Prefer HTTPS scheme unless explicitly disabled
const WEB_SCHEME = process.env.NO_HTTPS === '1' ? 'http' : 'https';
if (forcedUrl) {
  try {
    const u = new URL(forcedUrl);
    webEnv.LYNX_DEV_URL = u.toString();
    webEnv.LYNX_HOST = u.hostname;
    webEnv.LYNX_PORT_RANGE = `${u.port || '5173'}-${u.port || '5173'}`;
  } catch (_) {
    // ignore malformed
  }
}
procs.push(spawnTagged('WEB', 'bun', ['run', 'dev:web'], { cwd: path.join(repoRoot, 'apps', 'web'), env: webEnv }));
// Lynx Explorer auto-launcher (from apps/web) — use LAN 192.168.* address
function pickLanHost(prefer = ['192.168.', '192.', '10.', '172.27.', '172.']) {
  const netIfs = os.networkInterfaces();
  const addrs = [];
  for (const ifname of Object.keys(netIfs)) {
    for (const addr of netIfs[ifname] || []) {
      if (addr.family === 'IPv4' && !addr.internal) addrs.push(addr.address);
    }
  }
  const uniq = (arr) => Array.from(new Set(arr));
  const score = (h) => {
    const idx = prefer.findIndex((p) => h.startsWith(p));
    return idx === -1 ? 999 : idx;
  };
  const sorted = uniq(addrs).sort((a, b) => score(a) - score(b));
  return sorted[0] || '127.0.0.1';
}

const lynxEnv = { ...process.env };
try {
  const f = process.env.WEB_FORCE_URL || process.env.DEV_SERVER_URL || process.env.LAN_DEV_URL || '';
  const port = f ? (new URL(f).port || '5173') : '5173';
  const host = pickLanHost();
  lynxEnv.LYNX_DEV_URL = `${WEB_SCHEME}://${host}:${port}/`;
  lynxEnv.LYNX_HOST = host;
  lynxEnv.LYNX_PORT_RANGE = `${port}-${port}`;
  lynxEnv.LYNX_SCHEME = WEB_SCHEME;
  // Also configure the QR in the launcher to point at the Lynx bundle on port 3000
  lynxEnv.LYNX_QR_HOST = host;
  lynxEnv.LYNX_QR_PORT = process.env.LYNX_QR_PORT || '3000';
} catch {
  const host = pickLanHost();
  lynxEnv.LYNX_DEV_URL = `${WEB_SCHEME}://${host}:5173/`;
  lynxEnv.LYNX_HOST = host;
  lynxEnv.LYNX_PORT_RANGE = '5173-5173';
  lynxEnv.LYNX_SCHEME = WEB_SCHEME;
  lynxEnv.LYNX_QR_HOST = host;
  lynxEnv.LYNX_QR_PORT = process.env.LYNX_QR_PORT || '3000';
}
procs.push(
  spawnTagged('LYNX', 'bun', ['run', 'lynx:auto'], {
    cwd: path.join(repoRoot, 'apps', 'web'),
    env: { ...lynxEnv, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
  })
);

// Lynx rspeedy dev just for QR/banner, configured to encode the desired LAN URL
function bestLanHost() {
  const forced = process.env.WEB_FORCE_URL || process.env.DEV_SERVER_URL || process.env.LAN_DEV_URL;
  if (forced) {
    try { return new URL(forced).hostname; } catch {}
  }
  const netIfs = os.networkInterfaces();
  const addrs = [];
  for (const ifname of Object.keys(netIfs)) {
    for (const addr of netIfs[ifname] || []) {
      if (addr.family === 'IPv4' && !addr.internal) addrs.push(addr.address);
    }
  }
  const preferList = (process.env.WEB_HOST_PREFER || '172.27.,172.,10.,192.168.,192.').split(',').map(s => s.trim()).filter(Boolean);
  const score = (h) => { const i = preferList.findIndex(p => h.startsWith(p)); return i === -1 ? 999 : i; };
  addrs.sort((a,b) => score(a) - score(b));
  return addrs[0] || '127.0.0.1';
}

const qrHost = bestLanHost();
const qrEnv = { ...process.env, LYNX_QR_HOST: qrHost, LYNX_QR_PORT: process.env.LYNX_QR_PORT || '3000' };
procs.push(
  spawnTagged('LQR', 'bun', ['run', 'dev'], {
    cwd: path.join(repoRoot, 'apps', 'lynx'),
    env: qrEnv,
  })
);

// Desktop (Tauri) — wait for Vite dev server, then launch pointing to it
async function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

import http from 'node:http';
import https from 'node:https';
async function isUp(urlBase) {
  const probes = [new URL('__vite_ping', urlBase).toString(), urlBase];
  const check = (target) => new Promise((resolve) => {
    try {
      const u = new URL(target);
      const isHttps = u.protocol === 'https:';
      const mod = isHttps ? https : http;
      const req = mod.request({
        method: 'GET',
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + (u.search || ''),
        timeout: 1500,
        rejectUnauthorized: false,
      }, (res) => {
        const ok = res.statusCode && (res.statusCode === 200 || (res.statusCode >= 300 && res.statusCode < 400));
        res.resume();
        resolve(ok);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { try { req.destroy(new Error('timeout')); } catch {} resolve(false); });
      req.end();
    } catch {
      resolve(false);
    }
  });
  for (const t of probes) {
    if (await check(t)) return true;
  }
  return false;
}

function getLocalHosts() {
  const preferNetwork = (process.env.WEB_PREFER_NETWORK ?? '1') !== '0';
  const envHosts = (process.env.WEB_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean);
  const loopbacks = ['localhost', '127.0.0.1'];
  const netIfs = os.networkInterfaces();
  let lanHosts = [];
  for (const ifname of Object.keys(netIfs)) {
    for (const addr of netIfs[ifname] || []) {
      if (addr.family === 'IPv4' && !addr.internal) lanHosts.push(addr.address);
    }
  }
  // Sort LAN hosts by preference: WEB_HOST_PREFER (comma-separated prefixes or exact),
  // defaults to preferring 172.* then 10.* then 192.168.*
  const preferList = (process.env.WEB_HOST_PREFER || '172.27.,172.,10.,192.168.,192.').split(',').map(s => s.trim()).filter(Boolean);
  const score = (h) => {
    const idx = preferList.findIndex(pref => h.startsWith(pref));
    return idx === -1 ? 999 : idx;
  };
  lanHosts = Array.from(new Set(lanHosts)).sort((a, b) => score(a) - score(b));
  const uniq = (arr) => Array.from(new Set(arr));
  const networkFirst = uniq([...envHosts, ...lanHosts]);
  const loopbackList = uniq([...loopbacks, ...envHosts.filter(h => loopbacks.includes(h))]);
  return preferNetwork ? [...networkFirst, ...loopbackList] : [...loopbackList, ...networkFirst];
}

async function findDevUrl() {
  // If an explicit URL is provided, prefer it
  const force = process.env.WEB_FORCE_URL || process.env.DEV_SERVER_URL || process.env.LAN_DEV_URL;
  if (force) {
    try {
      const u = new URL(force);
      if (await isUp(u.toString())) return u.toString();
      // If not up yet, wait/poll until it is
      const timeoutMs = Number(process.env.WAIT_TIMEOUT_MS || 120000);
      const pollMs = Number(process.env.WAIT_POLL_MS || 400);
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        if (await isUp(u.toString())) return u.toString();
        await wait(pollMs);
      }
    } catch (_) { /* fallthrough to discovery */ }
  }
  const range = process.env.WEB_PORT_RANGE || '5173-5180';
  const [s, e] = range.split('-');
  const start = Number(s) || 5173;
  const end = Number(e) || 5180;
  const hosts = getLocalHosts();
  const timeoutMs = Number(process.env.WAIT_TIMEOUT_MS || 120000);
  const pollMs = Number(process.env.WAIT_POLL_MS || 400);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const candidates = [];
    for (const h of hosts) {
      for (let p = start; p <= end; p++) candidates.push(`${WEB_SCHEME}://${h}:${p}/`);
    }
    // Probe in batches to keep first found, prefer earlier candidates
    for (const url of candidates) {
      if (await isUp(url)) return url;
    }
    await wait(pollMs);
  }
  throw new Error(`Timed out waiting for Vite dev server on hosts ${hosts.join(', ')} ports ${start}-${end}`);
}

(async () => {
  try {
    const url = await findDevUrl();
    writeLines('stdout', 'DESK', Buffer.from(`[desktop:auto] Using dev URL ${url}\n`));
    const env = { ...process.env, TAURI_DEV_URL: url };
    const desk = spawnTagged('DESK', 'cargo', ['run', '-p', 'desktop_app'], { cwd: repoRoot, env });
    procs.push(desk);
    desk.on('exit', (code) => {
      exited += 1;
      if (code && code !== 0) exitCode = code;
      if (exited === procs.length) cleanupAndExit(exitCode);
    });
  } catch (err) {
    writeLines('stderr', 'DESK', Buffer.from(`[desktop:auto] ${String(err?.message || err)}\n`));
  }
})();

let exitCode = 0;
let exited = 0;
let isShuttingDown = false;

function sendSignalToChildren(signal) {
  for (const p of procs) {
    if (p.killed) continue;
    try {
      process.kill(p.pid, signal);
    } catch {}
  }
}

function forceKillChildren() {
  for (const p of procs) {
    if (p.killed) continue;
    try {
      if (process.platform === 'win32') {
        // On Windows, SIGKILL maps to TerminateProcess
        process.kill(p.pid, 'SIGKILL');
      } else {
        process.kill(p.pid, 'SIGKILL');
      }
    } catch {}
  }
}

function beginShutdown(reasonSignal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  // Prefer graceful shutdown so children can run async exit hooks
  const sig = reasonSignal || 'SIGINT';
  sendSignalToChildren(sig);
  // Fallback: force kill after grace period
  const timeoutMs = 5000;
  setTimeout(() => {
    forceKillChildren();
  }, timeoutMs).unref?.();
}

function cleanupAndExit(code) {
  try { out.end(); } catch {}
  if (code !== 0) {
    console.error(`dev-all exited with code ${code}. Log: ${logPath}`);
  } else {
    console.log(`dev-all finished. Log saved to: ${logPath}`);
  }
  // Avoid synchronous termination; set exitCode and let Node exit naturally
  if (typeof code === 'number') process.exitCode = code;
}
procs.forEach((p) => {
  p.on('exit', (code) => {
    exited += 1;
    if (code && code !== 0) exitCode = code;
    if (exited === procs.length) cleanupAndExit(exitCode);
  });
});

// Forward termination signals to children, allowing them to cleanup
process.on('SIGINT', () => {
  beginShutdown('SIGINT');
});

process.on('SIGTERM', () => {
  beginShutdown('SIGTERM');
});

process.on('exit', () => {
  // If parent is exiting for any reason, try to notify children first
  beginShutdown('SIGINT');
});
