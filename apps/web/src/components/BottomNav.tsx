import {
	$,
	component$,
	useOnDocument,
	useOnWindow,
	useSignal,
	useTask$,
} from "@builder.io/qwik";
import { Link, useLocation, useNavigate } from "@builder.io/qwik-city";
import { LuHome, LuInfo, LuMail, LuUser } from "@qwikest/icons/lucide";
import { LanguageToggle } from "~/components/LanguageToggle";
// ThemeToggle import temporarily disabled for SSG symbol debug
import ThemeToggle from "~/components/ThemeToggle";
import { logApi } from "~/lib/log";

// Canonical route mapping and order used to decide slide direction.
// Placed at module scope so it is serializable in Qwik event closures.
const ORDER = [
	"/",
	"/about",
	"/contact",
	"/login",
	"/signup",
	"/profile",
] as const;
const canon = (p: string): (typeof ORDER)[number] => {
	if (!p) return "/";
	// Normalize trailing slash (except root)
	let path = p;
	try {
		path = String(p);
	} catch {
		/* ignore */
	}
	if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
	if (path.startsWith("/login")) return "/login";
	if (path.startsWith("/signup")) return "/signup";
	if (path.startsWith("/profile")) return "/profile";
	if (path.startsWith("/about")) return "/about";
	if (path.startsWith("/contact")) return "/contact";
	return "/";
};

export default component$(() => {
	const loc = useLocation();
	const nav = useNavigate();
	// Avoid importing the auth plugin on the client to prevent AsyncLocalStorage warnings
	// and potential client-bundle issues on pages like /signup before any login occurs.

	const isActive = (path: string | ((p: string) => boolean)) => {
		const p = typeof path === "string" ? path : undefined;
		const fn = typeof path === "function" ? path : undefined;
		return fn
			? fn(loc.url.pathname)
			: loc.url.pathname === p || loc.url.pathname.startsWith(`${p}/`);
	};

	// Signals for the sliding selector
	const selectorRef = useSignal<HTMLElement | null>(null);
	const ulRef = useSignal<HTMLElement | null>(null);
	const prevIndex = useSignal<number>(-1);
	const warmed = useSignal<boolean>(false);
	const navBusy = useSignal<boolean>(false);
	// Defer background warmups until the user interacts (reduces unused JS on first paint)
	const interacted = useSignal<boolean>(false);
	useOnDocument(
		"pointerdown",
		$(() => {
			interacted.value = true;
		}),
	);
	useOnDocument(
		"keydown",
		$(() => {
			interacted.value = true;
		}),
	);
	useOnDocument(
		"touchstart",
		$(() => {
			interacted.value = true;
		}),
	);

	// Prefetch route data (and trigger Qwik's internal preloads) to smooth the very first nav
	const prefetchRoute = $((path: string) => {
		try {
			const url = new URL(path, loc.url.href);
			// Ensure trailing slash (except root) for q-data URL shape
			const p =
				url.pathname === "/"
					? "/"
					: url.pathname.endsWith("/")
						? url.pathname
						: `${url.pathname}/`;
			const q = `${p}q-data.json`;
			// Low-priority warmup
			fetch(q, { credentials: "same-origin" }).catch(() => {});
		} catch {
			/* ignore */
		}
	});

	// Warm auth routes in the background for instant nav from public pages
	useTask$(() => {
		if (typeof window === "undefined") return;
		// Gate idle warmup until user interacts once
		const i = interacted.value; // track signal
		if (!i) return;
		const p = loc.url.pathname || "/";
		// Only warm from public, light pages
		if (p.startsWith("/login") || p.startsWith("/signup")) return;
		type W = typeof window & {
			requestIdleCallback?: (cb: IdleRequestCallback) => number;
		};
		const w = window as W;
		const idle: (cb: IdleRequestCallback) => number =
			typeof w.requestIdleCallback === "function"
				? (cb) => w.requestIdleCallback?.(cb as IdleRequestCallback) as number
				: (cb) =>
						window.setTimeout(
							() =>
								cb({
									didTimeout: false,
									timeRemaining: () => 0,
								} as IdleDeadline),
							250,
						);
		idle(() => {
			try {
				prefetchRoute("/login");
			} catch {}
			try {
				prefetchRoute("/signup");
			} catch {}
		});
	});

	// Idle module-preload for auth routes: fetch route chunks ahead of time
	useTask$(() => {
		if (typeof window === "undefined") return;
		// Gate idle warmup until user interacts once
		const i = interacted.value; // track signal
		if (!i) return;
		const p = loc.url.pathname || "/";
		if (p.startsWith("/login") || p.startsWith("/signup")) return;
		type NetworkInformation = { effectiveType?: string; saveData?: boolean };
		const navConn = navigator as Navigator & {
			connection?: NetworkInformation;
			mozConnection?: NetworkInformation;
			webkitConnection?: NetworkInformation;
		};
		const conn: NetworkInformation | undefined =
			navConn?.connection ||
			navConn?.mozConnection ||
			navConn?.webkitConnection;
		if (conn?.saveData) return; // respect Data Saver
		const slow =
			typeof conn?.effectiveType === "string" &&
			/^(slow-2g|2g)$/.test(conn.effectiveType);
		if (slow) return;
		type W2 = typeof window & {
			requestIdleCallback?: (cb: IdleRequestCallback) => number;
		};
		const w2 = window as W2;
		const idle: (cb: IdleRequestCallback) => number =
			typeof w2.requestIdleCallback === "function"
				? (cb) => w2.requestIdleCallback?.(cb as IdleRequestCallback) as number
				: (cb) =>
						window.setTimeout(
							() =>
								cb({
									didTimeout: false,
									timeRemaining: () => 0,
								} as IdleDeadline),
							400,
						);
		idle(async () => {
			try {
				await import("~/routes/login/index");
			} catch {}
			try {
				await import("~/routes/signup/index");
			} catch {}
		});
	});

	// Pointer-down handler: animate selector immediately on user tap/click
	const onPointerDown = $((index: number) => {
		const ul = ulRef.value;
		const sel = selectorRef.value;
		if (!ul || !sel) {
			prevIndex.value = index;
			return;
		}

		const items = Array.from(ul.querySelectorAll<HTMLElement>(".nav-item"));
		if (index < 0 || index >= items.length) {
			prevIndex.value = index;
			return;
		}

		const ulRect = ul.getBoundingClientRect();
		const actRect = items[index].getBoundingClientRect();
		const left = Math.round(actRect.left - ulRect.left);
		const width = Math.round(actRect.width);

		// Do not touch global VT flags; NavViewTransitions controls direction

		// Apply width immediately and position the selector with a small lead (directional bias)
		sel.style.width = `${width}px`;
		const lead = 6; // pixels to lead the animation visually
		// compute previous left; fallback to target left if not available
		const selRect = sel.getBoundingClientRect();
		const prevLeft = selRect.left
			? Math.round(selRect.left - ulRect.left)
			: left;
		const startLeft =
			prevLeft === undefined || prevLeft === null || prevIndex.value === -1
				? left
				: index > prevIndex.value
					? prevLeft + lead
					: prevLeft - lead;

		// set starting transform, make visible, then animate to target
		sel.style.transform = `translateX(${startLeft}px) translateY(-50%)`;
		sel.style.opacity = "1";

		requestAnimationFrame(() => {
			sel.style.transform = `translateX(${left}px) translateY(-50%)`;
		});

		// update prevIndex so subsequent clicks compute direction
		prevIndex.value = index;

		// Also compute nav direction and set flags for VT CSS (Qwik auto-VT will use them)
		try {
			// Map current path to one of ORDER entries, and compare to target index
			const cur = canon(loc.url.pathname || "/");
			const curIdx = ORDER.indexOf(cur);
			if (curIdx >= 0 && index !== curIdx) {
				const dir = index > curIdx ? ("right" as const) : ("left" as const);
				const root = document.documentElement;
				root.setAttribute("data-vt-nav", "1");
				root.setAttribute("data-vt-dir", dir);
			}
		} catch {
			/* ignore */
		}

		// Kick off prefetch for the intended route to improve first-click smoothness
		try {
			const targets: string[] = [
				"/",
				"/about",
				"/contact",
				"/login",
				"/signup",
			];
			const t = targets[index];
			if (t) prefetchRoute(t);
		} catch {
			/* ignore */
		}
	});

	// No manual VT on click: rely on Qwik auto-VT
	const onAccountClick = $(async () => {
		try {
			// Direction is set on pointerdown by onPointerDown/VTGlobal

			// Fast-path: if we're already on an auth page, don't ping the backend
			const path = (globalThis?.location?.pathname || "").toLowerCase();
			if (path.startsWith("/login") || path.startsWith("/signup")) {
				const docA = document as Document & {
					startViewTransition?: (cb: () => void) => {
						finished?: Promise<unknown>;
					};
				};
				const startVT = docA.startViewTransition;
				if (typeof startVT === "function") {
					try {
						const root = document.documentElement;
						const current = canon(loc.url.pathname || "/");
						const fromIdx = ORDER.indexOf(current);
						const toIdx = ORDER.indexOf("/login");
						root.setAttribute("data-vt-nav", "1");
						root.setAttribute(
							"data-vt-dir",
							toIdx > fromIdx ? "right" : "left",
						);
						root.setAttribute("data-vt-target", "login");
					} catch {
						/* ignore */
					}
					const tx = startVT(async () => {
						try {
							await nav("/login");
						} catch {
							/* ignore */
						}
					});
					Promise.resolve(tx?.finished).finally(() => {
						try {
							const root = document.documentElement;
							root.removeAttribute("data-vt-nav");
							root.removeAttribute("data-vt-dir");
							root.removeAttribute("data-vt-effect");
							root.removeAttribute("data-vt-target");
						} catch {
							/* ignore */
						}
					});
				} else {
					await nav("/login");
				}
				return;
			}

			// If there is clearly no session cookie, avoid a backend probe to prevent a 401 log
			let hasSession = false;
			try {
				const ck = String(document?.cookie || "");
				hasSession = /(?:^|;\s*)(session|session_token)=/.test(ck);
			} catch {
				/* ignore */
			}
			if (!hasSession) {
				const doc = document as Document & {
					startViewTransition?: (cb: () => void) => {
						finished?: Promise<unknown>;
					};
				};
				const startVT = doc.startViewTransition;
				if (typeof startVT === "function") {
					try {
						const root = document.documentElement;
						const current = canon(loc.url.pathname || "/");
						const fromIdx = ORDER.indexOf(current);
						const toIdx = ORDER.indexOf("/login");
						root.setAttribute("data-vt-nav", "1");
						root.setAttribute(
							"data-vt-dir",
							toIdx > fromIdx ? "right" : "left",
						);
						root.setAttribute("data-vt-target", "login");
					} catch {
						/* ignore */
					}
					const tx = startVT(async () => {
						try {
							await nav("/login");
						} catch {
							/* ignore */
						}
					});
					Promise.resolve(tx?.finished).finally(() => {
						try {
							const root = document.documentElement;
							root.removeAttribute("data-vt-nav");
							root.removeAttribute("data-vt-dir");
							root.removeAttribute("data-vt-effect");
							root.removeAttribute("data-vt-target");
						} catch {
							/* ignore */
						}
					});
				} else {
					await nav("/login");
				}
				return;
			}

			// Otherwise, ask the gateway if we have a session cookie
			let goProfile = false;
			try {
				const gw = await fetch("/api/auth/me", {
					credentials: "same-origin",
					cache: "no-store",
					headers: { Accept: "application/json" },
				});
				goProfile = gw.ok;
			} catch {
				/* ignore; treat as not logged in */
			}
			try {
				await logApi({
					phase: "request",
					url: goProfile ? "/profile" : "/login",
					message: "nav: account click",
				});
			} catch {}

			const to = goProfile ? "/profile" : "/login";
			const doc = document as Document & {
				startViewTransition?: (cb: () => void) => {
					finished?: Promise<unknown>;
				};
			};
			const startVT = doc.startViewTransition;
			if (typeof startVT === "function") {
				try {
					const root = document.documentElement;
					const targetCanon = canon(to);
					const name =
						targetCanon === "/" ? "home" : targetCanon.replace(/^\//, "");
					const current = canon(loc.url.pathname || "/");
					const fromIdx = ORDER.indexOf(current);
					const toIdx = ORDER.indexOf(targetCanon);
					root.setAttribute("data-vt-nav", "1");
					root.setAttribute("data-vt-dir", toIdx > fromIdx ? "right" : "left");
					root.setAttribute("data-vt-target", name);
				} catch {
					/* ignore */
				}
				const tx = startVT(async () => {
					try {
						await nav(to);
					} catch {
						/* ignore */
					}
				});
				Promise.resolve(tx?.finished).finally(() => {
					try {
						const root = document.documentElement;
						root.removeAttribute("data-vt-nav");
						root.removeAttribute("data-vt-dir");
						root.removeAttribute("data-vt-effect");
						root.removeAttribute("data-vt-target");
					} catch {
						/* ignore */
					}
				});
			} else {
				await nav(to);
			}
		} catch {
			await nav("/login");
		}
	});

	// Position the selector under the active nav item and animate on route/resize
	const update = $(() => {
		const ul = ulRef.value;
		const sel = selectorRef.value;
		if (!ul || !sel) return;

		// Consider only real page anchors (href starting with '/') as nav items
		const anchors = Array.from(
			ul.querySelectorAll<HTMLAnchorElement>('a.nav-link[href^="/"]'),
		);
		if (anchors.length === 0) {
			sel.style.opacity = "0";
			sel.style.width = "0";
			return;
		}

		// Choose the anchor with the best path match (longest matching base or alias)
		const pathname = loc.url.pathname || "/";
		let bestIdx = -1;
		let bestScore = -1;
		const normalize = (p: string) =>
			p.endsWith("/") && p !== "/" ? p.slice(0, -1) : p;
		const cur = normalize(pathname);

		anchors.forEach((a, i) => {
			const href = a.getAttribute("href") || "/";
			let base = "/";
			try {
				base = normalize(new URL(href, loc.url.href).pathname || "/");
			} catch {
				base = href;
			}
			const aliasAttr = a.getAttribute("data-alias") || "";
			const aliases = aliasAttr
				.split(",")
				.map((s) => normalize(s.trim()))
				.filter(Boolean);

			const candidates = [base, ...aliases];
			for (const cand of candidates) {
				if (cand === "/") {
					if (cur === "/") {
						if (bestScore < 1) {
							bestScore = 1;
							bestIdx = i;
						}
					}
				} else if (cur === cand || cur.startsWith(`${cand}/`)) {
					const score = cand.length; // prefer longest/specific match
					if (score > bestScore) {
						bestScore = score;
						bestIdx = i;
					}
				}
			}
		});

		if (bestIdx === -1) {
			sel.style.opacity = "0";
			sel.style.width = "0";
			return;
		}

		const activeAnchor = anchors[bestIdx];
		const active =
			activeAnchor.closest<HTMLElement>(".nav-item") ||
			(activeAnchor as unknown as HTMLElement);
		const ulRect = ul.getBoundingClientRect();
		const actRect = active.getBoundingClientRect();
		const left = actRect.left - ulRect.left;
		const width = actRect.width;

		// Apply width immediately (no width transition) then set transform; rely on CSS transitions for smoothing.
		sel.style.width = `${Math.round(width)}px`;

		// Use requestAnimationFrame to ensure transform transition picks up the change cleanly.
		const raf: (cb: FrameRequestCallback) => number =
			typeof window !== "undefined" &&
			typeof window.requestAnimationFrame === "function"
				? window.requestAnimationFrame.bind(window)
				: (fn) => window.setTimeout(() => fn(0), 0);
		raf(() => {
			sel.style.transform = `translateX(${Math.round(left)}px) translateY(-50%)`;
			sel.style.opacity = "1";
		});

		// external blur overlay removed per request
	});

	// Manual navigation with View Transitions for bottom-nav links
	const navigateWithVT = $((index: number, toHref: string) => {
		try {
			// Respect reduced motion: skip VT
			try {
				if (
					globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches
				) {
					void nav(toHref);
					navBusy.value = false;
					return;
				}
			} catch {
				/* ignore */
			}
			const root = document.documentElement;
			const current = canon(loc.url.pathname || "/");
			const fromIdx = ORDER.indexOf(current);
			const dir =
				fromIdx >= 0 && index !== fromIdx
					? index > fromIdx
						? "right"
						: "left"
					: undefined;
			if (dir) {
				root.setAttribute("data-vt-nav", "1");
				root.setAttribute("data-vt-dir", dir);
			}
			// Hint target for CSS smoothing (e.g., login)
			try {
				const targetCanon = canon(toHref);
				const name =
					targetCanon === "/" ? "home" : targetCanon.replace(/^\//, "");
				root.setAttribute("data-vt-target", name);
			} catch {
				/* ignore */
			}
			const doc = document as Document & {
				startViewTransition?: (cb: () => void) => {
					finished?: Promise<unknown>;
				};
			};
			const startVT = doc.startViewTransition;
			if (typeof startVT === "function") {
				const tx = startVT(async () => {
					try {
						await nav(toHref);
					} catch {
						/* ignore */
					}
				});
				// Clean flags when done, and release busy state
				Promise.resolve(tx?.finished || Promise.resolve()).finally(() => {
					try {
						root.removeAttribute("data-vt-nav");
						root.removeAttribute("data-vt-dir");
						root.removeAttribute("data-vt-effect");
						root.removeAttribute("data-vt-target");
					} catch {
						/* ignore */
					}
					navBusy.value = false;
				});
			} else {
				// Fallback without VT
				void nav(toHref);
				navBusy.value = false;
			}
		} catch {
			try {
				void nav(toHref);
			} catch {
				/* ignore */
			}
			navBusy.value = false;
		}
	});

	// Combined pointerdown handler: animate selector + start VT nav on primary, unmodified clicks
	const onNavPointerDown = $(
		(
			ev: PointerEvent,
			_el: HTMLAnchorElement,
			index: number,
			toHref: string,
		) => {
			try {
				onPointerDown(index);
			} catch {
				/* ignore */
			}
			try {
				// Only left-button, no modifier keys
				const me = ev as MouseEvent;
				if (
					me.button !== 0 ||
					me.metaKey ||
					me.ctrlKey ||
					me.shiftKey ||
					me.altKey
				)
					return;
			} catch {
				/* ignore */
			}
			if (navBusy.value) return;
			navBusy.value = true;
			try {
				navigateWithVT(index, toHref);
			} catch {
				navBusy.value = false;
			}
		},
	);

	// Keyboard activation handler for accessibility: Enter/Space triggers VT nav
	const onNavKeyDown = $(
		(
			ev: KeyboardEvent,
			_el: HTMLAnchorElement,
			index: number,
			toHref: string,
		) => {
			try {
				const e = ev as KeyboardEvent;
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					if (navBusy.value) return;
					navBusy.value = true;
					navigateWithVT(index, toHref);
				}
			} catch {
				/* ignore */
			}
		},
	);

	// Initial placement: schedule update now and also when the document becomes ready.
	// Always register the document listener (must be called unconditionally).
	useOnDocument(
		"DOMContentLoaded",
		$(() => {
			const raf: (cb: FrameRequestCallback) => number =
				typeof window !== "undefined" &&
				typeof window.requestAnimationFrame === "function"
					? window.requestAnimationFrame.bind(window)
					: (fn) => window.setTimeout(() => fn(0), 0);
			raf(() => update());
			// Warm common routes once on first paint
			if (!warmed.value) {
				warmed.value = true;
				const run = () => {
					try {
						prefetchRoute("/");
						prefetchRoute("/about");
						prefetchRoute("/contact");
						prefetchRoute("/login");
						prefetchRoute("/signup");
					} catch {
						/* ignore */
					}
				};
				try {
					type W = typeof window & {
						requestIdleCallback?: (
							cb: IdleRequestCallback,
							opts?: { timeout?: number },
						) => number;
					};
					const w = window as W;
					if (typeof w.requestIdleCallback === "function") {
						w.requestIdleCallback(run, { timeout: 1500 });
					} else {
						setTimeout(run, 300);
					}
				} catch {
					setTimeout(run, 300);
				}
			}
		}),
	);

	// React to route/path changes to keep selector accurate
	useTask$(({ track }) => {
		track(() => loc.url.pathname);
		if (typeof window === "undefined") return;
		const raf: (cb: FrameRequestCallback) => number =
			typeof window !== "undefined" &&
			typeof window.requestAnimationFrame === "function"
				? window.requestAnimationFrame.bind(window)
				: (fn) =>
						window.setTimeout(() => fn(0 as unknown as DOMHighResTimeStamp), 0);
		raf(() => update());
	});

	// Update on window resize
	useOnWindow(
		"resize",
		$(() => {
			const raf: (cb: FrameRequestCallback) => number =
				typeof window !== "undefined" &&
				typeof window.requestAnimationFrame === "function"
					? window.requestAnimationFrame.bind(window)
					: (fn) =>
							window.setTimeout(
								() => fn(0 as unknown as DOMHighResTimeStamp),
								0,
							);
			raf(() => update());
		}),
	);

	// Remove pre-hydration VT pointerdown flags — no longer needed

	// Remove previous document-level click fallback

	const hideAuth =
		loc.url.pathname.startsWith("/login") ||
		loc.url.pathname.startsWith("/signup");
	return (
		<nav class={`bottom-nav ${hideAuth ? "is-hidden" : ""}`}>
			<div class="w-full flex justify-center pb-safe">
				<div class="mx-2 my-2 rounded-box backdrop-blur shadow-lg bottom-nav-surface">
					<ul
						ref={(el) => {
							ulRef.value = el;
						}}
						class="px-2 items-center gap-1 w-full flex justify-center"
					>
						{/* sliding selector element as list item for a11y correctness */}
						<li
							role="presentation"
							aria-hidden="true"
							class="pointer-events-none"
						>
							<div
								ref={(el) => {
									selectorRef.value = el;
								}}
								class="bottom-nav-selector"
							/>
						</li>
						<li>
							<Link
								href="/"
								prefetch
								preventdefault:click
								aria-current={isActive("/") ? "page" : undefined}
								aria-disabled={isActive("/") ? "true" : undefined}
								tabIndex={isActive("/") ? -1 : undefined}
								class={`nav-item nav-link ${isActive("/") ? "is-active" : ""}`}
								onPointerDown$={$((ev, el) => onNavPointerDown(ev, el, 0, "/"))}
								onKeyDown$={$((ev, el) => onNavKeyDown(ev, el, 0, "/"))}
								onClick$={$((e) => {
									e.preventDefault();
								})}
								aria-label="Home"
							>
								<LuHome class="w-7 h-7" />
							</Link>
						</li>
						<li>
							<Link
								href="/about"
								prefetch
								preventdefault:click
								aria-current={isActive("/about") ? "page" : undefined}
								aria-disabled={isActive("/about") ? "true" : undefined}
								tabIndex={isActive("/about") ? -1 : undefined}
								class={`nav-item nav-link ${isActive("/about") ? "is-active" : ""}`}
								onPointerDown$={$((ev, el) =>
									onNavPointerDown(ev, el, 1, "/about/"),
								)}
								onKeyDown$={$((ev, el) => onNavKeyDown(ev, el, 1, "/about/"))}
								onClick$={$((e) => {
									e.preventDefault();
								})}
								aria-label="About"
							>
								<LuInfo class="w-7 h-7" />
							</Link>
						</li>
						<li>
							<Link
								href="/contact"
								prefetch
								preventdefault:click
								aria-current={isActive("/contact") ? "page" : undefined}
								aria-disabled={isActive("/contact") ? "true" : undefined}
								tabIndex={isActive("/contact") ? -1 : undefined}
								class={`nav-item nav-link ${isActive("/contact") ? "is-active" : ""}`}
								onPointerDown$={$((ev, el) =>
									onNavPointerDown(ev, el, 2, "/contact/"),
								)}
								onKeyDown$={$((ev, el) => onNavKeyDown(ev, el, 2, "/contact/"))}
								onClick$={$((e) => {
									e.preventDefault();
								})}
								aria-label="Contact"
							>
								<LuMail class="w-7 h-7" />
							</Link>
						</li>
						<li>
							<Link
								href={"/login"}
								prefetch
								preventdefault:click
								aria-current={
									isActive(
										(p) =>
											p.startsWith("/profile") ||
											p.startsWith("/signup") ||
											p.startsWith("/login"),
									)
										? "page"
										: undefined
								}
								aria-disabled={
									isActive(
										(p) =>
											p.startsWith("/profile") ||
											p.startsWith("/signup") ||
											p.startsWith("/login"),
									)
										? "true"
										: undefined
								}
								tabIndex={
									isActive(
										(p) =>
											p.startsWith("/profile") ||
											p.startsWith("/signup") ||
											p.startsWith("/login"),
									)
										? -1
										: undefined
								}
								class={`nav-item nav-link ${isActive((p) => p.startsWith("/profile") || p.startsWith("/signup") || p.startsWith("/login")) ? "is-active" : ""}`}
								data-alias="/login,/signup"
								onPointerDown$={() => onPointerDown(3)}
								onKeyDown$={$((e: KeyboardEvent) => {
									if (e.key === "Enter" || e.key === " ") {
										e.preventDefault();
										onAccountClick();
									}
								})}
								onClick$={onAccountClick}
								aria-label="Account"
							>
								<LuUser class="w-7 h-7" />
							</Link>
						</li>
						<li class="nav-sep" aria-hidden="true" />
						<li>
							<LanguageToggle
								class="nav-item nav-link grid place-items-center"
								iconClass="w-7 h-7"
							/>
						</li>
						<li>
							<ThemeToggle
								class="nav-item nav-link grid place-items-center theme-toggle"
								iconClass="w-7 h-7"
							/>
						</li>
					</ul>
				</div>
			</div>
		</nav>
	);
});
