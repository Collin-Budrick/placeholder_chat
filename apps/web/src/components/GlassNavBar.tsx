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
// Use the standard info icon for About
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
				"fixed bottom-3 left-1/2 z-[100000] -translate-x-1/2",
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
					"navbar glass-surface border-soft with-grain rounded-2xl border",
					"bg-base-100/5 px-2 shadow-xl",
				)}
			>
				{/* Left spacer (brand removed per request) */}
				<div class="navbar-start m-0 w-0 p-0" />

				{/* Center: Primary tabs with animated underline */}
				<div class="navbar-center w-full">
					<ul class="relative grid w-full grid-cols-5 place-items-center gap-0 px-2">
						<li class="grid w-full place-items-center">
							<Link
								aria-current={isActive("/") ? "page" : undefined}
								href="/"
								class={cn("rounded-lg px-2 py-1.5 transition-colors")}
							>
								<HomeIcon class="icon-sharp h-7 w-7 [stroke-width:2]" />
								<span class="sr-only">Home</span>
							</Link>
						</li>
						<li class="grid w-full place-items-center">
							<Link
								aria-current={isActive("/about") ? "page" : undefined}
								href="/about"
								class={cn("rounded-lg px-2 py-1.5 transition-colors")}
							>
								<InfoIcon class="icon-sharp h-7 w-7 [stroke-width:2]" />
								<span class="sr-only">About</span>
							</Link>
						</li>
						<li class="grid w-full place-items-center">
							<Link
								aria-current={isActive("/contact") ? "page" : undefined}
								href="/contact"
								class={cn("rounded-lg px-2 py-1.5 transition-colors")}
							>
								<MailIcon class="icon-sharp h-7 w-7 [stroke-width:2]" />
								<span class="sr-only">Messages</span>
							</Link>
						</li>
						<li class="grid w-full place-items-center">
							<Link
								aria-current={isActive("/profile") ? "page" : undefined}
								href="/profile"
								class={cn("rounded-lg px-2 py-1.5 transition-colors")}
							>
								<UserIcon class="icon-sharp h-7 w-7 [stroke-width:2]" />
								<span class="sr-only">Account</span>
							</Link>
						</li>
						<li class="grid w-full place-items-center">
							<ThemeToggle
								{...({ "client:idle": true } as unknown as Record<
									"client:idle",
									true
								>)}
								class="btn btn-ghost btn-sm w-12"
								iconClass="icon-sharp w-7 h-7 [stroke-width:2]"
							/>
						</li>
					</ul>
				</div>

				{/* Right section removed to allow equal-width centering */}
			</div>
		</nav>
	);
});
