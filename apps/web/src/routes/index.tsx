import {
	component$,
	isServer,
	useSignal,
	useVisibleTask$,
} from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";
import { cn } from "~/lib/cn";
import { timelineMotion } from "~/lib/motion-qwik";

export default component$(() => {
	const h1Ref = useSignal<HTMLElement>();
	const subRef = useSignal<HTMLElement>();
	const ctaRef = useSignal<HTMLElement>();

	// Animate subheading + CTAs with Motion One (after mount)
	useVisibleTask$(() => {
		if (isServer) return;
		let cancel = false;
		(async () => {
			try {
				const tl = await timelineMotion([
					...(subRef.value
						? [
								{
									el: subRef.value,
									keyframes: { y: [18, 0], opacity: [0, 1] },
									options: {
										duration: 0.5,
										easing: "cubic-bezier(.22,.9,.37,1)",
									},
									at: 0.15,
								},
							]
						: []),
					...(ctaRef.value
						? [
								{
									el: ctaRef.value,
									keyframes: { y: [12, 0], opacity: [0, 1] },
									options: {
										duration: 0.45,
										easing: "cubic-bezier(.22,.9,.37,1)",
									},
									at: 0.3,
								},
							]
						: []),
				]);
				if (!cancel) {
					try {
						await tl?.finished;
					} catch {
						/* ignore */
					}
				}
			} catch {
				/* ignore */
			}
		})();
		return () => {
			cancel = true;
		};
	});

	// Motion One word-reveal for the headline (SplitType-like, no extra dep)
	useVisibleTask$(() => {
		if (isServer) return;
		const el = h1Ref.value;
		if (!el) return;
		// Respect reduced motion
		if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
			// Ensure headline is visible with no animation
			try {
				el.style.visibility = "visible";
			} catch {}
			return;
		}

		const original = el.textContent || "";
		// Skip if already split
		if (el.hasAttribute("data-split")) return;
		el.setAttribute("data-split", "1");

		// Split into words while preserving spaces and provide an overflow clip wrapper
		const parts = original.split(/(\s+)/);
		el.textContent = "";
		for (const p of parts) {
			if (/^\s+$/.test(p)) {
				el.appendChild(document.createTextNode(p));
			} else if (p) {
				const outer = document.createElement("span");
				outer.className =
					"word-outer inline-block overflow-hidden align-baseline";
				const inner = document.createElement("span");
				inner.className = "word inline-block will-change-transform";
				inner.textContent = p;
				outer.appendChild(inner);
				el.appendChild(outer);
			}
		}

		// Pre-set initial state for Motion animation
		const words = Array.from(el.querySelectorAll<HTMLElement>(".word"));
		words.forEach((w) => {
			try {
				w.style.transform = "translateY(120%)";
				w.style.opacity = "0";
				w.style.willChange = "transform, opacity";
			} catch {}
		});
		// Ensure container is visible before play to avoid flicker
		try {
			el.style.opacity = "1";
		} catch {}

		// Build a staggered timeline using Motion One
		const items = words.map((w, i) => ({
			el: w,
			keyframes: {
				transform: ["translateY(120%)", "translateY(0%)"],
				opacity: [0, 1],
			},
			options: { duration: 0.6, easing: "cubic-bezier(.22,.9,.37,1)" },
			at: i * 0.08,
		}));

		let cancelled = false;
		(async () => {
			try {
				const tl = await timelineMotion(items);
				if (!cancelled) {
					try {
						await tl?.finished;
					} catch {
						/* ignore */
					}
				}
			} catch {
				// If timeline failed, reveal words immediately
				try {
					words.forEach((w) => {
						w.style.transform = "none";
						w.style.opacity = "1";
					});
				} catch {}
			} finally {
				// Cleanup will-change after animation settles
				try {
					words.forEach((w) => {
						w.style.willChange = "";
					});
				} catch {
					/* ignore */
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	});

	return (
		<div class="w-full">
			{/* Hero */}
			<section class="relative overflow-hidden">
				{/* ambient glow */}
				<div aria-hidden class="pointer-events-none absolute -inset-40">
					<div
						class="absolute -top-40 left-1/2 -translate-x-1/2 size-[1200px] rounded-full"
						style={{
							background:
								"radial-gradient(closest-side, color-mix(in oklab, oklch(var(--p)) 22%, transparent), color-mix(in oklab, oklch(var(--p)) 10%, transparent), transparent)",
						}}
					/>
				</div>

				<div class="relative mx-auto max-w-7xl px-6 pt-20 pb-14">
					<div class="grid items-center gap-10 md:gap-12 md:grid-cols-2">
						<div class="text-center md:text-left">
							<h1
								ref={h1Ref}
								style={{ opacity: "0" }}
								class={cn(
									"text-5xl md:text-6xl lg:text-7xl font-extrabold leading-tight tracking-tight text-balance",
								)}
							>
								Social messaging, reimagined.
							</h1>
							<p
								ref={subRef}
								style={{ opacity: "0" }}
								class={cn("mt-4 text-base-content/70 max-w-xl mx-auto md:mx-0")}
							>
								Real‑time chats, rich profiles, and a playful, modern UI — all
								on a silky glass surface with a subtle grain texture.
							</p>
							<div
								ref={ctaRef}
								style={{ opacity: "0" }}
								class={cn(
									"mt-8 flex items-center justify-center md:justify-start gap-4",
								)}
							>
								<a href="/signup" class="btn btn-primary">
									Create your account
								</a>
								<a href="/login" class="btn btn-ghost">
									Sign in
								</a>
							</div>
							<div class="mt-6 flex flex-wrap items-center justify-center md:justify-start gap-2 md:gap-3">
								<div class="badge badge-primary badge-outline badge-sm md:badge-md whitespace-nowrap">
									End‑to‑end rooms
								</div>
								<div class="badge badge-secondary badge-outline badge-sm md:badge-md whitespace-nowrap">
									Presence
								</div>
								<div class="badge badge-warning badge-outline badge-sm md:badge-md whitespace-nowrap">
									File drops
								</div>
							</div>
						</div>

						{/* Glass showcase */}
						<div class="relative">
							<div class="glass-surface border-soft with-grain card bg-base-100/5 border shadow-xl">
								<div class="card-body p-5 sm:p-6">
									<div class="flex items-center justify-between">
										<h2 class="font-semibold">Live Activity</h2>
										<span class="badge badge-success badge-outline">
											online
										</span>
									</div>
									<div class="mt-4 space-y-3">
										<div class="flex items-center gap-3" data-reveal>
											<div class="avatar placeholder">
												<div class="bg-neutral text-neutral-content w-8 rounded-full">
													<span>M</span>
												</div>
											</div>
											<div>
												<div class="text-sm font-medium">Mina</div>
												<div class="text-xs opacity-70">
													sent a photo to #general
												</div>
											</div>
											<div class="ms-auto text-xs opacity-60">just now</div>
										</div>
										<div class="flex items-center gap-3" data-reveal>
											<div class="avatar placeholder">
												<div class="bg-neutral text-neutral-content w-8 rounded-full">
													<span>J</span>
												</div>
											</div>
											<div>
												<div class="text-sm font-medium">Jae</div>
												<div class="text-xs opacity-70">
													reacted ❤️ to your message
												</div>
											</div>
											<div class="ms-auto text-xs opacity-60">1m</div>
										</div>
										<div class="flex items-center gap-3" data-reveal>
											<div class="avatar placeholder">
												<div class="bg-neutral text-neutral-content w-8 rounded-full">
													<span>H</span>
												</div>
											</div>
											<div>
												<div class="text-sm font-medium">Hana</div>
												<div class="text-xs opacity-70">
													joined room “Design Crit”
												</div>
											</div>
											<div class="ms-auto text-xs opacity-60">3m</div>
										</div>
									</div>
									<div class="card-actions justify-end mt-4">
										<a href="/integrations" class="btn btn-sm btn-outline">
											Explore integrations
										</a>
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* Features */}
			<section class="max-w-7xl mx-auto px-6 py-12 md:py-16 cv-auto">
				<div class="grid md:grid-cols-3 gap-6">
					{/** Feature 1 **/}
					<div
						class="glass-surface border-soft with-grain card bg-base-100/5 border"
						data-reveal
					>
						<div class="card-body">
							<div class="text-3xl">💬</div>
							<h3 class="card-title">Realtime messaging</h3>
							<p class="opacity-70">
								Low‑latency rooms, typing indicators, and read receipts that
								feel instant.
							</p>
						</div>
					</div>
					{/** Feature 2 **/}
					<div
						class="glass-surface border-soft with-grain card bg-base-100/5 border"
						data-reveal
					>
						<div class="card-body">
							<div class="text-3xl">🎨</div>
							<h3 class="card-title">Glassy by design</h3>
							<p class="opacity-70">
								DaisyUI surfaces with delicate grain, tasteful depth, and
								OLED‑friendly contrast.
							</p>
						</div>
					</div>
					{/** Feature 3 **/}
					<div
						class="glass-surface border-soft with-grain card bg-base-100/5 border"
						data-reveal
					>
						<div class="card-body">
							<div class="text-3xl">⚡</div>
							<h3 class="card-title">Built for speed</h3>
							<p class="opacity-70">
								Qwik islands, SSR, and lazy motion keep the app snappy and lean.
							</p>
						</div>
					</div>
				</div>
			</section>

			{/* Chat Preview */}
			<section class="max-w-7xl mx-auto px-6 py-8 md:py-10">
				<div class="grid md:grid-cols-2 gap-8 items-center">
					<div class="order-2 md:order-1">
						<h2 class="text-2xl md:text-3xl font-bold">
							Conversations that feel alive
						</h2>
						<p class="mt-3 text-base-content/70">
							Reactions, short replies, link previews, and smooth transitions.
							Powerful yet friendly — a space that invites talking.
						</p>
						<div class="mt-6 flex gap-3">
							<a href="/login" class="btn btn-outline">
								Jump into a room
							</a>
							<a
								href="/about"
								class="btn btn-ghost"
								aria-label="Learn more about Stack"
							>
								Learn more about Stack
							</a>
						</div>
					</div>
					<div class="order-1 md:order-2">
						<div
							class="glass-surface border-soft with-grain card bg-base-100/5 border shadow-lg"
							data-reveal
						>
							<div class="card-body p-4 sm:p-6">
								<div class="space-y-3">
									<div class="chat chat-start">
										<div class="chat-image avatar placeholder">
											<div class="bg-neutral text-neutral-content w-9 rounded-full">
												<span>A</span>
											</div>
										</div>
										<div class="chat-header">
											Alex <time class="text-xs opacity-70">2:41 PM</time>
										</div>
										<div class="chat-bubble">
											You should see the new profile UI — it’s smooth.
										</div>
									</div>
									<div class="chat chat-end">
										<div class="chat-image avatar placeholder">
											<div class="bg-neutral text-neutral-content w-9 rounded-full">
												<span>Y</span>
											</div>
										</div>
										<div class="chat-header">
											You <time class="text-xs opacity-70">2:42 PM</time>
										</div>
										<div class="chat-bubble chat-bubble-primary">
											On it. Pushing a fix to reactions now ⚡
										</div>
									</div>
									<div class="chat chat-start">
										<div class="chat-image avatar placeholder">
											<div class="bg-neutral text-neutral-content w-9 rounded-full">
												<span>M</span>
											</div>
										</div>
										<div class="chat-header">
											Mina <time class="text-xs opacity-70">2:43 PM</time>
										</div>
										<div class="chat-bubble">
											Let’s demo it in #design-crit in 10?
										</div>
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* Stats */}
			<section class="max-w-7xl mx-auto px-6 py-10">
				<div
					class="stats stats-vertical lg:stats-horizontal shadow w-full glass-surface border-soft with-grain bg-base-100/5 border"
					data-reveal
				>
					<div class="stat">
						<div class="stat-title">Active users</div>
						<div class="stat-value">12.3k</div>
						<div class="stat-desc">+324 today</div>
					</div>
					<div class="stat">
						<div class="stat-title">Messages sent</div>
						<div class="stat-value">98.4M</div>
						<div class="stat-desc">+1.2M this week</div>
					</div>
					<div class="stat">
						<div class="stat-title">Uptime</div>
						<div class="stat-value">99.99%</div>
						<div class="stat-desc">Last 30 days</div>
					</div>
				</div>
			</section>
		</div>
	);
});

export const head: DocumentHead = {
	title: "Stack • Social messaging, reimagined",
	meta: [
		{
			name: "description",
			content:
				"A modern social app with realtime messaging — glassy UI, subtle grain, and delightful motion.",
		},
	],
};

export const prerender = true;
