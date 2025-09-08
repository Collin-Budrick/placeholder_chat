/* Bun static file server with simple logging */
import { join, normalize, extname } from "path";

const port = Number(process.env.PORT || 5174);
const hostname = process.env.HOST || "0.0.0.0";
// Assume we run from apps/web; otherwise allow override via DIST_DIR
const root = process.env.DIST_DIR || join(process.cwd(), "dist");

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
  port,
  hostname,
  async fetch(req) {
    const { method } = req;
    const url = new URL(req.url);
    let pathname = url.pathname;

    if (pathname.endsWith("/")) pathname += "index.html";
    const filePath = safePath(pathname);
    let res: Response;

    if (!filePath) {
      res = new Response("Forbidden", { status: 403 });
    } else {
      const ae = String(req.headers.get('accept-encoding') || '');
      const wantsBr = /\bbr\b/i.test(ae);
      const wantsGz = /\bgzip\b/i.test(ae);

      // Try precompressed variants for common static assets
      const isAsset = /\.(?:js|mjs|css|woff2?|ttf|eot|png|jpe?g|gif|svg|webp|avif|ico|map)$/i.test(pathname)
        || pathname.startsWith('/assets/')
        || pathname.startsWith('/build/')
        || pathname === '/theme-init.js';

      const base = Bun.file(filePath);
      const baseExisted = await base.exists();
      let file = base;
      let encoding = '';

      if (isAsset) {
        const br = Bun.file(filePath + '.br');
        const gz = Bun.file(filePath + '.gz');
        if (wantsBr && (await br.exists())) { file = br; encoding = 'br'; }
        else if (wantsGz && (await gz.exists())) { file = gz; encoding = 'gzip'; }
      }

      if (!baseExisted) {
        // Try SPA fallback to index.html
        file = Bun.file(join(root, "index.html"));
      }
      if (await file.exists()) {
        const headers: Record<string, string> = {};
        // Ensure a sensible content-type when serving precompressed files
        const ext = extname(filePath).toLowerCase();
        const map: Record<string,string> = {
          '.js': 'text/javascript; charset=utf-8',
          '.mjs': 'text/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.json': 'application/json; charset=utf-8',
          '.svg': 'image/svg+xml',
          '.map': 'application/json; charset=utf-8',
          '.html': 'text/html; charset=utf-8',
        };
        headers['Content-Type'] = map[ext] || base.type || 'application/octet-stream';
        if (encoding) headers['Content-Encoding'] = encoding;
        headers['Vary'] = 'Accept-Encoding';
        // Cache hints
        if (isAsset) {
          headers['Cache-Control'] = 'public, max-age=31536000, immutable';
        } else if (pathname.endsWith('/q-data.json')) {
          headers['Cache-Control'] = 'public, max-age=60, stale-while-revalidate=600';
        } else {
          headers['Cache-Control'] = 'public, max-age=600, stale-while-revalidate=86400';
        }
        // Security headers
        headers['X-Content-Type-Options'] = 'nosniff';
        headers['Referrer-Policy'] = 'strict-origin-when-cross-origin';
        headers['X-Frame-Options'] = 'DENY';
        headers['Cross-Origin-Opener-Policy'] = 'same-origin';
        headers['Cross-Origin-Resource-Policy'] = 'same-origin';
        headers['Cross-Origin-Embedder-Policy'] = 'require-corp';

        // If serving HTML, add a CSP nonce for inline scripts
        let body: BodyInit = file;
        if (ext === '.html' || !baseExisted) {
          const u8 = new Uint8Array(16);
          crypto.getRandomValues(u8);
          const nonce = btoa(String.fromCharCode(...u8));
          headers['Content-Security-Policy'] = [
            "default-src 'self'",
            "base-uri 'self'",
            "object-src 'none'",
            "frame-ancestors 'none'",
            "img-src 'self' data: blob:",
            "font-src 'self' data:",
            "style-src 'self' 'unsafe-inline'",
            `script-src 'self' 'nonce-${nonce}'`,
            "connect-src 'self'",
          ].join('; ');
          try {
            let html = await file.text();
            html = html.replace(/<script(?![^>]*\bsrc=)([^>]*)>/gi, (m, g1) => `<script${g1} nonce="${nonce}">`);
            // Inject AsyncLocalStorage polyfill to placate libs expecting it in browsers
            try {
              const poly = `<script nonce="${nonce}">(function(){try{var w=window; if(w && !('AsyncLocalStorage' in w)){w.AsyncLocalStorage=function(){this.getStore=function(){return void 0}; this.run=function(_s,cb){try{return typeof cb==='function'?cb():void 0;}catch(_){return void 0}}; this.enterWith=function(){}}}}catch(e){}})();</script>`;
              html = html.replace(/<head[^>]*>/i, (m)=> m + poly);
            } catch {}
            // Inline the main stylesheet to remove a small render-blocking CSS request
            try {
              const linkRe = /<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']*assets\/[^"]+-style\.css)["'][^>]*>/i;
              const mm = html.match(linkRe);
              if (mm && mm[1]) {
                const cssHref = mm[1].replace(/^\//, '');
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
          headers['Content-Security-Policy'] = [
            "default-src 'self'",
            "base-uri 'self'",
            "object-src 'none'",
            "frame-ancestors 'none'",
            "img-src 'self' data: blob:",
            "font-src 'self' data:",
            "style-src 'self' 'unsafe-inline'",
            "script-src 'self'",
            "connect-src 'self'",
          ].join('; ');
        }

        res = new Response(body, { headers });
      } else {
        res = new Response("Not Found", { status: 404 });
      }
    }

    log(`${req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "-"} ${method} ${pathname} -> ${res.status}`);
    return res;
  },
  error(err) {
    log(`ERROR ${err?.message || err}`);
    return new Response("Internal Server Error", { status: 500 });
  },
});

log(`Started ${server.development ? 'development ' : ''}server: ${server.protocol}://${server.hostname}:${server.port}`);
log(`Serving ${root} on http://${hostname}:${server.port}`);
