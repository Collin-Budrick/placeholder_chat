#!/usr/bin/env node
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

function pickLanIPv4() {
  const ifs = os.networkInterfaces();
  // Preferred interface names on Windows/macOS/Linux
  const preferred = [
    'Ethernet', 'Wi-Fi', 'WiFi', 'WLAN', 'en0', 'en1', 'eth0', 'eth1', 'wlan0', 'wlan1',
  ];
  const all = [];
  for (const [name, addrs] of Object.entries(ifs)) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) {
        // Skip Docker/virtual interfaces
        const lname = String(name).toLowerCase();
        if (lname.includes('docker') || lname.includes('vbox') || lname.includes('loopback') || lname.includes('utun') || lname.includes('hamachi')) {
          continue;
        }
        all.push({ name, address: a.address });
      }
    }
  }
  // Try preferred names first
  for (const p of preferred) {
    const hit = all.find((x) => x.name.toLowerCase().startsWith(p.toLowerCase()));
    if (hit) return hit.address;
  }
  // Otherwise, first available
  return all[0]?.address || null;
}

const ip = process.env.PUBLIC_IP || pickLanIPv4();
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

