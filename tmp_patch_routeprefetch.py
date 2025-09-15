from pathlib import Path
path = Path("apps/web/src/components/RoutePrefetch.tsx")
text = path.read_text()
needle = "    const w = window as W;\r\n    let idleId: number | undefined;\r\n    let timeoutId: number | undefined;"
replacement = "    const w = window as W;\r\n    let idleId: number | undefined;\r\n    let timeoutId: number | undefined;\r\n    let controller: AbortController | null = null;"
if needle not in text:
    raise SystemExit('needle not found')
text = text.replace(needle, replacement, 1)
old = "        // Deduplicate and prefetch the q-data for each candidate when idle\r\n        const controller = new AbortController();\r\n\r\n        const prefetchOne = async (path: string) => {\r\n          // Build q-data URL\r\n          const url = `${path}/q-data.json`;\r\n          try {\r\n            const res = await fetch(url, {\r\n              // Same-origin credentials are fine for public q-data; cookies sent if present\r\n              credentials: \"same-origin\",\r\n              cache: \"force-cache\",\r\n              mode: \"same-origin\",\r\n              signal: controller.signal,\r\n            });\r\n            const ct = res.headers.get(\"content-type\") || \"\";\r\n            if (!res.ok || !/json/i.test(ct)) return;\r\n            // Touch the body minimally so it enters HTTP cache; ignore contents\r\n            // Avoid double reading elsewhere per AGENTS.md guidance\r\n            await res.text().catch(() => {});\r\n          } catch {\r\n            // Ignore network errors silently; this is a best-effort hint\r\n          }\r\n        };\r\n\r\n        // Soft limit: prefetch up to 5 routes to avoid over-fetching\r\n        const list = candidates.slice(0, 5);\r\n        await Promise.all(list.map(prefetchOne));\r\n\r\n        // Cleanup hook to abort if the component unmounts mid-prefetch\r\n        return () => controller.abort();"
new = "        // Deduplicate and prefetch the q-data for each candidate when idle\r\n        controller?.abort();\r\n        controller = new AbortController();\r\n        const signal = controller.signal;\r\n\r\n        const prefetchOne = async (path: string) => {\r\n          // Build q-data URL\r\n          const url = `${path}/q-data.json`;\r\n          try {\r\n            const res = await fetch(url, {\r\n              // Same-origin credentials are fine for public q-data; cookies sent if present\r\n              credentials: \"same-origin\",\r\n              cache: \"force-cache\",\r\n              mode: \"same-origin\",\r\n              signal,\r\n            });\r\n            const ct = res.headers.get(\"content-type\") || \"\";\r\n            if (!res.ok || !/json/i.test(ct)) return;\r\n            // Touch the body minimally so it enters HTTP cache; ignore contents\r\n            // Avoid double reading elsewhere per AGENTS.md guidance\r\n            await res.text().catch(() => {});\r\n          } catch {\r\n            // Ignore network errors silently; this is a best-effort hint\r\n          }\r\n        };\r\n\r\n        // Soft limit: prefetch up to 5 routes to avoid over-fetching\r\n        const list = candidates.slice(0, 5);\r\n        await Promise.all(list.map(prefetchOne));"
if old not in text:
    raise SystemExit('old block not found')
text = text.replace(old, new, 1)
cleanup_old = "      if (timeoutId !== undefined) clearTimeout(timeoutId);\r\n    };"
cleanup_new = "      if (timeoutId !== undefined) clearTimeout(timeoutId);\r\n      controller?.abort();\r\n    };"
if cleanup_old not in text:
    raise SystemExit('cleanup not found')
text = text.replace(cleanup_old, cleanup_new, 1)
path.write_text(text)
