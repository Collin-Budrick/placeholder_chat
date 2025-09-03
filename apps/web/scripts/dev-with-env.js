#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
// Load .env.development and .env to pass TLS cert paths and other config to Vite
try {
  const dotenv = await import('dotenv');
  // Load .env.development first, then .env to allow overrides
  dotenv.config({ path: path.resolve(process.cwd(), '.env.development') });
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
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

const child = spawn('vite', ['--mode', 'ssr'], {
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});

child.on('exit', (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});
