import { qwikify$ } from "@builder.io/qwik-react";
import PreactCounter from "./preact/PreactCounter";

// Wrap the Preact (React-compatible) component as a Qwik island.
// Use a stricter eagerness in production to defer JS even more.
const islandEagerness = import.meta.env.DEV ? "visible" : ("hover" as const);
export const PreactCounterIsland = qwikify$(PreactCounter, {
  eagerness: islandEagerness,
  // Prevent SSR rendering of the Preact island during SSG
  clientOnly: true,
});
