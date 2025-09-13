import { component$, Slot, useSignal, useVisibleTask$ } from "@builder.io/qwik";
import type { RequestHandler } from "@builder.io/qwik-city";
import { useNavigate } from "@builder.io/qwik-city";
import { logApi } from "~/lib/log";

// SSG-only: do not run server redirects for admin during static generation.
// Client-side gate in this file handles auth/role checks after hydration.
export const onRequest: RequestHandler = () => {};

export default component$(() => {
	const nav = useNavigate();
	const ready = useSignal(false);

	// Client-side gate for SSG: validate session and admin role via gateway
	useVisibleTask$(async () => {
		const from =
			(globalThis?.location?.pathname || "/admin") +
			(globalThis?.location?.search || "");
		try {
			const res = await fetch("/api/auth/me", {
				credentials: "same-origin",
				headers: { Accept: "application/json" },
			});
			if (res.ok) {
				const user = await res.json().catch(() => null);
				const role =
					user && typeof user === "object"
						? (user.role as string | undefined)
						: undefined;
				if (role === "admin") {
					ready.value = true;
					try {
						await logApi({
							phase: "response",
							url: "/api/auth/me",
							status: res.status,
							client: { path: from },
							message: "admin: allow",
						});
					} catch {}
					return;
				}
				try {
					await logApi({
						phase: "error",
						url: "/api/auth/me",
						status: res.status,
						client: { path: from },
						message: "admin: not-admin",
					});
				} catch {}
			} else {
				try {
					await logApi({
						phase: "error",
						url: "/api/auth/me",
						status: res.status,
						client: { path: from },
						message: "admin: unauthorized",
					});
				} catch {}
			}
		} catch (e: unknown) {
			try {
				await logApi({
					phase: "error",
					url: "/api/auth/me",
					client: { path: from },
					message: `admin: session check failed ${String((e as { message?: unknown })?.message ?? e)}`,
				});
			} catch {}
		}
		const to = `/login?callbackUrl=${encodeURIComponent(from)}`;
		try {
			await logApi({
				phase: "request",
				url: to,
				client: { path: from },
				message: "redirect: admin -> login",
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

	return (
		<>
			{ready.value ? (
				<Slot />
			) : (
				<main class="grid min-h-screen place-items-center p-6" aria-busy>
					<div class="text-base-content/70 text-sm">Checking admin access…</div>
				</main>
			)}
		</>
	);
});
