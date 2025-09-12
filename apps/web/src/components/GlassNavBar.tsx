import type { Component } from "@builder.io/qwik";
import {
	$,
	component$,
	useOnWindow,
	useSignal,
	useVisibleTask$,
} from "@builder.io/qwik";
import { Link, useLocation } from "@builder.io/qwik-city";
import ThemeToggle from "~/components/ThemeToggle";
import { cn } from "~/lib/cn";
// Use Iconify (lucide) via unplugin-icons for tree-shaken inline SVGs
import LuHome from "~icons/lucide/home";
import LuInfo from "~icons/lucide/info";
import LuMail from "~icons/lucide/mail";
import LuUser from "~icons/lucide/user";

// Some IDE/TS setups type unplugin-icons as unknown; cast to Qwik components
const HomeIcon = LuHome as unknown as Component<{ class?: string }>;
const InfoIcon = LuInfo as unknown as Component<{ class?: string }>;
const MailIcon = LuMail as unknown as Component<{ class?: string }>;
const UserIcon = LuUser as unknown as Component<{ class?: string }>;

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

	// Avoid layout jump on first paint; set initial scroll state client-side after mount
	useVisibleTask$(() => {
		try {
			scrolled.value = window.scrollY > 8;
		} catch {}
	});

	// No sliding pill logic; keep it clean like the top version

	return (
		<nav
			class={cn(
				"fixed left-1/2 -translate-x-1/2 bottom-3 z-[100000]",
				"transition-transform duration-300",
				scrolled.value
					? "translate-y-[-2px] scale-[.995]"
					: "translate-y-0 scale-100",
				"w-[min(1120px,calc(100%-1.5rem))]",
			)}
			aria-label="Primary"
			data-glass-nav
		>
			<div
				class={cn(
					"navbar rounded-2xl border glass-surface border-soft with-grain",
					"bg-base-100/5 shadow-xl px-2",
				)}
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
								class={cn("px-2 py-1.5 rounded-lg transition-colors")}
							>
								<HomeIcon class="w-6 h-6 [stroke-width:2.25]" />
								<span class="sr-only">Home</span>
							</Link>
						</li>
						<li class="w-full grid place-items-center">
							<Link
								aria-current={isActive("/about") ? "page" : undefined}
								href="/about"
								class={cn("px-2 py-1.5 rounded-lg transition-colors")}
							>
								<InfoIcon class="w-6 h-6 [stroke-width:2.25]" />
								<span class="sr-only">About</span>
							</Link>
						</li>
						<li class="w-full grid place-items-center">
							<Link
								aria-current={isActive("/contact") ? "page" : undefined}
								href="/contact"
								class={cn("px-2 py-1.5 rounded-lg transition-colors")}
							>
								<MailIcon class="w-6 h-6 [stroke-width:2.25]" />
								<span class="sr-only">Messages</span>
							</Link>
						</li>
						<li class="w-full grid place-items-center">
							<Link
								aria-current={isActive("/profile") ? "page" : undefined}
								href="/profile"
								class={cn("px-2 py-1.5 rounded-lg transition-colors")}
							>
								<UserIcon class="w-6 h-6 [stroke-width:2.25]" />
								<span class="sr-only">Account</span>
							</Link>
						</li>
						<li class="w-full grid place-items-center">
							<ThemeToggle
								{...({ "client:idle": true } as unknown as Record<
									"client:idle",
									true
								>)}
								class="btn btn-ghost btn-sm"
								iconClass="w-6 h-6 [stroke-width:2.25]"
							/>
						</li>
					</ul>
				</div>

				{/* Right section removed to allow equal-width centering */}
			</div>
		</nav>
	);
});
