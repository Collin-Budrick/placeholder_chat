#!/usr/bin/env node
// Launch Lynx Explorer (if available) and show a QR code for the dev URL
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const getArg = (name, def) => {
	const idx = args.findIndex((a) => a === name || a.startsWith(name + "="));
	if (idx === -1) return def;
	const a = args[idx];
	if (a.includes("=")) return a.split("=").slice(1).join("=");
	return args[idx + 1] ?? def;
};

const DEFAULT_URL = "http://localhost:5173/";
const url = process.env.LYNX_DEV_URL || getArg("--url", DEFAULT_URL);

function pickLanHost(prefer = ["192.168.", "192.", "10.", "172.27.", "172."]) {
	const netIfs = os.networkInterfaces();
	const addrs = [];
	for (const ifname of Object.keys(netIfs)) {
		for (const addr of netIfs[ifname] || []) {
			if (addr.family === "IPv4" && !addr.internal) addrs.push(addr.address);
		}
	}
	const uniq = (arr) => Array.from(new Set(arr));
	const score = (h) => {
		const idx = prefer.findIndex((p) => h.startsWith(p));
		return idx === -1 ? 999 : idx;
	};
	const sorted = uniq(addrs).sort((a, b) => score(a) - score(b));
	return sorted[0] || "127.0.0.1";
}

function buildLynxQrUrl() {
	const forced = process.env.LYNX_QR_URL;
	if (forced) return forced;
	const host = process.env.LYNX_QR_HOST || pickLanHost();
	const port = process.env.LYNX_QR_PORT || "3000";
	const u = new URL(`http://${host}:${port}/main.lynx.bundle`);
	u.searchParams.set("fullscreen", "true");
	return u.toString();
}

function trySpawn(cmd, cmdArgs = []) {
	try {
		const child = spawn(cmd, cmdArgs, {
			detached: true,
			stdio: "ignore",
			shell: process.platform === "win32",
		});
		child.unref();
		return true;
	} catch (_) {
		return false;
	}
}

function openProtocol(target) {
	if (process.platform === "darwin") {
		return trySpawn("open", [target]);
	}
	if (process.platform === "win32") {
		// Use cmd to ensure empty title
		try {
			const child = spawn("cmd", ["/c", "start", '""', target], {
				detached: true,
				stdio: "ignore",
				shell: false,
			});
			child.unref();
			return true;
		} catch (_) {
			/* noop */
		}
		return false;
	}
	return trySpawn("xdg-open", [target]);
}

// 1) Prefer explicit executable via env
const lynxExe = process.env.LYNX_EXPLORER_EXE;
let launched = false;
if (lynxExe && existsSync(lynxExe)) {
	// Most apps accept a URL as an argument
	launched = trySpawn(lynxExe, [url]);
}

// 2) Try PATH candidates if not launched
const candidates = ["lynx-explorer", "LynxExplorer", "Lynx Explorer", "lynx"];
for (const c of candidates) {
	if (launched) break;
	launched = trySpawn(c, [url]);
}

// 3) Try custom protocol if provided
if (!launched && process.env.LYNX_PROTOCOL) {
	const protoUrl = `${process.env.LYNX_PROTOCOL}${process.env.LYNX_PROTOCOL.endsWith("=") ? "" : ""}${url}`;
	launched = openProtocol(protoUrl);
}

// 4) If still not launched, just print QR + instructions
const { default: qrcode } = await import("qrcode-terminal");
const qrTarget = buildLynxQrUrl();
qrcode.generate(qrTarget, { small: true }, (qr) => {
	console.log("");
	console.log("●  Scan with Lynx");
	console.log("");
	console.log(qr);
	console.log("");
	console.log("◆  " + qrTarget);
	console.log("");
});
