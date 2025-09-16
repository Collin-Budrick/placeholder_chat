import { $, component$, useSignal, useVisibleTask$ } from "@builder.io/qwik";
import { csrfHeader } from "~/lib/csrf";
import { postJson } from "~/lib/http";

const PUSH_ENABLED = import.meta.env.VITE_ENABLE_PUSH === "1";

const hasPushApis = () =>
	typeof window !== "undefined" &&
	"serviceWorker" in navigator &&
	"PushManager" in window &&
	"Notification" in window;

export default component$(() => {
	const supported = useSignal(false);
	const enabled = useSignal(false);
	const busy = useSignal(false);
	const error = useSignal<string | null>(null);
	const hasPermission = useSignal<NotificationPermission>("default");

	useVisibleTask$(async () => {
		if (!hasPushApis()) return;

		supported.value = true;
		if (!PUSH_ENABLED) return;

		try {
			hasPermission.value = Notification.permission;
			const reg = await navigator.serviceWorker.ready;
			const sub = await reg.pushManager.getSubscription();
			enabled.value = !!sub;
		} catch {
			/* ignore */
		}
	});

	const ensureSupported = () => PUSH_ENABLED && supported.value && hasPushApis();

	const doSubscribe = $(async () => {
		if (!ensureSupported()) return;
		busy.value = true;
		error.value = null;
		try {
			if (Notification.permission === "default") {
				try {
					await Notification.requestPermission();
				} catch {
					/* ignore */
				}
			}
			hasPermission.value = Notification.permission;
			if (Notification.permission !== "granted") {
				error.value = "Permission not granted";
				return;
			}
			const reg = await navigator.serviceWorker.ready;
			let key = import.meta.env.VITE_PUSH_PUBLIC_KEY as string | undefined;
			if (!key) {
				try {
					const res = await fetch("/api/push/public-key", {
						headers: { Accept: "application/json" },
					});
					if (res.ok) {
						const j = (await res.json().catch(() => null)) as
							| { publicKey?: string }
							| null;
						if (j && typeof j.publicKey === "string" && j.publicKey.length > 0) {
							key = j.publicKey;
						}
					}
				} catch {
					/* ignore */
				}
			}
			if (!key) {
				error.value = "Missing VAPID public key";
				return;
			}
			const appServerKey = urlBase64ToUint8Array(key);
			const sub = await reg.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: appServerKey,
			});
			await postJson("/api/push/subscribe", sub, {
				headers: { ...csrfHeader() },
			});
			enabled.value = true;
		} catch (e: unknown) {
			const message = (e as { message?: unknown })?.message;
			error.value = String(message ?? e);
		} finally {
			busy.value = false;
		}
	});

	const doUnsubscribe = $(async () => {
		if (!ensureSupported()) return;
		busy.value = true;
		error.value = null;
		try {
			const reg = await navigator.serviceWorker.ready;
			const sub = await reg.pushManager.getSubscription();
			if (sub) {
				try {
					await postJson(
						"/api/push/unsubscribe",
						{ endpoint: sub.endpoint },
						{ headers: { ...csrfHeader() } },
					);
				} catch {
					/* ignore */
				}
				await sub.unsubscribe();
			}
			enabled.value = false;
		} catch (e: unknown) {
			const message = (e as { message?: unknown })?.message;
			error.value = String(message ?? e);
		} finally {
			busy.value = false;
		}
	});

	const pushDisabled = !PUSH_ENABLED || !supported.value;

	return (
		<div class="mt-4">
			<div class="card border border-base-300 bg-base-100">
				<div class="card-body gap-3">
					<h3 class="card-title text-base">Notifications</h3>
					{pushDisabled ? (
						<p class="text-sm opacity-70">Push not supported or disabled.</p>
					) : (
						<>
							<p class="text-sm opacity-80">
								Enable push notifications for updates and messages.
							</p>
							{error.value ? (
								<p class="text-error text-sm">{error.value}</p>
							) : null}
							<div class="flex items-center gap-2">
								{!enabled.value ? (
									<button
										type="button"
										disabled={busy.value}
										onClick$={doSubscribe}
										class="btn btn-primary btn-sm"
									>
										Enable
									</button>
								) : (
									<button
										type="button"
										disabled={busy.value}
										onClick$={doUnsubscribe}
										class="btn btn-outline btn-sm"
									>
										Disable
									</button>
								)}
								<span class="text-xs opacity-70">
									Permission: {hasPermission.value}
								</span>
							</div>
						</>
					)}
				</div>
			</div>
		</div>
	);
});

function urlBase64ToUint8Array(base64String: string) {
	const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
	const rawData = atob(base64);
	const outputArray = new Uint8Array(rawData.length);
	for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
	return outputArray;
}
