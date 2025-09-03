#!/usr/bin/env node
// HTTPS wrapper for `vite preview` so we can serve TLS + HSTS locally without external cert files.
import { spawn } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// Load env from .env.production and .env files for TLS cert paths
try {
  const dotenv = require('dotenv');
  dotenv.config({ path: path.join(WEB_DIR, '.env.production') });
  dotenv.config({ path: path.join(WEB_DIR, '.env') });
} catch {}

const WEB_DIR = process.cwd();

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  return process.env[name.toUpperCase()] || def;
}

const PORT = Number(arg('port', process.env.PORT || process.env.WEB_PORT || 5173));
const HOST = arg('host', '0.0.0.0');
const UPSTREAM_PORT = Number(arg('upstream-port', PORT === 443 ? 8443 : PORT + 1));
const UPSTREAM_HOST = '127.0.0.1';

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForUpstream() {
  const deadline = Date.now() + 120000; // 2 min
  while (Date.now() < deadline) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.request({ host: UPSTREAM_HOST, port: UPSTREAM_PORT, method: 'GET', path: '/', timeout: 2000 }, (res) => {
          res.resume();
          resolve(null);
        });
        req.on('error', reject);
        req.on('timeout', () => { try { req.destroy(new Error('timeout')); } catch {} });
        req.end();
      });
      return true;
    } catch {}
    await wait(200);
  }
  return false;
}

function readTlsFromEnv() {
  const rawKey = process.env.DEV_TLS_KEY_FILE || process.env.TLS_KEY_FILE || process.env.SSL_KEY_FILE;
  const rawCert = process.env.DEV_TLS_CERT_FILE || process.env.TLS_CERT_FILE || process.env.SSL_CERT_FILE;
  const resolvePath = (p) => {
    if (!p) return null;
    const candidates = [
      p,
      path.resolve(WEB_DIR, p),
      p.replace(/^apps[\\/]+web[\\/]+/i, ''),
      path.resolve(WEB_DIR, p.replace(/^apps[\\/]+web[\\/]+/i, '')),
    ];
    for (const c of candidates) {
      try { if (c && fs.existsSync(c)) return c; } catch {}
    }
    return null;
  };
  const keyFile = resolvePath(rawKey);
  const certFile = resolvePath(rawCert);
  if (keyFile && certFile) {
    try {
      const relKey = path.relative(WEB_DIR, keyFile);
      const relCert = path.relative(WEB_DIR, certFile);
      console.log(`[preview-https] Using TLS key/cert from ${relKey} / ${relCert}`);
    } catch {}
    return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) };
  }
  return null;
}

function genSelfSigned() {
  try {
    const selfsigned = require('selfsigned');
    const attrs = [{ name: 'commonName', value: 'localhost' }];
    const pems = selfsigned.generate(attrs, {
      days: 365,
      keySize: 2048,
      algorithm: 'sha256',
      extensions: [
        { name: 'basicConstraints', cA: false },
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'localhost' },
            { type: 7, ip: '127.0.0.1' },
            { type: 7, ip: '::1' },
          ],
        },
      ],
    });
    return { key: pems.private, cert: pems.cert };
  } catch (e) {
    console.error('[preview-https] Failed to generate self-signed certificate:', e);
    process.exit(1);
  }
}

function startProxyServer(tlsOptions) {
  const server = https.createServer({ ...tlsOptions, minVersion: 'TLSv1.2', ALPNProtocols: ['http/1.1'] }, (req, res) => {
    const headers = { ...req.headers };
    headers.host = `${UPSTREAM_HOST}:${UPSTREAM_PORT}`;
    const upstreamReq = http.request({
      host: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      method: req.method,
      path: req.url,
      headers,
    }, (upstreamRes) => {
      const h = { ...upstreamRes.headers };
      h['strict-transport-security'] = h['strict-transport-security'] || 'max-age=63072000; includeSubDomains; preload';
      res.writeHead(upstreamRes.statusCode || 200, h);
      upstreamRes.pipe(res);
    });
    upstreamReq.on('error', (err) => {
      console.error('[preview-https] Upstream error:', err?.message || err);
      try { res.writeHead(502); res.end('Bad Gateway'); } catch {}
    });
    req.pipe(upstreamReq);
  });
  server.on('tlsClientError', (err) => {
    console.error('[preview-https] TLS client error:', err?.message || err);
  });
  server.on('error', (err) => {
    console.error('[preview-https] HTTPS server error:', err?.message || err);
  });
  server.listen(PORT, HOST, () => {
    console.log(`[preview-https] HTTPS proxy listening on https://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  });
  return server;
}

(async () => {
  console.log(`[preview-https] Starting vite preview upstream on http://${UPSTREAM_HOST}:${UPSTREAM_PORT}`);
  const child = spawn('vite', ['preview', '--host', UPSTREAM_HOST, '--port', String(UPSTREAM_PORT)], {
    stdio: 'inherit',
    cwd: WEB_DIR,
    shell: process.platform === 'win32',
  });
  child.on('exit', (code) => {
    console.log(`[preview-https] Upstream preview exited with code ${code}`);
    process.exit(code ?? 0);
  });
  const ok = await waitForUpstream();
  if (!ok) {
    console.error('[preview-https] Timed out waiting for vite preview upstream');
    process.exit(1);
  }
  const tls = readTlsFromEnv() || genSelfSigned();
  if (!readTlsFromEnv()) {
    console.warn('[preview-https] Using in-memory self-signed development certificate (browser will warn).');
  }
  startProxyServer(tls);
})();
