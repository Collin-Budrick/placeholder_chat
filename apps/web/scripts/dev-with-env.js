#!/usr/bin/env node
import { spawn } from "node:child_process";
// Single-run guard: avoid starting two dev servers if the container/runner
// inadvertently invokes this script twice.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const lockFile = path.resolve(process.cwd(), "apps/web/.dev.server.lock");
try {
	const fd = fs.openSync(lockFile, "wx");
	try {
		fs.writeFileSync(fd, String(process.pid));
	} catch {}
	try {
		const cleanup = () => {
			try {
				fs.unlinkSync(lockFile);
			} catch {}
			try {
				fs.closeSync(fd);
			} catch {}
		};
		process.on("exit", cleanup);
		process.on("SIGINT", () => {
			cleanup();
			process.exit(0);
		});
		process.on("SIGTERM", () => {
			cleanup();
			process.exit(0);
		});
	} catch {}
} catch (e) {
	// If lock exists, and the PID inside is alive, bail out to prevent duplicate dev servers.
	// However, when running in Docker, PID 1 is often our own process in a fresh container,
	// and a leftover lock from a previous container may also read as 1. Treat that as stale.
	try {
		const raw = fs.readFileSync(lockFile, "utf8");
		const pid = Number((raw || "").trim());
		if (Number.isFinite(pid)) {
			// Ignore locks that point to our current process or PID 1 heuristically
			if (pid === process.pid || pid === 1) {
				try {
					fs.unlinkSync(lockFile);
				} catch {}
			} else {
				try {
					process.kill(pid, 0); // no-op test signal
					console.warn(
						"[dev-env] Detected existing dev server (pid",
						pid,
						"). Skipping duplicate start.",
					);
					process.exit(0);
				} catch {
					// Stale lock; replace
					try {
						fs.unlinkSync(lockFile);
					} catch {}
				}
			}
		}
	} catch {}
}

// Load .env.development and .env to pass TLS cert paths and other config to Vite
try {
	const dotenv = await import("dotenv");
	// Load .env.development first, then .env to allow overrides
	dotenv.config({ path: path.resolve(process.cwd(), ".env.development") });
	dotenv.config({ path: path.resolve(process.cwd(), ".env") });
} catch {}

// Prefer trusted mkcert certs for LAN HTTPS if no explicit key/cert set
try {
	const hasExplicitKey = Boolean(
		process.env.DEV_TLS_KEY_FILE ||
			process.env.TLS_KEY_FILE ||
			process.env.SSL_KEY_FILE,
	);
	const hasExplicitCert = Boolean(
		process.env.DEV_TLS_CERT_FILE ||
			process.env.TLS_CERT_FILE ||
			process.env.SSL_CERT_FILE,
	);
	if (!hasExplicitKey || !hasExplicitCert) {
		// Default to using mkcert so LAN IPs are trusted
		if (!process.env.USE_MKCERT) process.env.USE_MKCERT = "1";
		if (!process.env.MKCERT_HOSTS) {
			// Build a sane default list: localhost + first LAN IPv4
			const lanAddrs = [];
			const ifs = os.networkInterfaces();
			for (const name of Object.keys(ifs)) {
				for (const addr of ifs[name] || []) {
					if (addr.family === "IPv4" && !addr.internal)
						lanAddrs.push(addr.address);
				}
			}
			const firstLan = lanAddrs[0];
			const hosts = ["localhost", "127.0.0.1", "::1"];
			if (firstLan) hosts.push(firstLan);
			// Also include host-provided LAN hints when running in Docker
			const extra = [process.env.PUBLIC_IP, process.env.HMR_HOST].filter(
				Boolean,
			);
			for (const h of extra) {
				if (h && !hosts.includes(h)) hosts.push(h);
			}
			process.env.MKCERT_HOSTS = hosts.join(",");
			try {
				console.log(`[dev-env] mkcert hosts: ${process.env.MKCERT_HOSTS}`);
			} catch {}
		}
	}
} catch {}

// If local dev certs exist, point Vite at them automatically
try {
	const keyRel = "certs/dev.key";
	const certRel = "certs/dev.crt";
	const keyPath = path.resolve(process.cwd(), keyRel);
	const certPath = path.resolve(process.cwd(), certRel);
	// Respect explicit env if set; otherwise set when both files are present
	if (
		!process.env.DEV_TLS_KEY_FILE &&
		!process.env.TLS_KEY_FILE &&
		!process.env.SSL_KEY_FILE
	) {
		if (require("node:fs").existsSync(keyPath)) {
			process.env.DEV_TLS_KEY_FILE = keyRel;
			console.log(`[dev-env] Using TLS key: ${keyRel}`);
		}
	}
	if (
		!process.env.DEV_TLS_CERT_FILE &&
		!process.env.TLS_CERT_FILE &&
		!process.env.SSL_CERT_FILE
	) {
		if (require("node:fs").existsSync(certPath)) {
			process.env.DEV_TLS_CERT_FILE = certRel;
			console.log(`[dev-env] Using TLS cert: ${certRel}`);
		}
	}
} catch {}

// Provide safe dev defaults so Auth.js doesn't crash in dev
if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET === "") {
	process.env.AUTH_SECRET = "dev-insecure-secret";
}
if (!process.env.AUTH_TRUST_HOST || process.env.AUTH_TRUST_HOST === "") {
	process.env.AUTH_TRUST_HOST = "true";
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
try {
	console.log("[dev-env] Summary:", summary);
} catch {}
try {
	const pub = process.env.PUBLIC_IP || "localhost";
	// Traefik terminates TLS on 5173 for LAN access
	console.log(`[dev-env] Public URL via Traefik: https://${pub}:5173/`);
} catch {}

// Ensure local node_modules/.bin are on PATH when invoked outside a package runner
try {
	const sep = process.platform === "win32" ? ";" : ":";
	const extraBins = [
		path.resolve(process.cwd(), "node_modules", ".bin"),
		path.resolve(process.cwd(), "apps", "web", "node_modules", ".bin"),
	];
	process.env.PATH = `${extraBins.join(sep)}${sep}${process.env.PATH ?? ""}`;
} catch {}

const useBun = !!(
	process.versions &&
	(process.versions.bun || process.env.BUN_RUNTIME === "1")
);
const noSSR = process.env.NO_SSR === "1";

// Relax file-watch polling defaults when set too aggressively by the environment
try {
	const iv = Number(process.env.CHOKIDAR_INTERVAL || "0");
	if (!Number.isFinite(iv) || iv < 300) {
		process.env.CHOKIDAR_INTERVAL = "350";
	}
} catch {}
const cmd = useBun ? "bunx" : "vite";
const baseArgs = ["--host", "0.0.0.0", "--port", process.env.PORT || "5174"];
const args = useBun
	? ["vite", ...(noSSR ? [] : ["--mode", "ssr"]), ...baseArgs]
	: [...(noSSR ? [] : ["--mode", "ssr"]), ...baseArgs];
const viteCwd = path.resolve(process.cwd(), "apps/web");
const child = spawn(cmd, args, {
	stdio: "inherit",
	env: process.env,
	shell: process.platform === "win32",
	cwd: viteCwd,
});

child.on("exit", (code, signal) => {
	if (signal) process.exit(1);
	process.exit(code ?? 0);
});
