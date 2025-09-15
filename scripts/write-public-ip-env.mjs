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
  if ((out.error || !String(out.stdout || '').trim())) {
    out = tryExec('pwsh');
  }
  return out;
}

function pickIPv4ViaDefaultRoute() {
  try {
    const plat = process.platform;
    if (plat === 'win32') {
      const ps = [
        "$ErrorActionPreference='SilentlyContinue' | Out-Null;",
        "($cfg = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq 'Up' } | Sort-Object -Property InterfaceMetric | Select-Object -First 1);",
        "$cfg.IPv4Address | ForEach-Object { $_.IPAddress }"
      ].join(' ');
      const out = runPowerShell(ps);
      const ip = trimStdout(out.stdout).split(/\r?\n/).map(s => s.trim()).find(s => /^\d+\.\d+\.\d+\.\d+$/.test(s));
      if (ip && isPrivateIPv4(ip)) return ip;
    } else if (plat === 'linux') {
      const out = spawnSync('sh', ['-lc', "ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.*src \([0-9.]*\).*/\1/p'"], { encoding: 'utf8' });
      const ip = trimStdout(out.stdout).split(/\s+/).find(s => /^\d+\.\d+\.\d+\.\d+$/.test(s));
      if (ip && isPrivateIPv4(ip)) return ip;
    } else if (plat === 'darwin') {
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

const ip = pickIPv4ViaDefaultRoute() || pickLanIPv4Fallback() || process.env.PUBLIC_IP || null;
if (!ip) {
  console.error('[docker-env] Could not detect a LAN IPv4 address. Falling back to 0.0.0.0');
}

const envPath = path.resolve(process.cwd(), '.env');
let prev = '';
try { prev = fs.readFileSync(envPath, 'utf8'); } catch {}

const lines = prev.split(/\r?\n/).filter(Boolean).filter((l) => !/^PUBLIC_IP\s*=/.test(l) && !/^HMR_HOST\s*=/.test(l));
lines.push(`PUBLIC_IP=${ip || '0.0.0.0'}`);
lines.push(`HMR_HOST=${ip || 'localhost'}`);
const out = `# Auto-generated for Docker dev by scripts/write-public-ip-env.mjs\n${lines.join('\n')}\n`;
fs.writeFileSync(envPath, out);
console.log(`[docker-env] Wrote ${envPath} with PUBLIC_IP=${ip || '0.0.0.0'} and HMR_HOST=${ip || 'localhost'}`);
