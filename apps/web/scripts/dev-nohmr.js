#!/usr/bin/env node
import { spawn } from "node:child_process";

// Mirror dev-with-env defaults, but disable HMR/WebSocket for bfcache verification
if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET === "") {
	process.env.AUTH_SECRET = "dev-insecure-secret";
}
if (!process.env.AUTH_TRUST_HOST || process.env.AUTH_TRUST_HOST === "") {
	process.env.AUTH_TRUST_HOST = "true";
}
process.env.NO_HMR = "1";

const child = spawn("vite", ["--mode", "ssr"], {
	stdio: "inherit",
	env: process.env,
	shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
	if (signal) process.exit(1);
	process.exit(code ?? 0);
});
