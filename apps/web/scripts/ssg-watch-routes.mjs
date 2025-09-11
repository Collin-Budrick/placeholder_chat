#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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
	if (exists(path.join(cwd, "src", "routes"))) return cwd;
	const mono = path.join(cwd, "apps", "web");
	if (exists(path.join(mono, "src", "routes"))) return mono;
	return cwd;
}

const projectRoot = detectProjectRoot();
const srcRoot = path.join(projectRoot, "src");
const routesRoot = path.join(srcRoot, "routes");
const POLL_MS = Number(process.env.WATCH_POLL_INTERVAL_MS || 1000);
const distDir = path.join(projectRoot, "dist");
const serverDir = path.join(projectRoot, "server");
const versionFile = path.join(distDir, "__ssg-version.json");
const routesFile = path.join(projectRoot, ".ssg-routes.json");
const DEBUG = process.env.DEBUG_SSG_WATCH === "1";

function bumpVersionFile() {
	try {
		let v = 0;
		try {
			v = JSON.parse(fs.readFileSync(versionFile, "utf8")).v | 0;
		} catch {}
		const next = { v: (v + 1) | 0, t: Date.now() };
		try {
			fs.mkdirSync(distDir, { recursive: true });
		} catch {}
		fs.writeFileSync(versionFile, JSON.stringify(next));
		if (DEBUG) console.log("[ssg-watch] bumped version file ->", next.v);
	} catch {}
}

function writeRoutesFile(routes) {
	try {
		fs.writeFileSync(routesFile, JSON.stringify(routes));
	} catch {}
}

async function ensureClientReady(maxWaitMs = 90000) {
	const start = Date.now();
	const buildDir = path.join(distDir, "build");
	const qManifest = path.join(distDir, "q-manifest.json");
	while (true) {
		try {
			const hasBuild =
				fs.existsSync(buildDir) &&
				fs.readdirSync(buildDir).some((f) => /\.(js|mjs)$/i.test(f));
			const hasHtml = fs.existsSync(path.join(distDir, "index.html"));
			const hasQManifest = fs.existsSync(qManifest);
			if (hasBuild && hasHtml && hasQManifest) return;
		} catch {}
		if (Date.now() - start > maxWaitMs) {
			if (DEBUG)
				console.warn("[ssg-watch] client manifest wait timed out; proceeding");
			return;
		}
		await new Promise((r) => setTimeout(r, 250));
	}
}

async function ensureManifestOrBuild() {
	const qManifest = path.join(distDir, "q-manifest.json");
	const has = fs.existsSync(qManifest);
	if (has) return;
	if (DEBUG)
		console.log(
			"[ssg-watch] q-manifest.json missing — running one-off client build",
		);
	await new Promise((res, rej) => {
		const logLevel = process.env.VITE_LOG_LEVEL || "warn";
		// Build client once to materialize manifest; allow emptyOutDir since SSG will run immediately after
		const c = spawn("bunx", ["vite", "build", "--logLevel", logLevel], {
			stdio: "inherit",
			cwd: projectRoot,
			shell: process.platform === "win32",
			env: { ...process.env, NO_HTTPS: "1", VITE_WATCH: "0" },
		});
		c.on("exit", (code) =>
			code === 0 ? res() : rej(new Error("client build (manifest) failed")),
		);
	});
}

function syncManifestToServer() {
	try {
		const src = path.join(distDir, "q-manifest.json");
		if (!fs.existsSync(src)) return;
		try {
			fs.mkdirSync(serverDir, { recursive: true });
		} catch {}
		const dst = path.join(serverDir, "q-manifest.json");
		fs.copyFileSync(src, dst);
		if (DEBUG)
			console.log("[ssg-watch] synced manifest to server/", path.basename(dst));
	} catch {}
}

function routeFromFile(abs) {
	const rel = path.relative(routesRoot, abs).replace(/\\/g, "/");
	if (rel.startsWith("..")) return null; // outside
	// Ignore files not likely to be direct page entries
	if (!/\.(tsx|ts|mdx?|md)$/i.test(rel)) return null;
	// Map to route path by dropping file extension and trailing "/index"
	let p = rel.replace(/\.(tsx|ts|mdx?|md)$/i, "");
	// Skip dynamic routes for now
	if (p.includes("[")) return null;
	// Collapse to folder (strip trailing /index)
	p = p.replace(/\/index$/, "");
	// If it became empty, it's root
	if (!p || p === "") return "/";
	if (!p.startsWith("/")) p = "/" + p;
	return p;
}

// --- Smarter rebuild: Map changed files -> impacted routes by scanning imports ---
const importRe =
	/\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const resolveExts = [".tsx", ".ts", ".jsx", ".js", ".mdx", ".md"];
function tryFile(p) {
	try {
		if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
	} catch {}
	return null;
}
function resolveAsFileOrIndex(abs) {
	// Try direct file with known extensions
	for (const ext of ["", ...resolveExts]) {
		const p = tryFile(abs + ext);
		if (p) return p;
	}
	// Try index.* inside a directory
	try {
		if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
			for (const ext of resolveExts) {
				const p = tryFile(path.join(abs, "index" + ext));
				if (p) return p;
			}
		}
	} catch {}
	return null;
}
function resolveImport(spec, fromFile) {
	try {
		if (/^https?:\/\//i.test(spec)) return null;
		if (spec.startsWith(".") || spec.startsWith("/")) {
			const base = path.resolve(path.dirname(fromFile), spec);
			return resolveAsFileOrIndex(base);
		}
		if (spec.startsWith("~/")) {
			const base = path.join(srcRoot, spec.slice(2));
			return resolveAsFileOrIndex(base);
		}
		// ignore bare imports (node_modules)
		return null;
	} catch {
		return null;
	}
}

function listRouteEntryFiles() {
	const out = [];
	function walk(dir) {
		try {
			for (const de of fs.readdirSync(dir, { withFileTypes: true })) {
				const p = path.join(dir, de.name);
				if (de.isDirectory()) walk(p);
				else if (/\.(tsx|ts|mdx?|md)$/i.test(p)) {
					// consider as entry if it's an index.* or leaf .tsx under routes
					if (
						/[/\\]index\.(tsx|ts|mdx?|md)$/i.test(p) ||
						/\.(tsx|ts|mdx?|md)$/i.test(p)
					) {
						const r = routeFromFile(p);
						if (r) out.push({ route: r, file: p });
					}
				}
			}
		} catch {}
	}
	walk(routesRoot);
	// De-dup by route, prefer index files
	const byRoute = new Map();
	for (const e of out) {
		if (!byRoute.has(e.route)) byRoute.set(e.route, e.file);
	}
	return Array.from(byRoute.entries()).map(([route, file]) => ({
		route,
		file,
	}));
}

function buildGraph() {
	const entries = listRouteEntryFiles();
	const routeToFiles = new Map();
	const cache = new Map();
	function dfs(file, acc, seen, depth = 0) {
		if (depth > 64) return;
		let text = cache.get(file);
		if (text === undefined) {
			try {
				text = fs.readFileSync(file, "utf8");
			} catch {
				text = "";
			}
			cache.set(file, text);
		}
		acc.add(file);
		importRe.lastIndex = 0;
		let m;
		while ((m = importRe.exec(text))) {
			const spec = m[1] || m[2];
			if (!spec) continue;
			const resolved = resolveImport(spec, file);
			if (!resolved) continue;
			if (!resolved.startsWith(srcRoot)) continue; // only project sources
			if (seen.has(resolved)) continue;
			seen.add(resolved);
			dfs(resolved, acc, seen, depth + 1);
		}
	}
	for (const { route, file } of entries) {
		const acc = new Set();
		dfs(file, acc, new Set());
		routeToFiles.set(route, acc);
	}
	return routeToFiles;
}

let routeGraph = buildGraph();
let graphRefreshTimer = null;
function scheduleGraphRefresh() {
	clearTimeout(graphRefreshTimer);
	graphRefreshTimer = setTimeout(() => {
		try {
			routeGraph = buildGraph();
		} catch {}
	}, 500);
}

function spawnSSG(routes) {
	// Ensure SSG builds are one-off and exit; do not set VITE_WATCH=1 here
	writeRoutesFile(routes);
	const env = {
		...process.env,
		SSG_ONLY_ROUTES: routes.join(","),
		SSG_ROUTES_FILE: routesFile,
		VITE_WATCH: "0",
		NO_HTTPS: "1",
	};
	console.log(`[ssg-watch] Building: ${env.SSG_ONLY_ROUTES}`);
	const logLevel = process.env.VITE_LOG_LEVEL || "warn";
	return spawn(
		"bunx",
		[
			"vite",
			"build",
			"-c",
			"adapters/static/vite.config.ts",
			"--logLevel",
			logLevel,
		],
		{
			stdio: "inherit",
			env,
			cwd: projectRoot,
			shell: process.platform === "win32",
		},
	);
}

// Initial builds: client bundle and a full SSG pass once to ensure dist baseline exists
async function initial() {
	const distIndex = path.join(projectRoot, "dist", "index.html");
	// If a long-lived client watcher is not running, do one client build.
	// Compose sets CLIENT_WATCH=1 when it runs the watcher in parallel.
	if (!process.env.CLIENT_WATCH) {
		await new Promise((res, rej) => {
			const logLevel = process.env.VITE_LOG_LEVEL || "warn";
			const c = spawn("bunx", ["vite", "build", "--logLevel", logLevel], {
				stdio: "inherit",
				cwd: projectRoot,
				shell: process.platform === "win32",
				env: { ...process.env, NO_HTTPS: "1", VITE_WATCH: "1" },
			});
			c.on("exit", (code) =>
				code === 0 ? res() : rej(new Error("client build failed")),
			);
		});
	}
	// Always do a full SSG pass once at startup to ensure dist is fresh
	await ensureClientReady();
	await ensureManifestOrBuild();
	syncManifestToServer();
	await new Promise((res, rej) => {
		const logLevel = process.env.VITE_LOG_LEVEL || "warn";
		const c = spawn(
			"bunx",
			[
				"vite",
				"build",
				"-c",
				"adapters/static/vite.config.ts",
				"--logLevel",
				logLevel,
			],
			{
				stdio: "inherit",
				cwd: projectRoot,
				shell: process.platform === "win32",
				env: { ...process.env, NO_HTTPS: "1", VITE_WATCH: "0" },
			},
		);
		c.on("exit", (code) =>
			code === 0 ? res() : rej(new Error("ssg build failed")),
		);
	});
	bumpVersionFile();
}

const queue = new Set();
let building = false;
// De-dupe rapid duplicate events for the same path (fs.watch often fires twice on Windows)
const recentEvents = new Map();
function isDuplicateEvent(p, windowMs = 200) {
	const now = Date.now();
	const last = recentEvents.get(p) || 0;
	recentEvents.set(p, now);
	return now - last < windowMs;
}
function schedule(route) {
	if (!route) return;
	queue.add(route);
	if (building) return;
	building = true;
	const run = () => {
		const routes = Array.from(queue);
		queue.clear();
		// Make sure client build produced the manifest/chunks before SSG
		ensureClientReady().then(async () => {
			await ensureManifestOrBuild();
			syncManifestToServer();
			const child = spawnSSG(routes);
			let finished = false;
			const timer = setTimeout(() => finalize("timeout"), 120000);
			function finalize(reason) {
				if (finished) return;
				finished = true;
				clearTimeout(timer);
				if (reason === 0) {
					bumpVersionFile();
				} else if (typeof reason === "number") {
					console.error(`[ssg-watch] build exited with code ${reason}`);
				} else if (reason && reason !== "close") {
					console.error(`[ssg-watch] build ended: ${reason}`);
				}
				if (queue.size > 0) {
					run();
				} else {
					building = false;
				}
			}
			child.once("exit", (code) => finalize(code ?? "exit"));
			child.once("close", () => finalize("close"));
			child.once("error", (err) => finalize(err?.message || "error"));
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
		const opts = { persistent: true };
		try {
			if (process.platform === "win32") opts.recursive = false;
		} catch {}
		fs.watch(dir, opts, (event, filename) => {
			if (!filename) return;
			const abs = path.join(dir, filename.toString());
			if (isDuplicateEvent(abs)) return;
			if (DEBUG)
				console.log(
					"[ssg-watch] fs.watch",
					event,
					path.relative(projectRoot, abs),
				);
			// Route-local change: rebuild that route
			const route = routeFromFile(abs);
			if (route) schedule(route);
			// Non-route project source: map to impacted routes
			else if (abs.startsWith(srcRoot)) {
				const impacted = [];
				for (const [r, files] of routeGraph.entries()) {
					if (files.has(abs)) impacted.push(r);
				}
				if (impacted.length) {
					console.log(
						`[ssg-watch] Change in ${path.relative(projectRoot, abs)} -> ${impacted.join(",")}`,
					);
					for (const r of impacted) schedule(r);
				}
				scheduleGraphRefresh();
			}
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
		console.error("[ssg-watch] failed to watch", dir, e?.message || e);
	}
}

(async () => {
	console.log("[ssg-watch] initializing");
	try {
		await initial();
	} catch (e) {
		console.error("[ssg-watch] initial build failed", e?.message || e);
	}
	// Watch the entire src tree to catch component/lib edits
	watchDir(srcRoot);
	walk(srcRoot);
	console.log("[ssg-watch] watching", srcRoot);
	// Fallback poller: Docker Desktop on Windows/macOS can miss fs.watch events on bind mounts
	// Poll mtimes of candidate files and schedule builds when they change
	const mtimes = new Map(); // path -> { t: mtimeMs, s: size }
	function snapshot(dir) {
		try {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				const p = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					snapshot(p);
				} else {
					if (!/\.(tsx|ts|mdx?|md)$/i.test(p)) continue;
					const st = fs.statSync(p);
					const prev = mtimes.get(p) || { t: 0, s: 0 };
					const nowT = st.mtimeMs || st.mtime?.getTime?.() || 0;
					const nowS = st.size || 0;
					if (nowT > prev.t || nowS !== prev.s) {
						mtimes.set(p, { t: nowT, s: nowS });
						if (DEBUG)
							console.log(
								"[ssg-watch] poll change",
								path.relative(projectRoot, p),
							);
						const route = routeFromFile(p);
						if (route) schedule(route);
						else if (p.startsWith(srcRoot)) {
							const impacted = [];
							for (const [r, files] of routeGraph.entries()) {
								if (files.has(p)) impacted.push(r);
							}
							if (impacted.length) {
								console.log(
									`[ssg-watch] Change in ${path.relative(projectRoot, p)} -> ${impacted.join(",")}`,
								);
								for (const r of impacted) schedule(r);
							}
							scheduleGraphRefresh();
						}
					}
				}
			}
		} catch {}
	}
	// Seed mtimes so we don't rebuild everything immediately
	try {
		(function seed(dir) {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				const p = path.join(dir, entry.name);
				if (entry.isDirectory()) seed(p);
				else if (/\.(tsx|ts|mdx?|md)$/i.test(p)) {
					try {
						const st = fs.statSync(p);
						mtimes.set(p, {
							t: st.mtimeMs || st.mtime?.getTime?.() || Date.now(),
							s: st.size || 0,
						});
					} catch {}
				}
			}
		})(srcRoot);
	} catch {}
	setInterval(() => snapshot(srcRoot), Math.max(100, POLL_MS));
})();
