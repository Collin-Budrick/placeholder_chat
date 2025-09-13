#!/usr/bin/env node
const { spawn } = require("node:child_process");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");
const isWin = process.platform === "win32";

const cmd = isWin ? "cmd" : "sh";
const args = isWin ? ["/d", "/s", "/c", "bun", "run", "docker:dev"] : ["-lc", "bun run docker:dev"];

const child = spawn(cmd, args, {
  stdio: "inherit",
  cwd: repoRoot,
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});
