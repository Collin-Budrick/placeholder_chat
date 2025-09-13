/* Bun static file server with simple logging */

import * as fs from "node:fs";
import { extname, join, normalize } from "path";

const port = Number(process.env.PORT || 5174);
const hostname = process.env.HOST || "0.0.0.0";
// Assume we run from apps/web; otherwise allow override via DIST_DIR
const root = process.env.DIST_DIR || join(process.cwd(), "dist");

// Live-reload (SSE + polling) for dev preview
const liveReload = String(process.env.LIVE_RELOAD || "1") !== "0";
// Allow disabling SSE fully to avoid proxy/browser protocol issues
const sseEnabled = String(process.env.LIVE_RELOAD_SSE || "0") !== "0";
const ssePath = "/__ssg-events";
const pingPath = "/__ssg-ping";
const encoder = new TextEncoder();
const sseClients = new Set<WritableStreamDefaultWriter<Uint8Array>>();
const wsClients = new Set<any>();
let buildVersion = 0;
// Initialize buildVersion from version file if present
try {
  const vf = join(root, "__ssg-version.json");
  const raw = fs.readFileSync(vf, "utf8");
  const j = JSON.parse(raw);
  if (j && typeof j.v === "number") buildVersion = j.v | 0;
} catch {}
function sseResponse(req: Request) {
  const ts = new TransformStream<Uint8Array>();
  const writer = ts.writable.getWriter();
  sseClients.add(writer);
  try {
    (req as any).signal?.addEventListener?.("abort", () => {
      try {
        writer.close();
      } catch {}
      sseClients.delete(writer);
    });
  } catch {}
  writer.write(encoder.encode(`: connected\nretry: 1000\n\n`)).catch(() => {
    try {
      writer.close();
    } catch {}
    sseClients.delete(writer);
  });
  return new Response(ts.readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
function sseBroadcast(event: string) {
  const buf = encoder.encode(`event: ${event}\n\n`);
  for (const w of Array.from(sseClients)) {
    w.write(buf).catch(() => {
      try {
        w.close();
      } catch {}
      sseClients.delete(w);
    });
  }
}
function wsBroadcast(kind: string) {
  for (const ws of Array.from(wsClients)) {
    try {
      ws.send(kind);
    } catch {
      try {
        ws.close();
      } catch {}
      wsClients.delete(ws);
    }
  }
}
setInterval(() => {
  if (!liveReload || sseClients.size === 0) return;
  const buf = encoder.encode(`: ping\n\n`);
  for (const w of Array.from(sseClients)) {
    w.write(buf).catch(() => {
      try {
        w.close();
      } catch {}
      sseClients.delete(w);
    });
  }
}, 20000);

// Watch dist for changes and broadcast reloads (debounced)
if (liveReload) {
  try {
    let t: any = null;
    // @ts-expect-error Bun global
    (globalThis as any).Bun?.watch?.(root, {
      recursive: true,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      listener(_evt: string, _p: string) {
        clearTimeout(t);
        t = setTimeout(() => {
          try {
            const vf = join(root, "__ssg-version.json");
            const raw = fs.readFileSync(vf, "utf8");
            const j = JSON.parse(raw);
            if (j && typeof j.v === "number") buildVersion = j.v | 0;
          } catch {}
          sseBroadcast("reload");
          wsBroadcast("reload");
        }, 150);
      },
    });
  } catch {}
}

function safePath(urlPath: string) {
  // prevent path traversal
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const cleaned = decoded.replace(/\\+/g, "/");
  const full = normalize(join(root, cleaned));
  if (!full.startsWith(normalize(root))) return null;
  return full;
}

function log(line: string) {
  const now = new Date();
  const ts = now.toISOString();
  console.log(`[${ts}] ${line}`);
}

const server = Bun.serve({
  websocket: {
    open(ws) {
      try {
        wsClients.add(ws);
      } catch {}
    },
    close(ws) {
      try {
        wsClients.delete(ws);
      } catch {}
    },
    message(_ws, _msg) {
      /* server push only */
    },
  } as any,
  port,
  hostname,
  async fetch(req) {
    const { method } = req;
    const url = new URL(req.url);
    const pathname = url.pathname;

    // SSE endpoint for live reload
    if (liveReload && sseEnabled && pathname === ssePath) {
      return sseResponse(req);
    }
    // WebSocket endpoint for live reload
    if (liveReload && pathname === "/__ssg-ws") {
      try {
        if ((server as any).upgrade?.(req)) return new Response(null, { status: 101 });
      } catch {}
      return new Response("Upgrade Required", { status: 426 });
    }
    // Polling endpoint for live reload (fallback)
    if (liveReload && pathname === pingPath) {
      const body = JSON.stringify({ v: buildVersion });
      return new Response(body, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    // Support extensionless pretty URLs by serving directory index.html
    // Example: /contact -> dist/contact/index.html
    const looksLikeHtml = !/\.[a-z0-9]+$/i.test(pathname.split("/").pop() || "");
    let candidatePathname = pathname;
    if (candidatePathname.endsWith("/")) candidatePathname += "index.html";
    const filePath = safePath(candidatePathname);
    let res: Response;

    if (!filePath) {
      res = new Response("Forbidden", { status: 403 });
    } else {
      const ae = String(req.headers.get("accept-encoding") || "");
      const wantsBr = /\bbr\b/i.test(ae);
      const wantsGz = /\bgzip\b/i.test(ae);

      // Try precompressed variants for common static assets
      const isAsset =
        /\.(?:js|mjs|css|woff2?|ttf|eot|png|jpe?g|gif|svg|webp|avif|ico|map)$/i.test(pathname) ||
        pathname.startsWith("/assets/") ||
        pathname.startsWith("/build/") ||
        pathname === "/theme-init.js";

      const base = Bun.file(filePath);
      const baseExisted = await base.exists();
      let file = base;
      let filePathUsed = filePath || "";
      let encoding = "";

      if (isAsset) {
        const br = Bun.file(filePath + ".br");
        const gz = Bun.file(filePath + ".gz");
        if (wantsBr && (await br.exists())) {
          file = br;
          encoding = "br";
          filePathUsed = filePath + ".br";
        } else if (wantsGz && (await gz.exists())) {
          file = gz;
          encoding = "gzip";
          filePathUsed = filePath + ".gz";
        }
      }

      if (!baseExisted) {
        // First try a directory index for pretty URLs
        if (looksLikeHtml) {
          const dirIndexPath = join(root, pathname, "index.html");
          const dirIndex = Bun.file(dirIndexPath);
          if (await dirIndex.exists()) {
            file = dirIndex;
            filePathUsed = dirIndexPath;
          } else {
            // SPA root fallback
            filePathUsed = join(root, "index.html");
            file = Bun.file(filePathUsed);
          }
        } else {
          // Non-HTML paths fall back to SPA root as a last resort
          filePathUsed = join(root, "index.html");
          file = Bun.file(filePathUsed);
        }
      }
      if (await file.exists()) {
        const headers: Record<string, string> = {};
        // Ensure a correct content-type based on what we actually send
        // If we fall back to index.html for extensionless routes (e.g., /admin/users),
        // force HTML content-type so browsers render instead of downloading.
        const ext = baseExisted ? extname(filePath).toLowerCase() : ".html";
        const map: Record<string, string> = {
          ".js": "text/javascript; charset=utf-8",
          ".mjs": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".json": "application/json; charset=utf-8",
          ".svg": "image/svg+xml",
          ".map": "application/json; charset=utf-8",
          ".html": "text/html; charset=utf-8",
        };
        headers["Content-Type"] =
          map[ext] ||
          base.type ||
          (ext === ".html" ? "text/html; charset=utf-8" : "application/octet-stream");
        if (encoding) headers["Content-Encoding"] = encoding;
        headers["Vary"] = "Accept-Encoding";

        // Add ETag/Last-Modified and 304 handling for HTML and q-data.json
        const isQData = pathname.endsWith("/q-data.json");
        if (ext === ".html" || isQData) {
          try {
            const st = fs.statSync(filePathUsed);
            const mtime = st.mtime;
            const etag = `W/"${st.size}-${Math.floor((st.mtimeMs || mtime.getTime()) / 1000)}"`;
            headers["ETag"] = etag;
            headers["Last-Modified"] = mtime.toUTCString();
            const inm = req.headers.get("if-none-match");
            const ims = req.headers.get("if-modified-since");
            const notModifiedByEtag = inm && inm === etag;
            const notModifiedByTime = ims && Date.parse(ims) >= (st.mtimeMs || mtime.getTime());
            if (notModifiedByEtag || notModifiedByTime) {
              return new Response(null, { status: 304, headers });
            }
          } catch {}
        }
        // Cache hints (dev preview favors freshness for HTML/q-data)
        if (isAsset) {
          headers["Cache-Control"] = "public, max-age=31536000, immutable";
        } else if (pathname.endsWith("/q-data.json")) {
          headers["Cache-Control"] = liveReload
            ? "no-store, no-cache, must-revalidate, no-transform"
            : "public, max-age=60, stale-while-revalidate=600";
          if (liveReload) {
            headers["Pragma"] = "no-cache";
            headers["Expires"] = "0";
          }
        } else {
          // HTML or other documents
          headers["Cache-Control"] = liveReload
            ? "no-store, no-cache, must-revalidate, no-transform"
            : "public, max-age=600, stale-while-revalidate=86400";
          if (liveReload) {
            headers["Pragma"] = "no-cache";
            headers["Expires"] = "0";
          }
        }
        // Security headers
        headers["X-Content-Type-Options"] = "nosniff";
        headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
        headers["X-Frame-Options"] = "DENY";
        headers["Cross-Origin-Opener-Policy"] = "same-origin";
        headers["Cross-Origin-Resource-Policy"] = "same-origin";
        headers["Cross-Origin-Embedder-Policy"] = "require-corp";

        // If serving HTML, add a CSP nonce for inline scripts
        let body: BodyInit = file;
        if (ext === ".html") {
          const u8 = new Uint8Array(16);
          crypto.getRandomValues(u8);
          const nonce = btoa(String.fromCharCode(...u8));
          const imgExtra = (process.env.CSP_IMG || "https:").trim();
          headers["Content-Security-Policy"] = [
            "default-src 'self'",
            "base-uri 'self'",
            "object-src 'none'",
            "frame-ancestors 'none'",
            `img-src 'self' data: blob: ${imgExtra}`,
            "font-src 'self' data:",
            "style-src 'self' 'unsafe-inline'",
            `script-src 'self' 'nonce-${nonce}' 'unsafe-inline'`,
            "connect-src 'self'",
          ].join("; ");
          try {
            let html = await file.text();
            html = html.replace(
              /<script(?![^>]*\bsrc=)([^>]*)>/gi,
              (m, g1) => `<script${g1} nonce="${nonce}">`,
            );
            // Inject AsyncLocalStorage polyfill to placate libs expecting it in browsers
            try {
              const poly = `<script nonce="${nonce}">(function(){try{var w=window; if(w && !('AsyncLocalStorage' in w)){w.AsyncLocalStorage=function(){this.getStore=function(){return void 0}; this.run=function(_s,cb){try{return typeof cb==='function'?cb():void 0;}catch(_){return void 0}}; this.enterWith=function(){}}}}catch(e){}})();</script>`;
              html = html.replace(/<head[^>]*>/i, (m) => m + poly);
            } catch {}
            // Inject live-reload client (SSE/poll) in dev preview
            if (liveReload) {
              try {
                const lr = `<script nonce="${nonce}">(function(){try{
                  // Unregister any service workers in dev preview to avoid stale caches
                  if (navigator && 'serviceWorker' in navigator) { try { navigator.serviceWorker.getRegistrations().then(function(rs){ rs.forEach(function(r){ r.unregister().catch(function(){}); }); }); } catch(e){} }
                  var lastV=${buildVersion}; function bust(){var u=new URL(location.href); u.searchParams.set('_r', Date.now().toString()); location.replace(u.toString()); }
                  function poll(){fetch('${pingPath}',{cache:'no-store'}).then(function(r){return r.json()}).then(function(j){if(j&&typeof j.v==='number'&&j.v>lastV){lastV=j.v; bust();}}).catch(function(){});}
                  // Prefer WebSocket push
                  try{
                    var proto=(location.protocol==='https:'?'wss':'ws');
                    var ws=new WebSocket(proto+'://'+location.host+'/'+'__ssg-ws');
                    ws.onmessage=function(ev){ try{ if(String(ev && ev.data || '')==='reload'){ bust(); } }catch(_){} };
                    ws.onerror=function(){ try{ws.close();}catch(_){}};
                    ws.onclose=function(){ setInterval(poll, 1000); };
                  }catch(_){
                    var USE_SSE=${sseEnabled ? "true" : "false"};
                    if(USE_SSE && window.EventSource){ try{ var es=new EventSource('${ssePath}'); es.addEventListener('reload', function(){ bust(); }); es.onerror=function(){ try{es.close();}catch(_){}; setInterval(poll, 1000); }; }catch(_){ setInterval(poll, 1000); } }
                    else { setInterval(poll, 1500); }
                  }
                }catch(e){}})();</script>`;
                html = html.replace(/<head[^>]*>/i, (m) => m + lr);
              } catch {}
            }
            // Inline the main stylesheet to remove a small render-blocking CSS request
            try {
              const linkRe =
                /<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']*assets\/[^"]+-style\.css)["'][^>]*>/i;
              const mm = html.match(linkRe);
              if (mm && mm[1]) {
                const cssHref = mm[1].replace(/^\//, "");
                const cssAbs = join(root, cssHref);
                const cssFile = Bun.file(cssAbs);
                if (await cssFile.exists()) {
                  const css = await cssFile.text();
                  html = html.replace(linkRe, `<style>${css}</style>`);
                }
              }
            } catch {}
            body = html;
          } catch {}
        } else {
          const imgExtra2 = (process.env.CSP_IMG || "https:").trim();
          headers["Content-Security-Policy"] = [
            "default-src 'self'",
            "base-uri 'self'",
            "object-src 'none'",
            "frame-ancestors 'none'",
            `img-src 'self' data: blob: ${imgExtra2}`,
            "font-src 'self' data:",
            "style-src 'self' 'unsafe-inline'",
            "script-src 'self' 'unsafe-inline'",
            "connect-src 'self'",
          ].join("; ");
        }

        res = new Response(body, { headers });
      } else {
        res = new Response("Not Found", { status: 404 });
      }
    }

    log(
      `${req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "-"} ${method} ${pathname} -> ${res.status}`,
    );
    return res;
  },
  error(err) {
    log(`ERROR ${err?.message || err}`);
    return new Response("Internal Server Error", { status: 500 });
  },
});

const proto = "http";
log(`Started server: ${proto}://${hostname}:${port}`);
log(`Serving ${root} on ${proto}://${hostname}:${port}`);
