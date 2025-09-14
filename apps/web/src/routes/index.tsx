import {
	component$,
	isServer,
	useSignal,
	useVisibleTask$,
} from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";
import { Link } from "@builder.io/qwik-city";
import Avatar from "~/components/Avatar";
import { PreactStatsIsland } from "~/components/PreactStatsIsland";
import { pastelFor } from "~/lib/avatar-color";
import { cn } from "~/lib/cn";
import { animateMotion, timelineMotion } from "~/lib/motion-qwik";

export default component$(() => {
	const h1Ref = useSignal<HTMLElement>();
	const subRef = useSignal<HTMLElement>();
	const ctaRef = useSignal<HTMLElement>();
	// Feature cards staggered reveal refs
	const feat1Ref = useSignal<HTMLElement>();
	const feat2Ref = useSignal<HTMLElement>();
	const feat3Ref = useSignal<HTMLElement>();
	// Live activity card (right side) reveal ref
	const liveRef = useSignal<HTMLElement>();
	// Chat Preview two-column reveal refs
	const chatLeftRef = useSignal<HTMLElement>();
	const chatRightRef = useSignal<HTMLElement>();
	// Typing-to-bubble demo refs
	const youTypingRef = useSignal<HTMLElement>();
	const youBubbleRef = useSignal<HTMLElement>();
	const minaTypingRef = useSignal<HTMLElement>();
	const minaBubbleRef = useSignal<HTMLElement>();
	const youImgRef = useSignal<HTMLElement>();
	const youHeaderRef = useSignal<HTMLElement>();
	const minaImgRef = useSignal<HTMLElement>();
	const minaHeaderRef = useSignal<HTMLElement>();
	const you2TypingRef = useSignal<HTMLElement>();
	const you2BubbleRef = useSignal<HTMLElement>();
	const you2ImgRef = useSignal<HTMLElement>();
	const you2HeaderRef = useSignal<HTMLElement>();

	// Animate subheading + CTAs with Motion One (client-only)
	useVisibleTask$(() => {
		if (isServer) return;
		// Prepare initial hidden state on the client to avoid SSG hiding
		try {
			if (subRef.value) {
				subRef.value.style.opacity = "0";
				subRef.value.style.transform = "translateY(18px)";
				subRef.value.style.willChange = "transform, opacity";
			}
			if (ctaRef.value) {
				ctaRef.value.style.opacity = "0";
				ctaRef.value.style.transform = "translateY(12px)";
				ctaRef.value.style.willChange = "transform, opacity";
			}
		} catch {}
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
					try {
						if (subRef.value) subRef.value.style.willChange = "";
					} catch {}
					try {
						if (ctaRef.value) ctaRef.value.style.willChange = "";
					} catch {}
				}
			} catch {
				/* ignore */
			}
		})();
		return () => {
			cancel = true;
		};
	});

	// Motion One word-reveal for the headline.
	// Pre-split the headline in SSR to avoid client-side DOM rewriting that can cause CLS.
	useVisibleTask$(() => {
		if (isServer) return;
		const el = h1Ref.value;
		if (!el) return;
		// Respect reduced motion
		if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
			return;
		}
		// Words are already present from SSR; set initial state for Motion animation
		const words = Array.from(el.querySelectorAll<HTMLElement>(".word"));
		words.forEach((w) => {
			try {
				w.style.transform = "translateY(120%)";
				w.style.opacity = "0";
				w.style.willChange = "transform, opacity";
			} catch {}
		});

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

	// Staggered slide-up for Feature cards using Motion One timeline when they enter viewport
	useVisibleTask$(() => {
		if (isServer) return;
		const els = [feat1Ref.value, feat2Ref.value, feat3Ref.value].filter(
			(el): el is HTMLElement => Boolean(el),
		);
		if (els.length === 0) return;
		// Set initial hidden state (below the fold; no CLS risk)
		try {
			els.forEach((el) => {
				el.style.opacity = "0";
				el.style.transform = "translateY(16px)";
				el.style.willChange = "transform, opacity";
			});
		} catch {}
		const io = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) {
					(async () => {
						try {
							await timelineMotion(
								els.map((el, i) => ({
									el,
									keyframes: { y: [16, 0], opacity: [0, 1] },
									options: {
										duration: 0.5,
										easing: "cubic-bezier(.22,.9,.37,1)",
									},
									at: i * 0.12,
								})),
							);
						} catch {}
						try {
							els.forEach((el) => (el.style.willChange = ""));
						} catch {}
						try {
							io.disconnect();
						} catch {}
					})();
				}
			},
			{ root: null, threshold: 0.15 },
		);
		try {
			els.forEach((el) => io.observe(el));
		} catch {}
		return () => {
			try {
				io.disconnect();
			} catch {}
		};
	});

	// Live Activity card: fade + slide-in from the right when it becomes visible
	useVisibleTask$(() => {
		if (isServer) return;
		const el = liveRef.value;
		if (!el) return;
		try {
			el.style.opacity = "0";
			el.style.transform = "translateX(20px)";
			el.style.willChange = "transform, opacity";
		} catch {}
		const io = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) {
					(async () => {
						try {
							await timelineMotion([
								{
									el,
									keyframes: { x: [20, 0], opacity: [0, 1] },
									options: {
										duration: 0.5,
										easing: "cubic-bezier(.22,.9,.37,1)",
									},
									at: 0,
								},
							]);
						} catch {}
						try {
							el.style.willChange = "";
						} catch {}
						try {
							io.disconnect();
						} catch {}
					})();
				}
			},
			{ root: null, threshold: 0.15 },
		);
		try {
			io.observe(el);
		} catch {}
		return () => {
			try {
				io.disconnect();
			} catch {}
		};
	});

	// Chat Preview: fade toward each other when visible (IO-triggered)
	useVisibleTask$(() => {
		if (isServer) return;
		const left = chatLeftRef.value;
		const right = chatRightRef.value;
		if (!left && !right) return;
		try {
			if (left) {
				left.style.opacity = "0";
				left.style.transform = "translateX(-16px)";
				left.style.willChange = "transform, opacity";
			}
			if (right) {
				right.style.opacity = "0";
				right.style.transform = "translateX(16px)";
				right.style.willChange = "transform, opacity";
			}
		} catch {}
		const els = [left, right].filter((e): e is HTMLElement => Boolean(e));
		if (els.length === 0) return;
		const io = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) {
					(async () => {
						try {
							await timelineMotion([
								...(left
									? ([
											{
												el: left,
												keyframes: { x: [-16, 0], opacity: [0, 1] },
												options: {
													duration: 0.5,
													easing: "cubic-bezier(.22,.9,.37,1)",
												},
												at: 0,
											},
										] as const)
									: []),
								...(right
									? ([
											{
												el: right,
												keyframes: { x: [16, 0], opacity: [0, 1] },
												options: {
													duration: 0.5,
													easing: "cubic-bezier(.22,.9,.37,1)",
												},
												at: 0,
											},
										] as const)
									: []),
							]);
						} catch {}
						try {
							if (left) left.style.willChange = "";
						} catch {}
						try {
							if (right) right.style.willChange = "";
						} catch {}
						try {
							io.disconnect();
						} catch {}
					})();
				}
			},
			{ root: null, threshold: 0.15 },
		);
		try {
			els.forEach((el) => io.observe(el));
		} catch {}
		return () => {
			try {
				io.disconnect();
			} catch {}
		};
	});

	// Live chat typing -> message reveal using Motion One
	useVisibleTask$(() => {
		if (isServer) return;
		const rightCol = chatRightRef.value;
		if (!rightCol) return;
		const youTyping = youTypingRef.value;
		const youBubble = youBubbleRef.value;
		const minaTyping = minaTypingRef.value;
		const minaBubble = minaBubbleRef.value;
		const you2Typing = you2TypingRef.value;
		const you2Bubble = you2BubbleRef.value;
		const youImg = youImgRef.value as HTMLElement | undefined;
		const youHdr = youHeaderRef.value as HTMLElement | undefined;
		const minaImg = minaImgRef.value as HTMLElement | undefined;
		const minaHdr = minaHeaderRef.value as HTMLElement | undefined;
		const you2Img = you2ImgRef.value as HTMLElement | undefined;
		const you2Hdr = you2HeaderRef.value as HTMLElement | undefined;
		// Prepare initial states
		try {
			[youBubble, minaBubble, you2Bubble].forEach((el) => {
				if (!el) return;
				el.style.opacity = "0";
				el.style.transform = "translateY(8px)";
				el.style.willChange = "transform, opacity";
			});
			[
				youTyping,
				minaTyping,
				you2Typing,
				youImg,
				youHdr,
				minaImg,
				minaHdr,
				you2Img,
				you2Hdr,
			].forEach((el) => {
				if (!el) return;
				el.style.opacity = "0";
				el.style.transform = "translateY(6px)";
			});
		} catch {}
		const io = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) {
					(async () => {
						try {
							// YOU: typing in (avatar + header appear with typing)
							await Promise.all([
								youTyping
									? animateMotion(
											youTyping,
											{ y: [6, 0], opacity: [0, 1] },
											{ duration: 0.25, easing: "ease-out" },
										)
									: Promise.resolve(),
								youImg
									? animateMotion(
											youImg,
											{ y: [6, 0], opacity: [0, 1] },
											{ duration: 0.25, easing: "ease-out" },
										)
									: Promise.resolve(),
								youHdr
									? animateMotion(
											youHdr,
											{ y: [6, 0], opacity: [0, 1] },
											{ duration: 0.25, easing: "ease-out" },
										)
									: Promise.resolve(),
							]);
							// YOU: dot pulse handled via CSS animation; just wait a bit
							await new Promise((r) => setTimeout(r, 900));
							// YOU: typing out + bubble in
							await Promise.all([
								youTyping
									? animateMotion(
											youTyping,
											{ opacity: [1, 0] },
											{ duration: 0.18 },
										)
									: Promise.resolve(),
								youBubble
									? animateMotion(
											youBubble,
											{ y: [8, 0], opacity: [0, 1] },
											{ duration: 0.35, easing: "cubic-bezier(.22,.9,.37,1)" },
										)
									: Promise.resolve(),
							]);
							try {
								if (youBubble) youBubble.style.willChange = "";
							} catch {}

							// Delay before next user
							await new Promise((r) => setTimeout(r, 400));

							// MINA: typing in (with avatar + header)
							await Promise.all([
								minaTyping
									? animateMotion(
											minaTyping,
											{ y: [6, 0], opacity: [0, 1] },
											{ duration: 0.25, easing: "ease-out" },
										)
									: Promise.resolve(),
								minaImg
									? animateMotion(
											minaImg,
											{ y: [6, 0], opacity: [0, 1] },
											{ duration: 0.25, easing: "ease-out" },
										)
									: Promise.resolve(),
								minaHdr
									? animateMotion(
											minaHdr,
											{ y: [6, 0], opacity: [0, 1] },
											{ duration: 0.25, easing: "ease-out" },
										)
									: Promise.resolve(),
							]);
							// MINA: dot pulse via CSS
							await new Promise((r) => setTimeout(r, 900));
							await Promise.all([
								minaTyping
									? animateMotion(
											minaTyping,
											{ opacity: [1, 0] },
											{ duration: 0.18 },
										)
									: Promise.resolve(),
								minaBubble
									? animateMotion(
											minaBubble,
											{ y: [8, 0], opacity: [0, 1] },
											{ duration: 0.35, easing: "cubic-bezier(.22,.9,.37,1)" },
										)
									: Promise.resolve(),
							]);
							try {
								if (minaBubble) minaBubble.style.willChange = "";
							} catch {}

							// Delay then YOU again
							await new Promise((r) => setTimeout(r, 420));
							await Promise.all([
								you2Typing
									? animateMotion(
											you2Typing,
											{ y: [6, 0], opacity: [0, 1] },
											{ duration: 0.25, easing: "ease-out" },
										)
									: Promise.resolve(),
								you2Img
									? animateMotion(
											you2Img,
											{ y: [6, 0], opacity: [0, 1] },
											{ duration: 0.25, easing: "ease-out" },
										)
									: Promise.resolve(),
								you2Hdr
									? animateMotion(
											you2Hdr,
											{ y: [6, 0], opacity: [0, 1] },
											{ duration: 0.25, easing: "ease-out" },
										)
									: Promise.resolve(),
							]);
							await new Promise((r) => setTimeout(r, 900));
							await Promise.all([
								you2Typing
									? animateMotion(
											you2Typing,
											{ opacity: [1, 0] },
											{ duration: 0.18 },
										)
									: Promise.resolve(),
								you2Bubble
									? animateMotion(
											you2Bubble,
											{ y: [8, 0], opacity: [0, 1] },
											{ duration: 0.35, easing: "cubic-bezier(.22,.9,.37,1)" },
										)
									: Promise.resolve(),
							]);
							try {
								if (you2Bubble) you2Bubble.style.willChange = "";
							} catch {}
						} catch {}
						try {
							io.disconnect();
						} catch {}
					})();
				}
			},
			{ root: null, threshold: 0.4 },
		);
		try {
			io.observe(rightCol);
		} catch {}
		return () => {
			try {
				io.disconnect();
			} catch {}
		};
	});

	return (
		<div class="w-full">
			{/* Hero */}
			<section class="relative overflow-hidden">
				{/* ambient glow */}
				<div aria-hidden class="pointer-events-none absolute -inset-40">
					<div
						class="absolute -top-40 left-1/2 size-[1200px] -translate-x-1/2 rounded-full"
						style={{
							background:
								"radial-gradient(closest-side, color-mix(in oklab, oklch(var(--p)) 22%, transparent), color-mix(in oklab, oklch(var(--p)) 10%, transparent), transparent)",
						}}
					/>
				</div>

				<div class="relative mx-auto max-w-7xl px-6 pt-20 pb-14">
					<div class="grid items-center gap-10 md:grid-cols-2 md:gap-12">
						<div class="text-center md:text-left">
							<h1
								ref={h1Ref}
								style={{
									fontSize: "clamp(2.25rem, 6vw, 4.5rem)",
									lineHeight: "1.1",
								}}
								class={cn(
									"text-5xl leading-tight font-extrabold tracking-tight text-balance md:text-6xl lg:text-7xl",
								)}
							>
								{(() => {
									const words = ["Social", "messaging,", "reimagined."];
									const nodes: any[] = [];
									words.forEach((w, i) => {
										nodes.push(
											<span
												class="word-outer inline-block overflow-hidden align-baseline"
												key={`w-${i}`}
												style={{ paddingBottom: "0.12em" }}
											>
												<span class="word inline-block will-change-transform">
													{w}
												</span>
											</span>,
										);
										if (i < words.length - 1) nodes.push(" ");
									});
									return nodes;
								})()}
							</h1>
							<p
								ref={subRef}
								style={isServer ? undefined : { opacity: "0" }}
								class={cn("text-base-content/70 mx-auto mt-4 max-w-xl md:mx-0")}
							>
								Real‑time chats, rich profiles, and a playful, modern UI — all
								on a silky glass surface with a subtle grain texture.
							</p>
							<div
								ref={ctaRef}
								style={isServer ? undefined : { opacity: "0" }}
								class={cn(
									"mt-8 flex items-center justify-center gap-4 md:justify-start",
								)}
							>
								<Link href="/signup" prefetch="js" class="btn btn-primary">
									Create your account
								</Link>
								<Link href="/login" prefetch="js" class="btn btn-ghost">
									Sign in
								</Link>
							</div>
							<div
								class="mt-6 flex flex-wrap items-center justify-center gap-2 md:justify-start md:gap-3 hero-badges"
								data-reveal
							>
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
							<div
								ref={liveRef}
								class="glass-surface border-soft with-grain card bg-base-100/5 border shadow-xl"
								data-reveal
								data-reveal-from="right"
								data-reveal-force="1"
							>
								<div class="card-body p-5 sm:p-6">
									<div class="flex items-center justify-between">
										<h2 class="font-semibold">Live Activity</h2>
										<span class="badge badge-success badge-outline">
											online
										</span>
									</div>
									<div class="mt-4 space-y-3">
										<div class="flex items-center gap-3" data-reveal>
											<Avatar name="M" size="h-8 w-8" />
											<div>
												<div class="text-sm font-medium">Mina</div>
												<div class="text-xs opacity-70">
													sent a photo to #general
												</div>
											</div>
											<div class="ms-auto text-xs opacity-60">just now</div>
										</div>
										<div class="flex items-center gap-3" data-reveal>
											<Avatar name="J" size="h-8 w-8" />
											<div>
												<div class="text-sm font-medium">Jae</div>
												<div class="text-xs opacity-70">
													reacted ❤️ to your message
												</div>
											</div>
											<div class="ms-auto text-xs opacity-60">1m</div>
										</div>
										<div class="flex items-center gap-3" data-reveal>
											<Avatar name="H" size="h-8 w-8" />
											<div>
												<div class="text-sm font-medium">Hana</div>
												<div class="text-xs opacity-70">
													joined room “Design Crit”
												</div>
											</div>
											<div class="ms-auto text-xs opacity-60">3m</div>
										</div>
									</div>
									<div class="card-actions mt-4 justify-end">
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
			<section class="cv-auto mx-auto max-w-7xl px-6 py-12 md:py-16">
				<div class="grid gap-6 md:grid-cols-3">
					{/** Feature 1 **/}
					<div
						class="glass-surface border-soft with-grain card bg-base-100/5 border"
						data-reveal
						data-reveal-order="1"
						ref={feat1Ref}
					>
						<div class="card-body">
							<div class="emoji text-3xl">💬</div>
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
						data-reveal-order="2"
						ref={feat2Ref}
					>
						<div class="card-body">
							<div class="emoji text-3xl">🎨</div>
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
						data-reveal-order="3"
						ref={feat3Ref}
					>
						<div class="card-body">
							<div class="emoji text-3xl">⚡</div>
							<h3 class="card-title">Built for speed</h3>
							<p class="opacity-70">
								Qwik islands, SSR, and lazy motion keep the app snappy and lean.
							</p>
						</div>
					</div>
				</div>
			</section>

			{/* Chat Preview */}
			<section class="mx-auto max-w-7xl px-6 py-8 md:py-10">
				<div class="grid items-center gap-8 md:grid-cols-2">
					<div ref={chatLeftRef} class="order-2 md:order-1">
						<h2 class="text-2xl font-bold md:text-3xl">
							Conversations that feel alive
						</h2>
						<p class="text-base-content/70 mt-3">
							Reactions, short replies, link previews, and smooth transitions.
							Powerful yet friendly - a space that invites talking.
						</p>
						<div class="mt-6 flex gap-3">
							<Link href="/login" prefetch="js" class="btn btn-outline">
								Jump into a room
							</Link>
							<Link
								href="/about"
								prefetch="js"
								class="btn btn-ghost"
								aria-label="Learn more about Stack"
							>
								Learn more about Stack
							</Link>
						</div>
					</div>
					<div ref={chatRightRef} class="order-1 md:order-2">
						<div class="glass-surface border-soft with-grain card bg-base-100/5 min-h-[360px] border shadow-lg chat-preview">
							<div class="card-body p-4 sm:p-6">
								<div class="space-y-3">
									<div
										class="chat chat-start"
										data-reveal
										data-reveal-order="1"
									>
										<div class="chat-image">
											<Avatar name="Alex" size="h-9 w-9" />
										</div>
										<div class="chat-header">
											Alex <time class="text-xs opacity-70">2:41 PM</time>
										</div>
										<div
											class="chat-bubble"
											style={{
												backgroundColor: pastelFor("Alex"),
												color: "#111",
											}}
										>
											You should see the new profile UI - it's smooth.
										</div>
									</div>
									<div class="chat chat-end" data-reveal data-reveal-order="2">
										<div ref={youImgRef} class="chat-image">
											<Avatar name="You" size="h-9 w-9" bgHex="#BFDBFE" />
										</div>
										<div ref={youHeaderRef} class="chat-header">
											You <time class="text-xs opacity-70">2:42 PM</time>
										</div>
										<div
											ref={youTypingRef}
											class="chat-bubble"
											style={{ backgroundColor: "#BFDBFE", color: "#111" }}
										>
											<span class="typing-dot"></span>
											<span class="typing-dot"></span>
											<span class="typing-dot"></span>
										</div>
										<div
											ref={youBubbleRef}
											class="chat-bubble"
											style={{ backgroundColor: "#BFDBFE", color: "#111" }}
										>
											On it. Pushing a fix to reactions now ⚡
										</div>
									</div>
									<div
										class="chat chat-start"
										data-reveal
										data-reveal-order="3"
									>
										<div ref={minaImgRef} class="chat-image">
											<Avatar name="Mina" size="h-9 w-9" />
										</div>
										<div ref={minaHeaderRef} class="chat-header">
											Mina <time class="text-xs opacity-70">2:43 PM</time>
										</div>
										<div
											ref={minaTypingRef}
											class="chat-bubble"
											style={{
												backgroundColor: pastelFor("Mina"),
												color: "#111",
											}}
										>
											<span class="typing-dot"></span>
											<span class="typing-dot"></span>
											<span class="typing-dot"></span>
										</div>
										<div
											ref={minaBubbleRef}
											class="chat-bubble"
											style={{
												backgroundColor: pastelFor("Mina"),
												color: "#111",
											}}
										>
											Let's demo it in #design-crit in 10?
										</div>
									</div>
									<div class="chat chat-end" data-reveal data-reveal-order="4">
										<div ref={you2ImgRef} class="chat-image">
											<Avatar name="You" size="h-9 w-9" bgHex="#BFDBFE" />
										</div>
										<div ref={you2HeaderRef} class="chat-header">
											You <time class="text-xs opacity-70">2:44 PM</time>
										</div>
										<div
											ref={you2TypingRef}
											class="chat-bubble"
											style={{ backgroundColor: "#BFDBFE", color: "#111" }}
										>
											<span class="typing-dot"></span>
											<span class="typing-dot"></span>
											<span class="typing-dot"></span>
										</div>
										<div
											ref={you2BubbleRef}
											class="chat-bubble"
											style={{ backgroundColor: "#BFDBFE", color: "#111" }}
										>
											Great — see you there!
										</div>
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* Stats (Preact island animates counters when visible) */}
			<section class="mx-auto max-w-7xl px-6 py-10">
				{/* Hydrate the Preact island only on visibility to avoid SSR rendering warnings */}
				{/* @ts-expect-error Qwik client directive */}
				<PreactStatsIsland client:visible />
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
