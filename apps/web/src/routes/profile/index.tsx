import { $, component$, useSignal, useVisibleTask$ } from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";
import { Link, useNavigate } from "@builder.io/qwik-city";
import { csrfHeader } from "~/lib/csrf";
import { logApi } from "~/lib/log";
import { AuthCard } from "../../components/auth/AuthCard";
export const prerender = true;

export default component$(() => {
	const nav = useNavigate();

	// SSG-only gate using resumability: reveal after confirming a session client-side.
	const show = useSignal(false);
	const displayName = useSignal<string>("there");
	const role = useSignal<string | null>(null);

	useVisibleTask$(async () => {
		const from =
			(globalThis?.location?.pathname || "/profile") +
			(globalThis?.location?.search || "");
		try {
			const res = await fetch("/api/auth/me", {
				credentials: "same-origin",
				headers: { Accept: "application/json" },
			});
			if (res.ok) {
				const user = await res.json().catch(() => null);
				if (user && typeof user === "object") {
					// Derive display name: prefer username, else email local part
					const uname = (user.username && String(user.username)) || "";
					const email = (user.email && String(user.email)) || "";
					displayName.value = uname || (email ? email.split("@")[0] : "there");
					role.value = (user.role && String(user.role)) || null;
				}
				try {
					await logApi({
						phase: "response",
						url: "/api/auth/me",
						status: res.status,
						client: { path: from },
						message: "profile: session ok",
					});
				} catch {}
				show.value = true;
				try {
					sessionStorage.removeItem("postLogin");
				} catch {}
				return;
			}
			// Not authorized
			try {
				await logApi({
					phase: "error",
					url: "/api/auth/me",
					status: res.status,
					client: { path: from },
					message: "profile: unauthorized, redirect to login",
				});
			} catch {}
		} catch (e: unknown) {
			try {
				await logApi({
					phase: "error",
					url: "/api/auth/me",
					client: { path: from },
					message: `profile: session check failed ${String((e as { message?: unknown })?.message ?? e)}`,
				});
			} catch {}
		}
		// Redirect to login with callback
		const to = `/login?callbackUrl=${encodeURIComponent(from)}`;
		try {
			await logApi({
				phase: "request",
				url: to,
				client: { path: from },
				message: "redirect: profile -> login",
			});
		} catch {}
		try {
			await nav(to);
		} catch {
			try {
				location.replace(to);
			} catch {}
		}
	});

	// Render SSG markup; reveal content once `show` is true after resume.
	return (
		<main class="min-h-screen flex items-center justify-center p-6">
			{show.value ? (
				<AuthCard title="Profile">
					<h3 class="text-xl font-semibold text-center mb-2">
						Hi {displayName.value}
					</h3>
					<p class="text-sm text-center text-slate-200 mb-4">
						Manage your account
					</p>

					<div class="text-sm text-slate-200 mb-4">
						You are logged in.
						{role.value && (
							<div class="mt-2">
								<span class="badge badge-outline mr-2">Role: {role.value}</span>
							</div>
						)}
					</div>

					<button
						type="button"
						class="btn btn-secondary w-full"
						aria-label="Logout"
						onClick$={$(async () => {
							try {
								// If we have the gateway token in the session, call the backend logout endpoint
								// Use same-origin credentials so cookie-backed sessions (if present) are sent
								await fetch("/api/auth/logout", {
									method: "POST",
									headers: { ...csrfHeader() },
									credentials: "same-origin",
								});
								try {
									await logApi({
										phase: "request",
										url: "/login",
										message: "redirect: logout -> login",
									});
								} catch {}
							} catch (err) {
								// best-effort: ignore network errors and proceed to clear Auth.js session
								console.debug("backend logout failed", err);
							}
							// Navigate to login
							try {
								await nav("/login");
							} catch {
								try {
									location.assign("/login");
								} catch {}
							}
						})}
					>
						Logout
					</button>

					{role.value === "admin" && (
						<div class="mt-4">
							<Link
								href="/admin/users/"
								class="btn btn-outline btn-sm w-full"
								aria-label="Manage Users"
							>
								Manage Users
							</Link>
						</div>
					)}
				</AuthCard>
			) : (
				<output
					class="text-sm text-base-content/70"
					aria-busy="true"
					aria-live="polite"
				>
					Loading your profile…
				</output>
			)}
		</main>
	);
});

export const head: DocumentHead = {
	title: "Your Profile | Stack",
	meta: [
		{
			name: "description",
			content:
				"View and manage your Stack profile, account details, and settings.",
		},
	],
};
