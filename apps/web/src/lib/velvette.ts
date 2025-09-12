// Client-side initializer for Velvette view transitions
export async function initVelvette(): Promise<void> {
	if (typeof window === "undefined") return;
	const w = window as unknown as {
		__velvette_started?: boolean;
		__velvette_cleanup?: () => void;
		requestIdleCallback?: (cb: IdleRequestCallback) => number;
		cancelIdleCallback?: (id: number) => void;
	};
	if (w.__velvette_started) return;
	w.__velvette_started = true;
	try {
		const reduced = (() => {
			try {
				return (
					window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ===
					true
				);
			} catch {
				return false;
			}
		})();

		if (reduced) return; // honor reduced motion: no page transitions

		// Dynamically import to keep SSR clean
		const mod: any = await import("velvette").catch(() => null);
		if (!mod) return;

		// Try common export shapes
		const create = (mod?.default as any) || (mod?.velvette as any) || mod;
		if (typeof create !== "function") return;

		// Compute slide direction based on a logical route order
		const ORDER = [
			"/",
			"/about",
			"/contact",
			"/login",
			"/signup",
			"/profile",
			"/admin/users",
		] as const;
		const canon = (p: string) => {
			if (!p) return "/";
			if (p.startsWith("/login")) return "/login";
			if (p.startsWith("/signup")) return "/signup";
			if (p.startsWith("/profile")) return "/profile";
			if (p.startsWith("/admin/users")) return "/admin/users";
			if (p.startsWith("/about")) return "/about";
			if (p.startsWith("/contact")) return "/contact";
			return "/";
		};

		const getDir = (fromPath: string, toPath: string) => {
			const from = ORDER.indexOf(canon(fromPath));
			const to = ORDER.indexOf(canon(toPath));
			if (from === -1 || to === -1 || from === to) return "left" as const;
			return to > from ? ("right" as const) : ("left" as const);
		};

		// Initialize velvette with a slide effect; if API differs, fail silently.
		const root = document.documentElement;
		let firstNavSkipped = false;
		const vtHandler = (ev: any) => {
			try {
				Promise.resolve(ev?.detail?.finished)
					.catch(() => {})
					.finally(() => {
						try {
							root.removeAttribute("data-vt-nav");
							root.removeAttribute("data-vt-dir");
						} catch {}
					});
			} catch {}
		};
		document.addEventListener("qview-transition", vtHandler);

		const enable = () => {
			try {
				create?.({
					effect: "slide",
					onNavigate: (from: string, to: string) => {
						try {
							if (!firstNavSkipped) {
								firstNavSkipped = true;
								return;
							}
							const dir = getDir(from || window.location.pathname, to || "");
							root.setAttribute("data-vt-nav", "1");
							root.setAttribute("data-vt-dir", dir);
						} catch {}
					},
				});
			} catch {
				try {
					create?.();
				} catch {}
			}
		};

		const idle = w.requestIdleCallback;
		if (typeof idle === "function") idle(() => enable());
		else setTimeout(enable, 0);

		w.__velvette_cleanup = () => {
			try {
				document.removeEventListener("qview-transition", vtHandler);
			} catch {}
		};
		try {
			// @ts-expect-error
			if (import.meta.hot) {
				// @ts-expect-error
				import.meta.hot.dispose(() => {
					try {
						w.__velvette_cleanup?.();
					} catch {}
					w.__velvette_started = false;
				});
			}
		} catch {}
	} catch {
		/* ignore */
	}
}
