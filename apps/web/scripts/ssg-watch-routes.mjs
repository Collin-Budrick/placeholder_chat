#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }
function detectProjectRoot() {
  const cwd = process.cwd();
  if (exists(path.join(cwd, 'src', 'routes'))) return cwd;
  const mono = path.join(cwd, 'apps', 'web');
  if (exists(path.join(mono, 'src', 'routes'))) return mono;
  return cwd;
}

const projectRoot = detectProjectRoot();
const routesRoot = path.join(projectRoot, 'src', 'routes');

function routeFromFile(abs) {
  const rel = path.relative(routesRoot, abs).replace(/\\/g, '/');
  if (rel.startsWith('..')) return null; // outside
  // Ignore files not likely to be direct page entries
  if (!/\.(tsx|ts|mdx?|md)$/i.test(rel)) return null;
  // Map to route path by dropping file extension and trailing "/index"
  let p = rel.replace(/\.(tsx|ts|mdx?|md)$/i, '');
  // Skip dynamic routes for now
  if (p.includes('[')) return null;
  // Collapse to folder (strip trailing /index)
  p = p.replace(/\/index$/, '');
  // If it became empty, it's root
  if (!p || p === '') return '/';
  if (!p.startsWith('/')) p = '/' + p;
  return p;
}

function spawnSSG(routes) {
  const env = { ...process.env, SSG_ONLY_ROUTES: routes.join(','), VITE_WATCH: process.env.VITE_WATCH || '1', NO_HTTPS: '1' };
  console.log(`[ssg-watch] Building: ${env.SSG_ONLY_ROUTES}`);
  return spawn('bunx', ['vite', 'build', '-c', 'adapters/static/vite.config.ts'], {
    stdio: 'inherit',
    env,
    cwd: projectRoot,
    shell: process.platform === 'win32',
  });
}

// Initial builds: client bundle and a full SSG pass once to ensure dist baseline exists
async function initial() {
  await new Promise((res, rej) => {
    const c = spawn('bunx', ['vite', 'build'], { stdio: 'inherit', cwd: projectRoot, shell: process.platform === 'win32', env: { ...process.env, NO_HTTPS: '1', VITE_WATCH: '1' } });
    c.on('exit', (code) => code === 0 ? res() : rej(new Error('client build failed')));
  });
  await new Promise((res, rej) => {
    const c = spawn('bunx', ['vite', 'build', '-c', 'adapters/static/vite.config.ts'], { stdio: 'inherit', cwd: projectRoot, shell: process.platform === 'win32', env: { ...process.env, NO_HTTPS: '1', VITE_WATCH: '1' } });
    c.on('exit', (code) => code === 0 ? res() : rej(new Error('ssg build failed')));
  });
}

let queue = new Set();
let building = false;
function schedule(route) {
  if (!route) return;
  queue.add(route);
  if (building) return;
  building = true;
  const run = () => {
    const routes = Array.from(queue);
    queue.clear();
    const child = spawnSSG(routes);
    child.on('exit', (code) => {
      if (code !== 0) {
        console.error('[ssg-watch] build failed');
      }
      if (queue.size > 0) {
        run();
      } else {
        building = false;
      }
    });
  };
  // debounce slightly to coalesce rapid saves
  setTimeout(run, 100);
}

function walk(dir) {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        watchDir(p);
        walk(p);
      }
    }
  } catch {}
}

function watchDir(dir) {
  try {
    fs.watch(dir, { persistent: true }, (event, filename) => {
      if (!filename) return;
      const abs = path.join(dir, filename.toString());
      const route = routeFromFile(abs);
      if (route) schedule(route);
      // If a new directory appears, start watching it
      try {
        const st = fs.statSync(abs);
        if (st.isDirectory()) {
          watchDir(abs);
          walk(abs);
        }
      } catch {}
    });
  } catch (e) {
    console.error('[ssg-watch] failed to watch', dir, e?.message || e);
  }
}

(async () => {
  console.log('[ssg-watch] initializing');
  try { await initial(); } catch (e) { console.error('[ssg-watch] initial build failed', e?.message || e); }
  watchDir(routesRoot);
  walk(routesRoot);
  console.log('[ssg-watch] watching', routesRoot);
})();
