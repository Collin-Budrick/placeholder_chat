/**
 * Frontend API logging helper
 *
 * - Sends compact, redacted log entries to the server endpoint /api/frontend-logs
 * - Redacts sensitive headers and body fields before shipping
 * - Non-blocking: failures are caught and logged to console only
 *
 * Usage:
 *  import { logApi } from './lib/log';
 *  await logApi({ ... });
 */

type HeadersMap = Record<string, string | undefined>;

export type LogEntry = {
  ts?: string;
  phase?: 'request' | 'response' | 'error';
  url: string;
  method?: string;
  status?: number;
  durationMs?: number;
  request?: {
    headers?: HeadersMap;
    query?: Record<string, string | undefined>;
    bodyPreview?: string;
    bodySize?: number;
  };
  response?: {
    headers?: HeadersMap;
    bodyPreview?: string;
    bodySize?: number;
  };
  client?: {
    userAgent?: string;
    path?: string;
  };
  session?: {
    hasGateway?: boolean;
  };
  env?: string;
  message?: string;
};

const SENSITIVE_HEADERS = ['authorization', 'cookie', 'set-cookie', 'x-api-key', 'x-auth-token'];
const SENSITIVE_BODY_KEYS = ['password', 'pwd', 'token', 'access_token', 'refresh_token', 'secret'];

/**
 * Redact headers: strip values for sensitive header keys and keep others.
 */
export function redactHeaders(h?: Headers | Record<string, string> | null): HeadersMap | undefined {
  if (!h) return undefined;
  const map: HeadersMap = {};
  if ((h as Headers).entries) {
    const headers = h as Headers;
    for (const [k, v] of headers.entries()) {
      if (SENSITIVE_HEADERS.includes(k.toLowerCase())) map[k] = '[REDACTED]';
      else map[k] = v;
    }
  } else {
    const obj = h as Record<string, string>;
    for (const k of Object.keys(obj)) {
      if (SENSITIVE_HEADERS.includes(k.toLowerCase())) map[k] = '[REDACTED]';
      else map[k] = obj[k];
    }
  }
  return map;
}

/**
 * Create a short preview of a JSON or text body, redacting sensitive fields.
 */
export function previewBodyMaybe(body: unknown): { preview: string; size: number } {
  if (body == null) return { preview: '', size: 0 };
  try {
    if (typeof body === 'string') {
      const txt = body;
      return { preview: txt.slice(0, 1024), size: txt.length };
    }
    // Try to stringify with redaction for known keys
    const cloned = JSON.parse(JSON.stringify(body, (_k, v) => {
      if (_k && SENSITIVE_BODY_KEYS.includes(String(_k).toLowerCase())) return '[REDACTED]';
      return v;
    }));
    const json = JSON.stringify(cloned);
    return { preview: json.slice(0, 1024), size: json.length };
  } catch (err) {
    try {
      const txt = String(body);
      return { preview: txt.slice(0, 1024), size: txt.length };
    } catch {
      return { preview: '', size: 0 };
    }
  }
}

/**
 * Send a log entry to the backend log collector.
 * Non-blocking; swallowing any errors to avoid impacting user flow.
 */
export async function logApi(entry: LogEntry): Promise<void> {
  try {
    // Populate timestamp and env if missing
    if (!entry.ts) entry.ts = new Date().toISOString();
    if (!entry.env) entry.env = (typeof process !== 'undefined' && (process.env.NODE_ENV ?? process.env?.AUTH_TRUST_HOST ? 'development' : 'production')) || 'development';

    // Lightweight client info if running in browser
    if (typeof navigator !== 'undefined') {
      entry.client = entry.client ?? {};
      entry.client.userAgent = navigator.userAgent;
    }

    // SSG-only: ship logs to the gateway via /api so Traefik can proxy them.
    await fetch('/api/frontend-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(entry),
    }).catch((e) => {
      // Non-blocking: log locally
      // eslint-disable-next-line no-console
      console.debug('[logApi] failed to send log', e);
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.debug('[logApi] unexpected error', err);
  }
}
