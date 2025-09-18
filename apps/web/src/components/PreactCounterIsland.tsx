import { qwikify$ } from "@builder.io/qwik-react";
import PreactCounter from "./preact/PreactCounter";

// Wrap the Preact (React-compatible) component as a Qwik island.
// In dev, prefer idle to reduce initial JS during Lighthouse runs; in prod, defer further.
const islandEagerness = import.meta.env.DEV ? "idle" : ("hover" as const);

// Allow SSR during local dev while still skipping it for the SSG build where the
// React/Preact renderer is tree-shaken out by default.
const disableSsrForStaticBuild =
	(globalThis as { process?: { env?: Record<string, string | undefined> } })
		.process?.env?.BUILD_TARGET === "ssg";

export const PreactCounterIsland = qwikify$(PreactCounter, {
	eagerness: islandEagerness,
	clientOnly: disableSsrForStaticBuild,
});
