import { qwikify$ } from "@builder.io/qwik-react";
import PreactCounter from "./preact/PreactCounter";

// Wrap the Preact (React-compatible) component as a Qwik island.
// In dev, prefer idle to reduce initial JS during Lighthouse runs; in prod, defer further.
const islandEagerness = import.meta.env.DEV ? "idle" : ("hover" as const);
export const PreactCounterIsland = qwikify$(PreactCounter, {
  eagerness: islandEagerness,
  // Prevent SSR rendering of the Preact island during SSG
  clientOnly: true,
});
