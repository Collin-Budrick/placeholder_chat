#!/usr/bin/env node
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function isPrivateIPv4(ip) {
  return (
    /^10\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    (/^172\./.test(ip) && (() => { const o = Number(ip.split('.')[1]); return o >= 16 && o <= 31; })())
  );
}

function trimStdout(x) { return String(x || '').trim(); }

function runPowerShell(cmd) {
  const tryExec = (exe) => spawnSync(exe, ['-NoProfile', '-Command', cmd], { encoding: 'utf8' });
  let out = tryExec('powershell');
  if ((out.error || !String(out.stdout || '').trim()) && process.env.ComSpec) {
    // Attempt pwsh (PowerShell 7) if classic powershell wasn't found or produced no output
    out = tryExec('pwsh');
  }
  return out;
}

function pickIPv4ViaDefaultRoute() {
  try {
    const plat = process.platform;
    if (plat === 'win32') {
      // Use PowerShell to get IPv4 from the interface with a default gateway and lowest metric
      const ps = [
        "$ErrorActionPreference='SilentlyContinue' | Out-Null;",
        "($cfg = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq 'Up' } | Sort-Object -Property InterfaceMetric | Select-Object -First 1);",
        "$cfg.IPv4Address | ForEach-Object { $_.IPAddress }"
      ].join(' ');
      const out = runPowerShell(ps);
      const ip = trimStdout(out.stdout).split(/\r?\n/).map(s => s.trim()).find(s => /^\d+\.\d+\.\d+\.\d+$/.test(s));
      if (ip && isPrivateIPv4(ip)) return ip;
    } else if (plat === 'linux') {
      // ip route to known internet host; parse src
      const out = spawnSync('sh', ['-lc', "ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.*src \([0-9.]*\).*/\1/p'"], { encoding: 'utf8' });
      const ip = trimStdout(out.stdout).split(/\s+/).find(s => /^\d+\.\d+\.\d+\.\d+$/.test(s));
      if (ip && isPrivateIPv4(ip)) return ip;
    } else if (plat === 'darwin') {
      // macOS: find default interface then query its IPv4
      const outIf = spawnSync('sh', ['-lc', "route -n get default 2>/dev/null | sed -n 's/.*interface: \(.*\)$/\1/p'"], { encoding: 'utf8' });
      const iface = trimStdout(outIf.stdout);
      if (iface) {
        const outIP = spawnSync('sh', ['-lc', `ipconfig getifaddr ${iface} 2>/dev/null`], { encoding: 'utf8' });
        const ip = trimStdout(outIP.stdout);
        if (/^\d+\.\d+\.\d+\.\d+$/.test(ip) && isPrivateIPv4(ip)) return ip;
      }
    }
  } catch {}
  return null;
}

function pickLanIPv4Fallback() {
  const ifs = os.networkInterfaces();
  const all = [];
  for (const [name, addrs] of Object.entries(ifs)) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal && isPrivateIPv4(a.address)) {
        const lname = String(name).toLowerCase();
        if (lname.includes('docker') || lname.includes('vbox') || lname.includes('loopback') || lname.includes('utun') || lname.includes('hamachi') || lname.includes('vmnet') || lname.includes('hyper-v')) {
          continue;
        }
        all.push({ name, address: a.address });
      }
    }
  }
  return all[0]?.address || null;
}

async function fetchPublicIPv4IfEnabled() {
  try {
    const enabled = process.env.MKCERT_DETECT_PUBLIC === '1' || process.argv.includes('--public');
    if (!enabled) return null;
    // Allow override of endpoint via env to avoid hard-coding if desired
    const url = process.env.PUBLIC_IP_FETCH_URL || 'https://api.ipify.org';
    const { request } = await import('node:https');
    return await new Promise((resolve) => {
      const req = request(url, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          const ip = String(data || '').trim();
          if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return resolve(ip);
          resolve(null);
        });
      });
      req.on('error', () => resolve(null));
      req.end();
    });
  } catch {
    return null;
  }
}

const argIP = process.argv.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a));
// Prefer fresh detection over stale env; only use env as a last resort
let ip = argIP || pickIPv4ViaDefaultRoute() || pickLanIPv4Fallback() || process.env.PUBLIC_IP;
// Optionally prefer detected public IPv4 when explicitly enabled
if (!argIP && !process.env.PUBLIC_IP) {
  // Note: only used when enabled to avoid unexpected external calls
  // and only if LAN detection failed
  // eslint-disable-next-line no-undef
  // @ts-ignore
  const pub = await fetchPublicIPv4IfEnabled();
  if (!ip && pub) ip = pub;
}
if (!ip) {
  console.error('[mkcert] Could not detect a LAN IPv4 address. Pass one explicitly: node scripts/regen-mkcert-hosts.mjs 192.168.x.y');
  process.exit(1);
}
const hosts = ['localhost', '127.0.0.1', '::1', ip];
const certDir = path.resolve('apps/web/certs');
const hostsFile = path.join(certDir, '.hosts');
fs.mkdirSync(certDir, { recursive: true });
fs.writeFileSync(hostsFile, hosts.join(','));
for (const f of ['dev.crt', 'dev.key']) {
  const p = path.join(certDir, f);
  try { if (fs.existsSync(p)) fs.rmSync(p); } catch {}
}
// Also update root .env for compose variable substitution
const envPath = path.resolve('.env');
let prev = '';
try { prev = fs.readFileSync(envPath, 'utf8'); } catch {}
const lines = prev.split(/\r?\n/).filter(Boolean).filter((l) => !/^PUBLIC_IP\s*=/.test(l) && !/^HMR_HOST\s*=/.test(l));
lines.push(`PUBLIC_IP=${ip}`);
lines.push(`HMR_HOST=${ip}`);
fs.writeFileSync(envPath, `# Auto-generated by scripts/regen-mkcert-hosts.mjs\n${lines.join('\n')}\n`);

console.log(`[mkcert] Set hosts: ${hosts.join(',')}`);
console.log(`[mkcert] Wrote ${hostsFile} and removed existing cert files to force regeneration.`);
console.log(`[mkcert] Updated .env with PUBLIC_IP=${ip}.`);
console.log('Next: docker compose up -d web traefik (cert will regenerate on start).');
