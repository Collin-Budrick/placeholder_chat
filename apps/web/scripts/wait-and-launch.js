#!/usr/bin/env node
// Wait for Vite on a known or discovered URL, then launch Lynx Explorer
import { spawn } from "node:child_process";
import os from "node:os";

const ENV_RANGE = process.env.LYNX_PORT_RANGE || "5173-5180";
const [startStr, endStr] = ENV_RANGE.split("-");
const start = Number(startStr) || 5173;
const end = Number(endStr) || 5180;
const explicitUrl = process.env.LYNX_DEV_URL; // if set, use this directly
const hostEnv = process.env.LYNX_HOST;
const scheme = process.env.LYNX_SCHEME || "http";
const timeoutMs = Number(process.env.WAIT_TIMEOUT_MS || 120000);
const pollIntervalMs = Number(process.env.WAIT_POLL_MS || 500);

function withTimeout(ms, p) {
	const ctl = new AbortController();
	const t = setTimeout(() => ctl.abort("timeout"), ms);
	return Promise.race([
		p(ctl.signal).finally(() => clearTimeout(t)),
		new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
	]);
}

import http from "node:http";
import https from "node:https";

async function isUp(urlBase) {
	const targets = [new URL("__vite_ping", urlBase).toString(), urlBase];
	const check = (t) =>
		new Promise((resolve) => {
			try {
				const u = new URL(t);
				const isHttps = u.protocol === "https:";
				const mod = isHttps ? https : http;
				const req = mod.request(
					{
						method: "GET",
						hostname: u.hostname,
						port: u.port || (isHttps ? 443 : 80),
						path: u.pathname + (u.search || ""),
						timeout: 2000,
						rejectUnauthorized: false,
					},
					(res) => {
						res.resume();
						resolve(true);
					},
				);
				req.on("error", () => resolve(false));
				req.on("timeout", () => {
					try {
						req.destroy(new Error("timeout"));
					} catch {}
					resolve(false);
				});
				req.end();
			} catch {
				resolve(false);
			}
		});
	for (const t of targets) {
		if (await check(t)) return true;
	}
	return false;
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

function getLanHosts() {
	const ifs = os.networkInterfaces();
	let addrs = [];
	for (const name of Object.keys(ifs)) {
		for (const addr of ifs[name] || []) {
			if (addr.family === "IPv4" && !addr.internal) addrs.push(addr.address);
		}
	}
	const preferList = (
		process.env.LYNX_HOST_PREFER ||
		process.env.WEB_HOST_PREFER ||
		"172.27.,172.,10.,192.168.,192."
	)
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	const score = (h) => {
		const idx = preferList.findIndex((pref) => h.startsWith(pref));
		return idx === -1 ? 999 : idx;
	};
	addrs = Array.from(new Set(addrs)).sort((a, b) => score(a) - score(b));
	return addrs;
}

async function findFirstUpUrl() {
	const startedAt = Date.now();
	// Candidate order:
	// 1) explicit LYNX_DEV_URL
	// 2) hosts from LYNX_HOST (if provided)
	// 3) LAN IPv4 addresses
	// 4) localhost fallback
	const candidates = [];
	if (explicitUrl) candidates.push(explicitUrl);
	const hostList = hostEnv ? [hostEnv] : [];
	const lanHosts = getLanHosts();
	const fallbacks = ["127.0.0.1", "localhost"];
	const hosts = [...hostList, ...lanHosts, ...fallbacks];
	for (const h of hosts) {
		for (let p = start; p <= end; p++)
			candidates.push(`${scheme}://${h}:${p}/`);
	}
	while (Date.now() - startedAt < timeoutMs) {
		// Probe in parallel to minimize delay
		const checks = await Promise.all(
			candidates.map(async (u) => ({ url: u, up: await isUp(u) })),
		);
		const hit = checks.find((c) => c.up);
		if (hit) return hit.url;
		await sleep(pollIntervalMs);
	}
	throw new Error(`Timed out waiting for dev server on ports ${start}-${end}`);
}

(async () => {
	try {
		const url = await findFirstUpUrl();
		console.log(`[lynx:auto] Detected dev server at ${url}`);
		const child = spawn(
			process.execPath,
			["scripts/launch-lynx.js", "--url", url],
			{
				stdio: "inherit",
				cwd: process.cwd(),
				env: process.env,
			},
		);
		child.on("exit", (code) => process.exit(code ?? 0));
	} catch (err) {
		console.error(String(err?.message || err));
		process.exit(1);
	}
})();
