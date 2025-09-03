import { renderToString } from "solid-js/web";
import { Island } from "./Island";

export async function renderIslandSSR(): Promise<string> {
  // Server-side rendering only. Do not hydrate on the client.
  return renderToString(() => Island());
}
