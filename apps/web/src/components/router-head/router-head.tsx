import { component$ } from "@builder.io/qwik";
import { useDocumentHead, useLocation } from "@builder.io/qwik-city";

/**
 * The RouterHead component is placed inside of the document `<head>` element.
 */
export const RouterHead = component$(() => {
	const head = useDocumentHead();
	const loc = useLocation();

	// Drop any non-serializable or sentinel values from spread props to avoid
	// dev SSR warnings like "Symbol(skip render)". Allow only primitives.
	const sanitizeProps = (obj: Record<string, unknown> | undefined) => {
		try {
			if (!obj || typeof obj !== "object") return {} as Record<string, unknown>;
			const out: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(obj)) {
				if (
					v == null ||
					typeof v === "string" ||
					typeof v === "number" ||
					typeof v === "boolean"
				) {
					out[k] = v as string | number | boolean | null | undefined;
				}
			}
			return out;
		} catch {
			return {} as Record<string, unknown>;
		}
	};

	const safeKey = (k: unknown): string | undefined => {
		try {
			return typeof k === "string" || typeof k === "number" ? String(k) : undefined;
		} catch {
			return undefined;
		}
	};

	const hasSymbolValue = (obj: Record<string, unknown> | undefined) => {
		try {
			if (!obj || typeof obj !== "object") return false;
			for (const v of Object.values(obj)) {
				if (typeof v === "symbol") return true;
			}
		} catch {}
		return false;
	};

	// In dev, short-circuit to a minimal head to avoid any noisy SSR sentinel warnings from dynamic head entries.
	const dev = import.meta.env.DEV;
	if (dev) {
		const title = head.title && String(head.title).trim().length > 0 ? head.title : "Stack";
		return (
			<>
				<title>{title}</title>
				<link rel="canonical" href={loc.url.href} />
				<meta name="viewport" content="width=device-width, initial-scale=1.0" />
				<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
			</>
		);
	}

	const stylesSuspicious = head.styles.some((s) => hasSymbolValue(s.props as any) || typeof s.style !== 'string');

	return (
		<>
			{(() => {
				const title =
					head.title && String(head.title).trim().length > 0
						? head.title
						: "Stack";
				return <title>{title}</title>;
			})()}

			<link rel="canonical" href={loc.url.href} />
			<meta name="viewport" content="width=device-width, initial-scale=1.0" />
			<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
			{/* Theme color for light/dark — helps browser UI (address bar) match theme on first paint */}
			<meta
				name="theme-color"
				media="(prefers-color-scheme: light)"
				content="#ffffff"
			/>
			<meta
				name="theme-color"
				media="(prefers-color-scheme: dark)"
				content="#000000"
			/>

			{/* If we detect Google Fonts being loaded via head.links, preconnect to fonts.gstatic for faster font fetch.
          Also preload the Google Fonts stylesheet (Inter 400/700) and load it with the non-blocking onload trick.
          This improves font LCP while keeping a safe fallback. */}
			{(() => {
				const hasGoogleFonts = head.links.some((l) => {
					const href = (l as { href?: string }).href ?? "";
					return (
						href.includes("fonts.googleapis") || href.includes("fonts.gstatic")
					);
				});
				return hasGoogleFonts ? (
					<>
						<link
							rel="preconnect"
							href="https://fonts.gstatic.com"
							crossOrigin="anonymous"
						/>
						<link
							rel="preload"
							href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap"
							as="style"
						/>
                    <link
                        rel="stylesheet"
                        href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap"
                        media="all"
                        crossOrigin="anonymous"
                    />
						<noscript>
							<link
								rel="stylesheet"
								href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap"
							/>
						</noscript>
					</>
				) : null;
			})()}

			{/* styled-system styles are now bundled via global.css import */}

			{/* View transitions CSS removed */}

			{head.meta.map((m) => {
				const { key, ...rest } = m as unknown as { key?: unknown } & Record<string, unknown>;
				return <meta key={safeKey(key)} {...sanitizeProps(rest)} />;
			})}
			{(() => {
				const hasDescription = head.meta.some(
					(m) => (m as { name?: string }).name === "description",
				);
				return hasDescription ? null : (
					<meta
						name="description"
						content="Stack — modern web app experience with motion, performance, and delightful design."
					/>
				);
			})()}

			{head.links.map((l) => {
				const { key, ...rest } = l as unknown as { key?: unknown } & Record<string, unknown>;
				return <link key={safeKey(key)} {...sanitizeProps(rest)} />;
			})}

			{stylesSuspicious ? null : head.styles.map((s) => {
				if (process.env.NODE_ENV !== "production" && hasSymbolValue(s.props as any)) {
					console.warn("[router-head] style props contained a Symbol; dropping");
				}
				const hasDS = Boolean(s.props?.dangerouslySetInnerHTML);
				const dsValue = typeof s.style === "string" ? s.style : undefined;
				const extra = hasDS || dsValue === undefined ? {} : { dangerouslySetInnerHTML: dsValue };
				return <style key={safeKey(s.key)} {...sanitizeProps(s.props as any)} {...extra} />;
			})}

			{/* Avoid rendering head.scripts in SSR to prevent dev-only Symbol(skip render) warnings.
			   Qwik will inject required framework scripts automatically. */}
		</>
	);
});
