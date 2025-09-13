#!/usr/bin/env node
import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const distIndex = path.resolve(process.cwd(), "dist", "index.html");

async function waitForDist(timeoutMs = 120000) {
  const start = Date.now();
  while (!existsSync(distIndex)) {
    if (Date.now() - start > timeoutMs) {
      console.error("[preview-wait-dist] Timeout waiting for dist/index.html");
      process.exit(1);
    }
    await delay(200);
  }
}

async function main() {
  await waitForDist();
  const vite = spawn(
    process.platform === "win32" ? "bunx.cmd" : "bunx",
    ["vite", "preview", "--host", "0.0.0.0", "--strictPort", "--port", "5174", "--outDir", "dist"],
    { stdio: "inherit" },
  );
  vite.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((e) => {
  console.error("[preview-wait-dist] Failed:", e);
  process.exit(1);
});
