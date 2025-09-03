/*
 * WHAT IS THIS FILE?
 *
 * It's the entry point for the Bun HTTP server when building for production.
 *
 * Learn more about the Bun integration here:
 * - https://qwik.dev/docs/deployments/bun/
 * - https://bun.sh/docs/api/http
 *
 */
import { createQwikCity } from "@builder.io/qwik-city/middleware/bun";
import qwikCityPlan from "@qwik-city-plan";
import render from "./entry.ssr";

// Create the Qwik City Bun middleware
const { router, notFound, staticFile } = createQwikCity({
  render,
  qwikCityPlan,
  static: {
    cacheControl: "public, max-age=31536000, immutable",
  },
});

// Allow for dynamic port
const port = Number(Bun.env.PORT ?? 3000);
// Optional TLS for local HTTPS testing: set TLS_CERT_FILE and TLS_KEY_FILE to PEM file paths
let tls: any = undefined;
try {
  const certFile = (Bun.env.TLS_CERT_FILE || Bun.env.SSL_CERT_FILE) as string | undefined;
  const keyFile = (Bun.env.TLS_KEY_FILE || Bun.env.SSL_KEY_FILE) as string | undefined;
  if (certFile && keyFile) {
    const cert = await Bun.file(certFile).text();
    const key = await Bun.file(keyFile).text();
    if (cert && key) tls = { cert, key };
  }
} catch { /* ignore */ }

console.log(`Server started: ${tls ? 'https' : 'http'}://localhost:${port}/`);

Bun.serve({
  async fetch(request: Request) {
    const url = new URL(request.url);
    const forwardedHttps = (() => {
      try {
        const h = request.headers;
        const xfProto = h.get('x-forwarded-proto') || h.get('x-forwarded-protocol');
        const forwarded = h.get('forwarded');
        const xfSsl = h.get('x-forwarded-ssl');
        return !!((xfProto && /https/i.test(xfProto)) || (forwarded && /proto=https/i.test(forwarded)) || (xfSsl && /on/i.test(xfSsl)));
      } catch { return false; }
    })();
    const isHttps = url.protocol === 'https:' || !!tls || forwardedHttps;

    // Optional: force redirect to HTTPS when not secure
    if (!isHttps && (Bun.env.FORCE_HTTPS_REDIRECT === '1' || Bun.env.ENFORCE_TLS === '1')) {
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 308);
    }

    // Helper to attach HSTS to responses in production for all assets (static + SSR)
    const withHSTS = (resp: Response): Response => {
      if (!isHttps) return resp;
      try {
        const headers = new Headers(resp.headers);
        if (!headers.has('Strict-Transport-Security')) {
          headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
        }
        return new Response(resp.body, { status: resp.status, headers });
      } catch {
        return resp;
      }
    };

    const staticResponse = await staticFile(request);
    if (staticResponse) {
      return withHSTS(staticResponse);
    }

    // Server-side render this request with Qwik City
    const qwikCityResponse = await router(request);
    if (qwikCityResponse) {
      return withHSTS(qwikCityResponse);
    }

    // Path not found
    return withHSTS(await notFound(request));
  },
  port,
  ...(tls ? { tls } : {}),
});

// Optional secondary HTTP server for 308 redirects to HTTPS in production
if (tls && (Bun.env.ENABLE_HTTP_REDIRECT === '1' || Bun.env.HTTP_REDIRECT_PORT)) {
  const redirectPort = Number(Bun.env.HTTP_REDIRECT_PORT || (port === 443 ? 80 : port + 1));
  Bun.serve({
    port: redirectPort,
    fetch(req: Request) {
      try {
        const u = new URL(req.url);
        u.protocol = 'https:';
        u.port = String(port);
        return Response.redirect(u.toString(), 308);
      } catch {
        return new Response(null, { status: 308, headers: { Location: `https://localhost:${port}/` } });
      }
    },
  });
  console.log(`HTTP->HTTPS redirect server on http://localhost:${redirectPort}/`);
}
