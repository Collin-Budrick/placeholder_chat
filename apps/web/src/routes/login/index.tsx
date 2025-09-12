import { $, component$, useOn, useSignal, useTask$ } from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";
import { useNavigate } from "@builder.io/qwik-city";
import * as v from "valibot";
import BackButton from "~/components/BackButton";
import TypeTitle from "~/components/TypeTitle";
import { cn } from "~/lib/cn";
import { logApi } from "~/lib/log";
import { animateMotion } from "~/lib/motion-qwik";
import AuthCard from "../../components/auth/AuthCard";

// Note: login now uses a plain POST form to Auth.js credentials callback.

// No server onRequest: this page is fully SSG + client logic

// Simple client-side schema to standardize validation with Valibot
const LoginSchema = v.object({
	username: v.pipe(v.string(), v.minLength(1, "Username is required")),
	password: v.pipe(
		v.string(),
		v.minLength(8, "Password must be at least 8 characters"),
	),
});

export default component$(() => {
	const nav = useNavigate();
	const titleText = useSignal<string>("Log in");
	const eraseKey = useSignal<number | null>(null);
	const formWrap = useSignal<HTMLElement>();
	const authContainer = useSignal<HTMLElement>();
	const descText = useSignal<HTMLElement>();
	const titleStartKey = useSignal<number>(0);
	const emailEditing = useSignal(false);
	const passwordEditing = useSignal(false);

	// Ensure the title types on arrival/resume (belt-and-suspenders with qvisible)
	useTask$(() => {
		try {
			titleStartKey.value = Date.now();
		} catch {
			/* ignore */
		}
	});

	// Motion One: fade/slide in the whole auth area on visibility.
	// Defer the lazy import to idle to keep first paint snappy and avoid
	// competing with route chunk fetches on initial navigation.
	useOn(
		"qvisible",
		$(() => {
			if (typeof window === "undefined") return;
			if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
				return;
			const root = authContainer.value;
			if (!root) return;
			// Prefer requestIdleCallback when available, else fall back to setTimeout
			type W = typeof window & {
				requestIdleCallback?: (
					cb: IdleRequestCallback,
					opts?: { timeout?: number },
				) => number;
			};
			type IdleShim = (cb: () => void) => number;
			const idle: IdleShim = (window as W).requestIdleCallback
				? (cb) => (window as W).requestIdleCallback?.(cb as IdleRequestCallback)
				: (cb) => window.setTimeout(cb, 250);
			idle(() => {
				try {
					void animateMotion(
						root,
						{ opacity: [0, 1], y: [24, 0] },
						{
							duration: 0.45,
							easing: "cubic-bezier(.22,.9,.37,1)",
						},
					);
				} catch {
					/* ignore */
				}
			});
			// Kick the TypeTitle to type on arrival
			try {
				titleStartKey.value = Date.now();
			} catch {
				/* ignore */
			}
			// Ensure any previous title-typing cache is cleared for auth pages
			try {
				const ls = globalThis.localStorage;
				ls?.removeItem("typetitle:/login|Log in");
				ls?.removeItem("typetitle:/signup|Sign Up");
			} catch {
				/* ignore */
			}
		}),
	);

	// Client-only sign-in against gateway
	const submitting = useSignal(false);
	const serverError = useSignal<string | null>(null);

	// no-op task (kept for parity)

	return (
		<main
			id="login-root"
			class="min-h-screen grid place-items-center p-6 pt-20 md:pt-24"
		>
			<div
				class="w-full max-w-2xl"
				ref={(el) => {
					authContainer.value = el;
				}}
			>
				<div class="mb-4">
					<BackButton class="mb-2" fallbackHref="/" />
					<TypeTitle
						text={titleText.value}
						class="text-3xl font-semibold tracking-tight"
						startDelayMs={200}
						speedMs={45}
						cache={false}
						resetOnReload
						suppressTyping={false}
						startKey={titleStartKey.value}
						eraseKey={eraseKey.value}
						onErased$={$(() => {
							/* No-op: immediate nav handled on click */
						})}
					/>
					<p
						class="text-base-content/70 mt-2"
						ref={(el) => {
							descText.value = el as HTMLElement;
						}}
					>
						Welcome back. Please enter your details.
					</p>
				</div>
				<div class="mt-4" ref={formWrap}>
					<AuthCard borderless>
						<form
							id="login-form"
							preventdefault:submit
							method="post"
							onSubmit$={$(async (ev: Event) => {
								try {
									// Resolve the real HTMLFormElement robustly across browsers/Qwik wrappers
									const byId = (globalThis?.document?.getElementById?.(
										"login-form",
									) ?? null) as HTMLFormElement | null;
									const fromCurrent =
										ev.currentTarget as HTMLFormElement | null;
									const fromTargetClosest = ((): HTMLFormElement | null => {
										const t = ev.target as Element | null;
										const found =
											t && typeof t.closest === "function"
												? t.closest("form")
												: null;
										return found && (found as Element).tagName === "FORM"
											? (found as HTMLFormElement)
											: null;
									})();
									const form: HTMLFormElement | null =
										(byId && byId.tagName === "FORM" ? byId : null) ||
										fromCurrent ||
										fromTargetClosest;
									if (!form || !(form instanceof HTMLFormElement)) return;
									serverError.value = null;
									submitting.value = true;
									// Pre-fade for responsiveness (no VTs)
									const el = authContainer.value;
									if (el) el.classList.add("auth-fade-out");
									// Collect credentials
									const fd = new FormData(form);
									const username = String(fd.get("username") || "").trim();
									const password = String(fd.get("password") || "");
									// Validate with Valibot to align with the signup pattern
									const parsed = v.safeParse(LoginSchema, {
										username,
										password,
									});
									if (!parsed.success) {
										const msg =
											parsed.issues?.[0]?.message || "Invalid credentials";
										serverError.value = msg;
										submitting.value = false;
										return;
									}
									// Directly call the gateway (via Traefik) in SSG/prod. The gateway sets a 'session' cookie.
									const res = await fetch("/api/auth/login", {
										method: "POST",
										credentials: "same-origin",
										headers: {
											"Content-Type": "application/json",
											Accept: "application/json",
										},
										body: JSON.stringify({ username, password }),
									});
									if (res.ok) {
										// Mark post-login for profile to refresh session if needed
										try {
											sessionStorage.setItem("postLogin", "1");
										} catch {}
										try {
											await logApi({
												phase: "request",
												url: "/profile/",
												message: "redirect: login success -> /profile",
											});
										} catch {}
										// Navigate to profile
										try {
											await nav("/profile/");
											return;
										} catch {}
										// Safety fallback
										setTimeout(() => {
											try {
												globalThis.location.assign("/profile/");
											} catch {}
										}, 50);
									} else {
										// res.failed true → useSignIn returned a validation or auth error
										try {
											await logApi({
												phase: "error",
												url: "/api/auth/login",
												status: res.status,
												message: "login failed",
											});
										} catch {}
										let message = "Invalid username or password";
										try {
											const errBody = await res.clone().json();
											if (
												errBody &&
												typeof errBody === "object" &&
												"message" in errBody &&
												typeof (errBody as { message?: unknown }).message ===
													"string"
											) {
												message = (errBody as { message: string }).message;
											}
										} catch {}
										serverError.value = message;
									}
								} catch (e: unknown) {
									try {
										await logApi({
											phase: "error",
											url: "/api/auth/login",
											message: `login exception ${String((e as { message?: unknown })?.message ?? e)}`,
										});
									} catch {}
									serverError.value = String(
										(e as { message?: unknown })?.message ?? "Login failed",
									);
								} finally {
									submitting.value = false;
									const el = authContainer.value;
									if (el) el.classList.remove("auth-fade-out");
								}
							})}
						>
							<input type="hidden" name="callbackUrl" value="/profile/" />
							{/* No server-side form action; we call signIn.submit in onSubmit$ */}

							{serverError.value && (
								<div
									class="alert alert-error mb-3"
									role="alert"
									aria-live="polite"
								>
									<span>{serverError.value}</span>
								</div>
							)}

							{/* Removed hidden username decoy to allow browser autofill on the visible field */}

							<div class="form-control">
								<label class="label" for="username">
									<span class="label-text">Username</span>
								</label>
								<input
									id="username"
									name="username"
									type="text"
									placeholder={
										serverError.value && !emailEditing.value
											? serverError.value || "Invalid username or password"
											: "yourusername"
									}
									class={cn(
										"pill-input w-full",
										serverError.value &&
											!emailEditing.value &&
											"is-warning ring-1 ring-warning text-warning",
									)}
									autoComplete="username"
									inputMode="text"
									aria-invalid={
										serverError.value && !emailEditing.value
											? "true"
											: undefined
									}
									onInput$={$(() => {
										emailEditing.value = true;
									})}
									onBlur$={$(() => {
										emailEditing.value = false;
									})}
									required
								/>
							</div>

							<div class="form-control mt-3">
								<label class="label" for="password">
									<span class="label-text">Password</span>
								</label>
								<input
									id="password"
									name="password"
									type="password"
									placeholder={
										serverError.value && !passwordEditing.value
											? serverError.value || "Invalid username or password"
											: "Enter your password"
									}
									class={cn(
										"pill-input w-full",
										serverError.value &&
											!passwordEditing.value &&
											"is-warning ring-1 ring-warning text-warning",
									)}
									autoComplete="current-password"
									minLength={8}
									aria-invalid={
										serverError.value && !passwordEditing.value
											? "true"
											: undefined
									}
									onInput$={$(() => {
										passwordEditing.value = true;
									})}
									onBlur$={$(() => {
										passwordEditing.value = false;
									})}
									required
								/>
							</div>

							<button
								type="submit"
								class="btn-cta w-full mt-5"
								disabled={submitting.value}
								aria-busy={submitting.value}
							>
								{submitting.value ? "Signing in…" : "Login"}
							</button>
						</form>
						{/* Social auth removed as requested */}
						<p class="text-sm text-center mt-6 text-base-content/70">
							Don’t have an account?{" "}
							<a
								href="/signup/"
								class="link"
								preventdefault:click
								onClick$={$((e: Event) => {
									e.preventDefault();
									const el = formWrap.value;
									if (el) {
										// Quick fade for responsiveness
										void animateMotion(
											el,
											{ opacity: [1, 0], y: [0, 8] },
											{
												duration: 0.2,
												easing: "ease-out",
												fill: "forwards",
											},
										);
									}
									const desc = descText.value;
									if (desc) {
										void animateMotion(
											desc,
											{ opacity: [1, 0], y: [0, 6] },
											{
												duration: 0.18,
												easing: "ease-out",
												fill: "forwards",
											},
										);
									}
									// Navigate immediately (no view transitions)
									try {
										void nav("/signup/");
									} catch {
										/* ignore */
									}
									// Fast safety fallback: if SPA nav fails, force navigation
									setTimeout(() => {
										try {
											if (
												(globalThis.location?.pathname || "") === "/login" ||
												(globalThis.location?.pathname || "") === "/login/"
											) {
												globalThis.location.assign("/signup/");
											}
										} catch {
											/* ignore */
										}
									}, 220);
								})}
							>
								Sign Up
							</a>
						</p>
					</AuthCard>
				</div>
			</div>
		</main>
	);
});

export const head: DocumentHead = {
	title: "Log in | Stack",
	meta: [
		{
			name: "description",
			content:
				"Log in to your Stack account to access your profile and personalized features.",
		},
	],
};
