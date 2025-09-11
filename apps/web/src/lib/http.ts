import { ofetch } from 'ofetch';
import { logApi, redactHeaders, previewBodyMaybe } from './log';

// In browser, use same-origin relative path so Traefik/Vite dev proxy can route /api -> gateway.
// In SSR (Node, inside the web container), talk to the gateway service directly.
const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
let baseURL = '';
if (!isBrowser) {
  const envAny: any = (import.meta as any).env || {};
  const rawEnvBase = envAny.GATEWAY_URL || (typeof process !== 'undefined' ? (process.env?.GATEWAY_URL ?? '') : '');
  const inDocker = envAny.DOCKER_TRAEFIK === '1' || (typeof process !== 'undefined' && process.env?.DOCKER_TRAEFIK === '1');
  const fallback = inDocker ? 'http://gateway:7000' : 'http://127.0.0.1:7000';
  const raw = rawEnvBase || fallback;
  baseURL = raw.includes('localhost') ? raw.replace('localhost', '127.0.0.1') : raw;
}

// Toggle lightweight HTTP logging. Enabled by default in dev, opt-in in prod via VITE_LOG_HTTP=1
const __env: any = (import.meta as any)?.env || {};
const LOG_HTTP: boolean = Boolean(
  __env?.DEV === true ||
  __env?.VITE_LOG_HTTP === '1' ||
  (typeof process !== 'undefined' && (process.env?.VITE_LOG_HTTP === '1' || process.env?.LOG_HTTP === '1')),
);

export const api = ofetch.create({
  baseURL,
  headers: {
    Accept: 'application/json',
  },
  async onResponseError(args: any) {
    if (!LOG_HTTP) return; // keep silent unless logging enabled
    try {
      // ofetch's handler shape can vary; be defensive with types.
      const { request, response, options } = args || {};
      // Resolve a best-effort URL string
      const url =
        (options && options.url) ??
        ((request && (request as any).url) ? (request as any).url : (typeof request === 'string' ? request : ''));
      const method = (options?.method ?? 'GET').toString();

      // Best-effort logging for ofetch response errors
      const entry = {
        phase: 'error' as const,
        url: String(url ?? ''),
        method,
        status: response?.status,
        request: {
          headers: redactHeaders(options?.headers as any),
          bodyPreview: options?.body ? previewBodyMaybe(options.body).preview : undefined,
          bodySize: options?.body ? previewBodyMaybe(options.body).size : undefined,
        },
        response: {
          headers: redactHeaders(response?.headers),
        },
      };
      await logApi(entry);
    } catch {
      /* ignore logging failures */
    }
  },
});

/**
 * POST helper that returns a normalized result.
 * Note: browsers will not expose Set-Cookie response headers; server-side fetches may.
 */
export async function postJson(path: string, body: unknown) {
  try {
    const json = await api(path, {
      method: 'POST',
      body,
    } as any);
    return { ok: true, json, status: 200 };
  } catch (err: any) {
    // ofetch throws a FetchError that may include `.status` and `.data`
    const status = err?.status ?? err?.response?.status ?? 500;
    const data = err?.data ?? null;
    return { ok: false, json: data, status, error: err };
  }
}

/**
 * apiFetch - wrapper around native fetch that logs requests/responses to /api/frontend-logs via logApi.
 * Accepts the same params as window.fetch. Returns the original Response.
 */
export async function apiFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const start = Date.now();
  const method = (init?.method ?? 'GET').toString().toUpperCase();
  const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
  const reqHeaders = init?.headers ?? {};
  const bodyPreview = previewBodyMaybe(init?.body);

  try {
    const response = await fetch(input, init);
    // Only log when enabled; avoid heavy body reads for non-text/large payloads
    let respText = '';
    if (LOG_HTTP) {
      const ct = (response.headers.get('content-type') || '').toLowerCase();
      const lenHeader = response.headers.get('content-length');
      const len = lenHeader ? parseInt(lenHeader, 10) : NaN;
      const isTextual = ct.startsWith('application/json') || ct.startsWith('text/');
      const smallEnough = Number.isFinite(len) ? len <= 64 * 1024 : false; // only when length known and small
      if (isTextual && smallEnough) {
        try { respText = await response.clone().text(); } catch { respText = ''; }
      }
    }

    LOG_HTTP && (await logApi({
      phase: 'response',
      url,
      method,
      status: response.status,
      durationMs: Date.now() - start,
      request: {
        headers: redactHeaders(reqHeaders as any),
        bodyPreview: bodyPreview.preview,
        bodySize: bodyPreview.size,
      },
      response: {
        headers: redactHeaders(response.headers),
        bodyPreview: respText ? respText.slice(0, 1024) : undefined,
        bodySize: respText ? respText.length : undefined,
      },
    }));

    return response;
  } catch (err: any) {
    LOG_HTTP && (await logApi({
      phase: 'error',
      url,
      method,
      durationMs: Date.now() - start,
      request: {
        headers: redactHeaders(reqHeaders as any),
        bodyPreview: bodyPreview.preview,
        bodySize: bodyPreview.size,
      },
      message: String(err?.message ?? err),
    }));
    throw err;
  }
}
