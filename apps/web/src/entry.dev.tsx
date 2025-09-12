/*
 * WHAT IS THIS FILE?
 *
 * Development entry point using only client-side modules:
 * - Do not use this mode in production!
 * - No SSR
 * - No portion of the application is pre-rendered on the server.
 * - All of the application is running eagerly in the browser.
 * - More code is transferred to the browser than in SSR mode.
 * - Optimizer/Serialization/Deserialization code is not exercised!
 */
import { type RenderOptions, render } from "@builder.io/qwik";
import Root from "./root";

// Guard against duplicate renders on cold start/HMR quirks in dev client mode.
// Reuse a single render promise across accidental double invocations.
export default function (opts: RenderOptions) {
	const g = globalThis as unknown as {
		__qwik_render_promise?: Promise<unknown>;
	};
	if (g.__qwik_render_promise) return g.__qwik_render_promise as any;
	g.__qwik_render_promise = render(document, <Root />, opts);
	return g.__qwik_render_promise as any;
}
