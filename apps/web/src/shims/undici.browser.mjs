// Browser shim for 'undici' to prevent bundling Node-only polyfills.
// Provides minimal exports mapped to the browser fetch API.
export const fetch = (
	globalThis.fetch ||
	(() => {
		throw new Error("fetch not available");
	})
).bind(globalThis);
export const Headers = globalThis.Headers;
export const Request = globalThis.Request;
export const Response = globalThis.Response;
export default {};
