import {
	$,
	component$,
	useOnWindow,
	useSignal,
	useTask$,
} from "@builder.io/qwik";
import { Link, useLocation } from "@builder.io/qwik-city";
import { LuHome, LuInfo, LuMail, LuUser } from "@qwikest/icons/lucide";
import ThemeToggle from "~/components/ThemeToggle";

/**
 * GlassNavBar — DaisyUI-based, glassy top navigation with subtle grain.
 * - Uses existing global glass/grain utilities (glass-surface, with-grain).
 * - Theme-aware via DaisyUI; no direct fetches.
 * - Animated active indicator and quick actions for a social/messaging app.
 */
export default component$(() => {
	const loc = useLocation();
	const scrolled = useSignal(false);

	// Slight lift/scale on scroll for a dynamic feel (kept minimal for bottom bar)
	useOnWindow(
		"scroll",
		$(() => {
			try {
				scrolled.value = window.scrollY > 8;
			} catch {
				/* ignore */
			}
		}),
	);

	// Compute simple active helper
	const isActive = (p: string) => {
		const cur = loc.url.pathname || "/";
		if (p === "/") return cur === "/";
		return cur.startsWith(p);
	};

	// Avoid layout jump on first paint; set initial scroll state client-side
	useTask$(() => {
		if (typeof window === "undefined") return;
		scrolled.value = window.scrollY > 8;
	});

	// No sliding pill logic; keep it clean like the top version

	return (
		<nav
			class={[
				"fixed left-1/2 -translate-x-1/2 bottom-3 z-[100000]",
				"transition-transform duration-300",
				scrolled.value
					? "translate-y-[-2px] scale-[.995]"
					: "translate-y-0 scale-100",
				"w-[min(1120px,calc(100%-1.5rem))]",
			].join(" ")}
			aria-label="Primary"
		>
			<div
				class={[
					"navbar rounded-2xl border glass-surface border-soft with-grain",
					"bg-base-100/5 shadow-xl px-2",
				].join(" ")}
			>
				{/* Left spacer (brand removed per request) */}
				<div class="navbar-start w-0 p-0 m-0" />

				{/* Center: Primary tabs with animated underline */}
				<div class="navbar-center w-full">
					<ul class="grid w-full grid-cols-5 place-items-center gap-0 px-2 relative">
						<li class="w-full grid place-items-center">
							<Link
								aria-current={isActive("/") ? "page" : undefined}
								href="/"
								class="px-2 py-1.5 rounded-lg transition-colors"
							>
								<LuHome class="w-6 h-6" />
								<span class="sr-only">Home</span>
							</Link>
						</li>
						<li class="w-full grid place-items-center">
							<Link
								aria-current={isActive("/about") ? "page" : undefined}
								href="/about"
								class="px-2 py-1.5 rounded-lg transition-colors"
							>
								<LuInfo class="w-6 h-6" />
								<span class="sr-only">About</span>
							</Link>
						</li>
						<li class="w-full grid place-items-center">
							<Link
								aria-current={isActive("/contact") ? "page" : undefined}
								href="/contact"
								class="px-2 py-1.5 rounded-lg transition-colors"
							>
								<LuMail class="w-6 h-6" />
								<span class="sr-only">Messages</span>
							</Link>
						</li>
						<li class="w-full grid place-items-center">
							<Link
								aria-current={isActive("/profile") ? "page" : undefined}
								href="/profile"
								class="px-2 py-1.5 rounded-lg transition-colors"
							>
								<LuUser class="w-6 h-6" />
								<span class="sr-only">Account</span>
							</Link>
						</li>
						<li class="w-full grid place-items-center">
							<ThemeToggle class="btn btn-ghost btn-sm" iconClass="w-6 h-6" />
						</li>
					</ul>
				</div>

				{/* Right section removed to allow equal-width centering */}
			</div>
		</nav>
	);
});
