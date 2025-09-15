import { readFileSync, writeFileSync } from "node:fs";
const path = "apps/web/src/components/RoutePrefetch.tsx";
let text = readFileSync(path, "utf8");
const needle = "    const w = window as W;\r\n    let idleId: number | undefined;\r\n    let timeoutId: number | undefined;";
const replacement = "    const w = window as W;\r\n    let idleId: number | undefined;\r\n    let timeoutId: number | undefined;\r\n    let controller: AbortController | null = null;";
if (!text.includes(needle)) {
  throw new Error('needle not found');
}
text = text.replace(needle, replacement);
const oldBlock = "        // Deduplicate and prefetch the q-data for each candidate when idle\r\n        const controller = new AbortController();\r\n\r\n        const prefetchOne = async (path: string) => {\r\n          // Build q-data URL\r\n          const url = `${path}/q-data.json`;\r\n          try {\r\n            const res = await fetch(url, {\r\n              // Same-origin credentials are fine for public q-data; cookies sent if present\r\n              credentials: \"same-origin\",\r\n              cache: \"force-cache\",\r\n              mode: \"same-origin\",\r\n              signal: controller.signal,\r\n            });\r\n            const ct = res.headers.get(\"content-type\") || \"\";\r\n            if (!res.ok || !/json/i.test(ct)) return;\r\n            // Touch the body minimally so it enters HTTP cache; ignore contents\r\n            // Avoid double reading elsewhere per AGENTS.md guidance\r\n            await res.text().catch(() => {});\r\n          } catch {\r\n            // Ignore network errors silently; this is a best-effort hint\r\n          }\r\n        };\r\n\r\n        // Soft limit: prefetch up to 5 routes to avoid over-fetching\r\n        const list = candidates.slice(0, 5);\r\n        await Promise.all(list.map(prefetchOne));\r\n\r\n        // Cleanup hook to abort if the component unmounts mid-prefetch\r\n        return () => controller.abort();";
const newBlock = "        // Deduplicate and prefetch the q-data for each candidate when idle\r\n        controller?.abort();\r\n        controller = new AbortController();\r\n        const signal = controller.signal;\r\n\r\n        const prefetchOne = async (path: string) => {\r\n          // Build q-data URL\r\n          const url = `${path}/q-data.json`;\r\n          try {\r\n            const res = await fetch(url, {\r\n              // Same-origin credentials are fine for public q-data; cookies sent if present\r\n              credentials: \"same-origin\",\r\n              cache: \"force-cache\",\r\n              mode: \"same-origin\",\r\n              signal,\r\n            });\r\n            const ct = res.headers.get(\"content-type\") || \"\";\r\n            if (!res.ok || !/json/i.test(ct)) return;\r\n            // Touch the body minimally so it enters HTTP cache; ignore contents\r\n            // Avoid double reading elsewhere per AGENTS.md guidance\r\n            await res.text().catch(() => {});\r\n          } catch {\r\n            // Ignore network errors silently; this is a best-effort hint\r\n          }\r\n        };\r\n\r\n        // Soft limit: prefetch up to 5 routes to avoid over-fetching\r\n        const list = candidates.slice(0, 5);\r\n        await Promise.all(list.map(prefetchOne));";
if (!text.includes(oldBlock)) {
  throw new Error('old block not found');
}
text = text.replace(oldBlock, newBlock);
const cleanupOld = "      if (timeoutId !== undefined) clearTimeout(timeoutId);\r\n    };";
const cleanupNew = "      if (timeoutId !== undefined) clearTimeout(timeoutId);\r\n      controller?.abort();\r\n    };";
if (!text.includes(cleanupOld)) {
  throw new Error('cleanup block not found');
}
text = text.replace(cleanupOld, cleanupNew);
writeFileSync(path, text);
