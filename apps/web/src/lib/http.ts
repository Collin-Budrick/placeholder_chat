import { ofetch } from "ofetch";
import { logApi, previewBodyMaybe, redactHeaders } from "./log";

// Helper: coerce HeadersInit to a shape accepted by redactHeaders
function toHeadersShape(
	h: HeadersInit | undefined | null,
): Record<string, string> | Headers | null {
	if (!h) return null;
	try {
		if (h instanceof Headers) return h as Headers;
	} catch {}
	if (Array.isArray(h)) {
		try {
			return Object.fromEntries(h as [string, string][]) as Record<
				string,
				string
			>;
		} catch {
			return {};
		}
	}
	return h as unknown as Record<string, string>;
}

// In browser, use same-origin relative path so Traefik/Vite dev proxy can route /api -> gateway.
// In SSR (Node, inside the web container), talk to the gateway service directly.
const isBrowser =
	typeof window !== "undefined" && typeof document !== "undefined";
let baseURL = "";
if (!isBrowser) {
	const env = ((
		import.meta as unknown as { env?: Record<string, string | undefined> }
	).env ?? {}) as Record<string, string | undefined>;
	const rawEnvBase =
		env.GATEWAY_URL ||
		(typeof process !== "undefined" ? (process.env?.GATEWAY_URL ?? "") : "");
	const inDocker =
		env.DOCKER_TRAEFIK === "1" ||
		(typeof process !== "undefined" && process.env?.DOCKER_TRAEFIK === "1");
	const fallback = inDocker ? "http://gateway:7000" : "http://127.0.0.1:7000";
	const raw = rawEnvBase || fallback;
	baseURL = raw.includes("localhost")
		? raw.replace("localhost", "127.0.0.1")
		: raw;
}

// Toggle lightweight HTTP logging. Enabled by default in dev, opt-in in prod via VITE_LOG_HTTP=1
const __env = ((import.meta as unknown as { env?: Record<string, unknown> })
	?.env || {}) as Record<string, unknown>;
const LOG_HTTP: boolean = Boolean(
	__env?.DEV === true ||
		__env?.VITE_LOG_HTTP === "1" ||
		(typeof process !== "undefined" &&
			(process.env?.VITE_LOG_HTTP === "1" || process.env?.LOG_HTTP === "1")),
);

export const api = ofetch.create({
	baseURL,
	headers: {
		Accept: "application/json",
	},
	async onResponseError(args: unknown) {
		if (!LOG_HTTP) return; // keep silent unless logging enabled
		try {
			// ofetch's handler shape can vary; be defensive with types.
			const ctx = args as unknown as {
				request?: unknown;
				response?: Response;
				options?: {
					url?: string;
					method?: string;
					headers?: HeadersInit;
					body?: unknown;
				};
			};
			const request = ctx?.request;
			const response = ctx?.response;
			const options = ctx?.options;
			// Resolve a best-effort URL string
			const url =
				(options as { url?: string })?.url ??
				(request &&
				typeof request === "object" &&
				request !== null &&
				"url" in (request as object)
					? (request as { url?: string }).url
					: typeof request === "string"
						? (request as string)
						: "");
			const method = (options?.method ?? "GET").toString();

			// Best-effort logging for ofetch response errors
			const entry = {
				phase: "error" as const,
				url: String(url ?? ""),
				method,
				status: response?.status,
				request: {
					headers: redactHeaders(toHeadersShape(options?.headers)),
					bodyPreview: options?.body
						? previewBodyMaybe(options.body).preview
						: undefined,
					bodySize: options?.body
						? previewBodyMaybe(options.body).size
						: undefined,
				},
				response: {
					headers: redactHeaders(response?.headers ?? null),
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
async function _postJson(path: string, body: unknown) {
	try {
		const json = await api(path, {
			method: "POST",
			body: body as unknown as Record<string, unknown>,
		});
		return { ok: true, json, status: 200 };
	} catch (err: unknown) {
		// ofetch throws a FetchError that may include `.status` and `.data`
		const e = err as {
			status?: number;
			response?: { status?: number };
			data?: unknown;
			message?: string;
		};
		const status = e?.status ?? e?.response?.status ?? 500;
		const data = e?.data ?? null;
		return { ok: false, json: data, status, error: err };
	}
}

/**
 * apiFetch - wrapper around native fetch that logs requests/responses to /api/frontend-logs via logApi.
 * Accepts the same params as window.fetch. Returns the original Response.
 */
export async function apiFetch(
	input: RequestInfo,
	init?: RequestInit,
): Promise<Response> {
	const start = Date.now();
	const method = (init?.method ?? "GET").toString().toUpperCase();
	const url =
		typeof input === "string"
			? input
			: input instanceof Request
				? input.url
				: String(input);
	const reqHeaders = init?.headers ?? {};
	const bodyPreview = previewBodyMaybe(init?.body);

	try {
		const response = await fetch(input, init);
		// Only log when enabled; avoid heavy body reads for non-text/large payloads
		let respText = "";
		if (LOG_HTTP) {
			const ct = (response.headers.get("content-type") || "").toLowerCase();
			const lenHeader = response.headers.get("content-length");
			const len = lenHeader ? parseInt(lenHeader, 10) : NaN;
			const isTextual =
				ct.startsWith("application/json") || ct.startsWith("text/");
			const smallEnough = Number.isFinite(len) ? len <= 64 * 1024 : false; // only when length known and small
			if (isTextual && smallEnough) {
				try {
					respText = await response.clone().text();
				} catch {
					respText = "";
				}
			}
		}

		LOG_HTTP &&
			(await logApi({
				phase: "response",
				url,
				method,
				status: response.status,
				durationMs: Date.now() - start,
				request: {
					headers: redactHeaders(toHeadersShape(reqHeaders as HeadersInit)),
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
	} catch (err: unknown) {
		LOG_HTTP &&
			(await logApi({
				phase: "error",
				url,
				method,
				durationMs: Date.now() - start,
				request: {
					headers: redactHeaders(toHeadersShape(reqHeaders as HeadersInit)),
					bodyPreview: bodyPreview.preview,
					bodySize: bodyPreview.size,
				},
				message: String((err as { message?: string })?.message ?? err),
			}));
		throw err;
	}
}

// Lightweight JSON POST wrapper using the shared ofetch instance.
export async function postJson(
  path: string,
  body: unknown,
  opts?: { headers?: HeadersInit },
): Promise<unknown> {
  return api(path, {
    method: 'POST',
    body: body as Record<string, unknown>,
    headers: opts?.headers,
  });
}
