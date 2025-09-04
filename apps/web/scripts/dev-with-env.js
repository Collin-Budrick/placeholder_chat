#!/usr/bin/env node
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
// Load .env.development and .env to pass TLS cert paths and other config to Vite
try {
  const dotenv = await import('dotenv');
  // Load .env.development first, then .env to allow overrides
  dotenv.config({ path: path.resolve(process.cwd(), '.env.development') });
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
} catch {}

// Prefer trusted mkcert certs for LAN HTTPS if no explicit key/cert set
try {
  const hasExplicitKey = Boolean(process.env.DEV_TLS_KEY_FILE || process.env.TLS_KEY_FILE || process.env.SSL_KEY_FILE);
  const hasExplicitCert = Boolean(process.env.DEV_TLS_CERT_FILE || process.env.TLS_CERT_FILE || process.env.SSL_CERT_FILE);
  if (!hasExplicitKey || !hasExplicitCert) {
    // Default to using mkcert so LAN IPs are trusted
    if (!process.env.USE_MKCERT) process.env.USE_MKCERT = '1';
    if (!process.env.MKCERT_HOSTS) {
      // Build a sane default list: localhost + first LAN IPv4
      const lanAddrs = [];
      const ifs = os.networkInterfaces();
      for (const name of Object.keys(ifs)) {
        for (const addr of ifs[name] || []) {
          if (addr.family === 'IPv4' && !addr.internal) lanAddrs.push(addr.address);
        }
      }
      const firstLan = lanAddrs[0];
      const hosts = ['localhost', '127.0.0.1', '::1'];
      if (firstLan) hosts.push(firstLan);
      process.env.MKCERT_HOSTS = hosts.join(',');
      try {
        console.log(`[dev-env] mkcert hosts: ${process.env.MKCERT_HOSTS}`);
      } catch {}
    }
  }
} catch {}

// If local dev certs exist, point Vite at them automatically
try {
  const keyRel = 'certs/dev.key';
  const certRel = 'certs/dev.crt';
  const keyPath = path.resolve(process.cwd(), keyRel);
  const certPath = path.resolve(process.cwd(), certRel);
  // Respect explicit env if set; otherwise set when both files are present
  if (!process.env.DEV_TLS_KEY_FILE && !process.env.TLS_KEY_FILE && !process.env.SSL_KEY_FILE) {
    if (require('node:fs').existsSync(keyPath)) {
      process.env.DEV_TLS_KEY_FILE = keyRel;
      console.log(`[dev-env] Using TLS key: ${keyRel}`);
    }
  }
  if (!process.env.DEV_TLS_CERT_FILE && !process.env.TLS_CERT_FILE && !process.env.SSL_CERT_FILE) {
    if (require('node:fs').existsSync(certPath)) {
      process.env.DEV_TLS_CERT_FILE = certRel;
      console.log(`[dev-env] Using TLS cert: ${certRel}`);
    }
  }
} catch {}

// Provide safe dev defaults so Auth.js doesn't crash in dev
if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET === '') {
  process.env.AUTH_SECRET = 'dev-insecure-secret';
}
if (!process.env.AUTH_TRUST_HOST || process.env.AUTH_TRUST_HOST === '') {
  process.env.AUTH_TRUST_HOST = 'true';
}
// AUTH_URL is optional here; setting it to 127.0.0.1:5173 is fine, but
// not strictly required to avoid the MissingSecret error. Uncomment if needed.
// if (!process.env.AUTH_URL || process.env.AUTH_URL === '') {
//   process.env.AUTH_URL = 'http://127.0.0.1:5173';
// }

const summary = {
  NO_HTTPS: process.env.NO_HTTPS,
  USE_MKCERT: process.env.USE_MKCERT,
  MKCERT_HOSTS: process.env.MKCERT_HOSTS,
  DOCKER_TRAEFIK: process.env.DOCKER_TRAEFIK,
};
try { console.log('[dev-env] Summary:', summary); } catch {}

const child = spawn('vite', ['--mode', 'ssr', '--host', '0.0.0.0', '--port', process.env.PORT || '5174'], {
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});

child.on('exit', (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});
