// Client-side initializer for Velvette view transitions
export async function initVelvette(): Promise<void> {
	if (typeof window === "undefined") return;
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
		try {
			// Common API shape: create({ effect, onNavigate })
			const root = document.documentElement;
			// Clean-up when Qwik finishes a view transition (Qwik City emits this custom event)
			const onVTDone = () => {
				try {
					root.removeAttribute("data-vt-nav");
					root.removeAttribute("data-vt-dir");
					root.removeAttribute("data-vt-effect");
				} catch {}
			};
			document.addEventListener("qview-transition", (ev: any) => {
				try {
					Promise.resolve(ev?.detail?.finished).finally(onVTDone);
				} catch {
					onVTDone();
				}
			});

			create?.({
				effect: "slide",
				// Many libs provide a navigation hook; be defensive and support both
				onNavigate: (from: string, to: string) => {
					try {
						const dir = getDir(from || window.location.pathname, to || "");
						root.setAttribute("data-vt-nav", "1");
						root.setAttribute("data-vt-dir", dir);
					} catch {}
				},
			});
		} catch {
			// Fallback: attempt simple call without options
			try {
				create?.();
			} catch {}
		}
	} catch {
		/* ignore */
	}
}
