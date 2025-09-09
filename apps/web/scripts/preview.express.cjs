// Simple Express static preview server with gzip compression and cache headers
/* eslint-disable @typescript-eslint/no-var-requires */
const express = require('express');
const compression = require('compression');
const path = require('path');
const fs = require('fs');

const app = express();
const distDir = path.resolve(process.cwd(), 'dist');
const port = Number(process.env.PORT || 5174);

app.set('trust proxy', 1);
app.set('etag', 'strong');

// Compression for dynamic/text responses
app.use(
  compression({
    threshold: 0,
    filter: (req, res) => {
      const ae = req.headers['accept-encoding'] || '';
      if (/\b(br|gzip|deflate)\b/i.test(String(ae))) return compression.filter(req, res);
      return false;
    },
  }),
);

// Headers middleware (cache + security)
app.use((req, res, next) => {
  try {
    const p = req.path || '/';
    const isAsset = /\.(?:js|mjs|css|woff2?|ttf|eot|png|jpe?g|gif|svg|webp|avif|ico|map)$/i.test(p) ||
                    p.startsWith('/assets/') || p.startsWith('/build/') || p === '/theme-init.js';
    if (isAsset) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (p.endsWith('/q-data.json')) {
      res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=600');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=600, stale-while-revalidate=86400');
    }
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "connect-src 'self'",
    ].join('; '));
  } catch {}
  next();
});

// Precompressed asset serving: prefer .br then .gz
const mimeByExt = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.map': 'application/json; charset=utf-8',
};
app.get(["/assets/*", "/build/*", "/theme-init.js"], (req, res, next) => {
  try {
    const ae = String(req.headers['accept-encoding'] || '');
    const preferBr = /\bbr\b/i.test(ae);
    const preferGz = /\bgzip\b/i.test(ae);
    const rel = req.path.replace(/^\/+/, '');
    const abs = path.join(distDir, rel);
    const ext = path.extname(abs).toLowerCase();
    const type = mimeByExt[ext] || undefined;
    if (type && fs.existsSync(abs)) {
      const br = abs + '.br';
      const gz = abs + '.gz';
      if (preferBr && fs.existsSync(br)) {
        if (!res.getHeader('Content-Type') && type) res.setHeader('Content-Type', type);
        res.setHeader('Content-Encoding', 'br');
        res.setHeader('Vary', 'Accept-Encoding');
        return res.sendFile(br);
      }
      if (preferGz && fs.existsSync(gz)) {
        if (!res.getHeader('Content-Type') && type) res.setHeader('Content-Type', type);
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Vary', 'Accept-Encoding');
        return res.sendFile(gz);
      }
    }
  } catch {}
  return next();
});

// Static serving fallback
// Intercept HTML so we can add a CSP nonce to inline scripts
app.get(["/", "/index.html", /.*\.html$/], (req, res, next) => {
  try {
    const rel = req.path === '/' ? 'index.html' : req.path.replace(/^\/+/, '');
    const abs = path.join(distDir, rel);
    const file = fs.existsSync(abs) ? abs : path.join(distDir, 'index.html');
    let html = fs.readFileSync(file, 'utf8');
    const nonce = Buffer.from(require('crypto').randomBytes(16)).toString('base64');
    html = html.replace(/<script(?![^>]*\bsrc=)([^>]*)>/gi, (m, g1) => `<script${g1} nonce="${nonce}">`);
    // Add a tiny polyfill for AsyncLocalStorage to silence libraries that expect it in browsers
    try {
      const poly = `<script nonce="${nonce}">(function(){try{var w=window; if(w && !('AsyncLocalStorage' in w)){w.AsyncLocalStorage=function(){this.getStore=function(){return void 0}; this.run=function(_s,cb){try{return typeof cb==='function'?cb():void 0;}catch(_){return void 0}}; this.enterWith=function(){}}}}catch(e){}})();</script>`;
      html = html.replace(/<head[^>]*>/i, (m)=> m + poly);
    } catch {}
    // Inline the main stylesheet to avoid a small render-blocking CSS request
    try {
      const linkRe = /<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']*assets\/[^"]+-style\.css)["'][^>]*>/i;
      const m = html.match(linkRe);
      if (m && m[1]) {
        const cssHref = m[1].replace(/^\//, '');
        const cssAbs = path.join(distDir, cssHref);
        if (fs.existsSync(cssAbs)) {
          const css = fs.readFileSync(cssAbs, 'utf8');
          html = html.replace(linkRe, `<style>${css}</style>`);
        }
      }
    } catch {}
    // Override CSP with nonce for this HTML response
    const csp = [
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
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', csp);
    return res.status(200).send(html);
  } catch (e) {
    return next();
  }
});

// Extensionless route handler: serve directory index.html for pretty URLs
// Example: /admin/users -> dist/admin/users/index.html (with CSP nonce injection)
app.get(/^\/(?!assets\/|build\/|theme-init\.js|.*\.[a-z0-9]+($|\?)).*/i, (req, res, next) => {
  try {
    const rel = req.path.replace(/^\/+/, '');
    const file = path.join(distDir, rel, 'index.html');
    if (!fs.existsSync(file)) return next();
    let html = fs.readFileSync(file, 'utf8');
    const nonce = Buffer.from(require('crypto').randomBytes(16)).toString('base64');
    html = html.replace(/<script(?![^>]*\bsrc=)([^>]*)>/gi, (m, g1) => `<script${g1} nonce="${nonce}">`);
    try {
      const poly = `<script nonce="${nonce}">(function(){try{var w=window; if(w && !('AsyncLocalStorage' in w)){w.AsyncLocalStorage=function(){this.getStore=function(){return void 0}; this.run=function(_s,cb){try{return typeof cb==='function'?cb():void 0;}catch(_){return void 0}}; this.enterWith=function(){}}}}catch(e){}})();</script>`;
      html = html.replace(/<head[^>]*>/i, (m)=> m + poly);
    } catch {}
    try {
      const linkRe = /<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']*assets\/[^"]+-style\.css)["'][^>]*>/i;
      const m = html.match(linkRe);
      if (m && m[1]) {
        const cssHref = m[1].replace(/^\//, '');
        const cssAbs = path.join(distDir, cssHref);
        if (fs.existsSync(cssAbs)) {
          const css = fs.readFileSync(cssAbs, 'utf8');
          html = html.replace(linkRe, `<style>${css}</style>`);
        }
      }
    } catch {}
    const csp = [
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
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', csp);
    return res.status(200).send(html);
  } catch (e) {
    return next();
  }
});

// Static serving fallback
app.use(express.static(distDir, { fallthrough: true, etag: true, extensions: ['html'] }));
// SPA-ish fallback to index.html with CSP nonce injection
app.get('*', (req, res) => {
  try {
    const file = path.join(distDir, 'index.html');
    let html = fs.readFileSync(file, 'utf8');
    const nonce = Buffer.from(require('crypto').randomBytes(16)).toString('base64');
    html = html.replace(/<script(?![^>]*\bsrc=)([^>]*)>/gi, (m, g1) => `<script${g1} nonce="${nonce}">`);
    try {
      const poly = `<script nonce="${nonce}">(function(){try{var w=window; if(w && !('AsyncLocalStorage' in w)){w.AsyncLocalStorage=function(){this.getStore=function(){return void 0}; this.run=function(_s,cb){try{return typeof cb==='function'?cb():void 0;}catch(_){return void 0}}; this.enterWith=function(){}}}}catch(e){}})();</script>`;
      html = html.replace(/<head[^>]*>/i, (m)=> m + poly);
    } catch {}
    // Inline the main stylesheet to avoid a small render-blocking CSS request
    try {
      const linkRe = /<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']*assets\/[^"]+-style\.css)["'][^>]*>/i;
      const m = html.match(linkRe);
      if (m && m[1]) {
        const cssHref = m[1].replace(/^\//, '');
        const cssAbs = path.join(distDir, cssHref);
        if (fs.existsSync(cssAbs)) {
          const css = fs.readFileSync(cssAbs, 'utf8');
          html = html.replace(linkRe, `<style>${css}</style>`);
        }
      }
    } catch {}
    const csp = [
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
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', csp);
    return res.status(200).send(html);
  } catch (e) {
    return res.sendFile(path.join(distDir, 'index.html'));
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Express preview listening on http://0.0.0.0:${port}`);
});
