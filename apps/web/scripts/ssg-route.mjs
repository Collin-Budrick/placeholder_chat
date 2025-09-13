#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node scripts/ssg-route.mjs /route [/another]");
  process.exit(1);
}

const norm = (s) => {
  let v = String(s || "").trim();
  if (!v) return "";
  if (!v.startsWith("/")) v = "/" + v;
  if (v.length > 1 && v.endsWith("/")) v = v.slice(0, -1);
  return v;
};

const routes = Array.from(new Set(args.map(norm).filter(Boolean)));
if (routes.length === 0) {
  console.error("No valid routes provided");
  process.exit(1);
}

const env = { ...process.env };
env.SSG_ONLY_ROUTES = routes.join(",");
env.VITE_WATCH = env.VITE_WATCH || "1";
env.NO_HTTPS = env.NO_HTTPS || "1";

console.log(`[ssg-route] Generating routes: ${env.SSG_ONLY_ROUTES}`);

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}
function detectProjectRoot() {
  const cwd = process.cwd();
  // If we're already in the web app (has src/routes)
  if (exists(path.join(cwd, "src", "routes"))) return cwd;
  // If run from monorepo root, prefer apps/web
  const mono = path.join(cwd, "apps", "web");
  if (exists(path.join(mono, "src", "routes"))) return mono;
  return cwd;
}
const cwd = detectProjectRoot();
const child = spawn("bunx", ["vite", "build", "-c", "adapters/static/vite.config.ts"], {
  stdio: "inherit",
  env,
  cwd,
  shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});
