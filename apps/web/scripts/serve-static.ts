/* Bun static file server with simple logging */
import { join, normalize } from "path";

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
      let file = Bun.file(filePath);
      if (!(await file.exists())) {
        // Try SPA fallback to index.html
        file = Bun.file(join(root, "index.html"));
      }
      if (await file.exists()) {
        res = new Response(file, {
          headers: { "Content-Type": file.type || "application/octet-stream" },
        });
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
