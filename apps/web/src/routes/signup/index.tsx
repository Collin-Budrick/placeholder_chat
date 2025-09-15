import { $, component$, useSignal } from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";
import { Link, routeLoader$, useNavigate } from "@builder.io/qwik-city";
import { type InitialValues, useForm, valiForm$ } from "@modular-forms/qwik";
import * as v from "valibot";
import AuthCard from "../../components/auth/AuthCard";
import { csrfHeader } from "../../lib/csrf";
import { api, apiFetch } from "../../lib/http";
import AuthHeader from "~/components/auth/AuthHeader";
import { useAuthPage } from "~/components/auth/useAuthPage";
import { cn } from "~/lib/cn";
import { animateMotion } from "~/lib/motion-qwik";

const SignupSchema = v.object({
	username: v.pipe(
		v.string(),
		v.minLength(2, "Username must have 2 characters or more."),
	),
	email: v.pipe(v.string(), v.email("The email address is badly formatted.")),
	password: v.pipe(
		v.string(),
		v.minLength(8, "Your password must have 8 characters or more."),
	),
});

type SignupForm = v.InferInput<typeof SignupSchema>;

export const useFormLoader = routeLoader$<InitialValues<SignupForm>>(() => ({
	username: "",
	email: "",
	password: "",
}));

export default component$(() => {
	const nav = useNavigate();
	const auth = useAuthPage({ title: "Sign Up" });

	const [, { Form: MForm, Field }] = useForm<SignupForm>({
		loader: useFormLoader(),
		validate: valiForm$(SignupSchema),
	});

	// username availability signals
	const checkingUsername = useSignal(false);
	const usernameAvailable = useSignal<boolean | null>(null);
	const usernameTryLater = useSignal(false);
	const usernameTimer = useSignal<number | null>(null);
	const usernameCurrent = useSignal("");
	const usernameEditing = useSignal(false);
	const cardError = useSignal(false);
	const usernameTaken = useSignal(false);
	const emailTaken = useSignal(false);
	const emailEditing = useSignal(false);
	const passwordEditing = useSignal(false);

	// submission state for the signup form
	const submitting = useSignal(false);
	const serverError = useSignal<string | null>(null);

	const checkUsername = $(async (value?: string) => {
		if (!value || value.trim().length < 2) {
			usernameAvailable.value = null;
			usernameTryLater.value = false;
			serverError.value = null;
			cardError.value = false;
			return;
		}
		checkingUsername.value = true;
		usernameTryLater.value = false;
		try {
			const res = await api<{ available: boolean }>(
				"/api/auth/check_username",
				{
					query: { u: value.trim() },
				},
			);
			usernameAvailable.value = !!res.available;
			usernameTaken.value = false;
			if (usernameAvailable.value) cardError.value = false;
			serverError.value = null;
		} catch (err: unknown) {
			const status =
				(err as { status?: number; response?: { status?: number } })?.status ??
				(err as { status?: number; response?: { status?: number } })?.response?.status ??
				null;
			if (status === 429) {
				usernameAvailable.value = null;
				usernameTryLater.value = true;
				serverError.value = "Server busy — please try again in a moment.";
				cardError.value = true;
			} else {
				usernameAvailable.value = null;
				usernameTryLater.value = false;
				serverError.value = "Unable to check username right now.";
				cardError.value = true;
			}
		} finally {
			checkingUsername.value = false;
		}
	});

	const onSubmit$ = $(async (values: SignupForm) => {
		await new Promise((resolve) => setTimeout(resolve, 0));
		submitting.value = true;
		try {
			if (usernameAvailable.value === false) {
				cardError.value = true;
				submitting.value = false;
				usernameTaken.value = true;
				serverError.value = "Username already taken";
				return;
			}
			serverError.value = null;
			const res = await apiFetch("/api/auth/signup", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
					...csrfHeader(),
				},
				credentials: "same-origin",
				body: JSON.stringify(values),
			});
			const ct = res.headers.get("content-type") || "";
			const isJSON = ct.includes("application/json");
			let parsed: unknown = null;
			if (isJSON) {
				try {
					parsed = await res.json();
				} catch {
					parsed = null;
				}
			} else {
				try {
					const txt = await res.text();
					parsed = { text: txt };
				} catch {
					/* ignore */
				}
			}

			if (res.ok) {
				submitting.value = false;
				cardError.value = false;
				usernameTaken.value = false;
				emailTaken.value = false;
				try {
					globalThis.location.assign("/profile");
				} catch {
					await nav("/profile");
				}
				return;
			}

			const body: { message?: string; error?: string } | null =
				isJSON && parsed && typeof parsed === "object"
					? (parsed as { message?: string; error?: string })
					: null;
			const msg =
				body?.message ??
				body?.error ??
				(res.status === 409
					? "Username or email already taken"
					: `Signup failed (status ${res.status})`);
			serverError.value = msg;
			if (res.status === 409) {
				const lower = String(body?.message || body?.error || "").toLowerCase();
				if (lower.includes("username")) {
					usernameTaken.value = true;
					cardError.value = true;
					usernameAvailable.value = false;
				} else if (lower.includes("email")) {
					emailTaken.value = true;
					cardError.value = true;
				}
			}
		} catch {
			serverError.value = "Network error during signup";
		} finally {
			submitting.value = false;
		}
	});

	return (
		<main
			id="signup-root"
			class="grid min-h-screen place-items-center p-6 pt-20 md:pt-24"
		>
			<div class="w-full max-w-2xl" ref={auth.setAuthContainer}>
				<AuthHeader
					backHref="/login"
					title={auth.titleText.value}
					description="Create your account. Please enter your details."
					titleStartKey={auth.titleStartKey.value}
					eraseKey={auth.eraseKey.value}
					setDescription={auth.setDescription}
				/>
				<div class="mt-4" ref={auth.setFormWrap}>
					<AuthCard borderless error={cardError.value}>
						<MForm onSubmit$={onSubmit$}>
							{serverError.value ? (
								<div class="alert alert-error mb-3" role="alert">
									<span>{serverError.value}</span>
								</div>
							) : null}
							<Field name="username">
								{(field, props) => (
									<div class="form-control">
										<label
											class="label"
											aria-label="Username"
											for={(props as { id?: string })?.id ?? undefined}
										>
											<span class="label-text">Username</span>
										</label>
										<input
											{...props}
											name="username"
											type="text"
											placeholder={
												!usernameEditing.value &&
												(usernameAvailable.value === false ||
													usernameTaken.value)
													? "Username already taken"
													: !usernameEditing.value && field.error
														? field.error
														: "Choose a username"
											}
											class={cn(
												"pill-input w-full",
												!usernameEditing.value &&
													(usernameAvailable.value === false ||
														usernameTaken.value ||
														!!field.error) &&
													"is-warning ring-warning text-warning ring-1",
											)}
											required
											minLength={2}
											aria-invalid={
												!usernameEditing.value &&
												(usernameAvailable.value === false ||
													usernameTaken.value ||
													!!field.error)
													? "true"
													: undefined
											}
											autoComplete="username"
											inputMode="text"
											autoCapitalize="off"
											autoCorrect="off"
											spellcheck={false}
											onBlur$={$((e: Event, el?: Element) => {
												try {
													if ("onBlur$" in props) {
														const fn = (
															props as unknown as {
																onBlur$?: (e: Event, el?: Element) => void;
															}
														).onBlur$;
														fn?.(e, el);
													}
												} catch {
													/* ignore */
												}
												usernameEditing.value = false;
												checkUsername((e.target as HTMLInputElement).value);
											})}
											onInput$={$((e: Event, el?: Element) => {
												try {
													if ("onInput$" in props) {
														const fn = (
															props as unknown as {
																onInput$?: (e: Event, el?: Element) => void;
															}
														).onInput$;
														fn?.(e, el);
													}
												} catch {
													/* ignore */
												}
												usernameEditing.value = true;
												usernameCurrent.value = (
													e.target as HTMLInputElement
												).value;
												serverError.value = null;
												cardError.value = false;
												usernameTryLater.value = false;
												usernameTaken.value = false;
												usernameAvailable.value = null;
												if (usernameTimer.value) {
													clearTimeout(usernameTimer.value);
													usernameTimer.value = null;
												}
												usernameTimer.value = setTimeout(() => {
													checkUsername((e.target as HTMLInputElement).value);
													usernameTimer.value = null;
												}, 300) as unknown as number;
											})}
										/>
										{/* Error text moved into placeholder; no below-field error */}
									</div>
								)}
							</Field>

							<Field name="email">
								{(field, props) => (
									<div class="form-control">
										<label
											class="label"
											aria-label="Email"
											for={(props as { id?: string })?.id ?? undefined}
										>
											<span class="label-text">Email</span>
										</label>
										<input
											{...props}
											name="email"
											type="email"
											placeholder={
												emailTaken.value
													? "Email already taken"
													: !!field.error && !emailEditing.value
														? field.error
														: "you@example.com"
											}
											class={`pill-input w-full ${
												emailTaken.value || (!!field.error && !emailEditing.value)
													? "is-warning ring-warning text-warning ring-1"
													: ""
											}`}
											aria-invalid={
												emailTaken.value || (!!field.error && !emailEditing.value)
													? "true"
													: undefined
											}
											required
											autoComplete="email"
											onInput$={$((e: Event, el?: Element) => {
												try {
													if ("onInput$" in props) {
														const fn = (
															props as unknown as {
																onInput$?: (e: Event, el?: Element) => void;
															}
														).onInput$;
														fn?.(e, el);
													}
												} catch {
													/* ignore */
												}
												emailEditing.value = true;
												emailTaken.value = false;
												serverError.value = null;
												cardError.value = false;
											})}
											onBlur$={$((e: Event, el?: Element) => {
												try {
													if ("onBlur$" in props) {
														const fn = (
															props as unknown as {
																onBlur$?: (e: Event, el?: Element) => void;
															}
														).onBlur$;
														fn?.(e, el);
													}
												} catch {
													/* ignore */
												}
												emailEditing.value = false;
											})}
										/>
									</div>
								)}
							</Field>

							<Field name="password">
								{(field, props) => (
									<div class="form-control">
										<label
											class="label"
											aria-label="Password"
											for={(props as { id?: string })?.id ?? undefined}
										>
											<span class="label-text">Password</span>
										</label>
										<input
											{...props}
											name="password"
											type="password"
											placeholder={
												field.error && !passwordEditing.value
													? field.error
													: "Create a password"
											}
											class={cn(
												"pill-input w-full",
												!passwordEditing.value && field.error &&
													"is-warning ring-warning text-warning ring-1",
											)}
											required
											minLength={8}
											autoComplete="new-password"
											onInput$={$((e: Event, el?: Element) => {
												try {
													if ("onInput$" in props) {
														const fn = (
															props as unknown as {
																onInput$?: (e: Event, el?: Element) => void;
															}
														).onInput$;
														fn?.(e, el);
													}
												} catch {
													/* ignore */
												}
												passwordEditing.value = true;
											})}
											onBlur$={$((e: Event, el?: Element) => {
												try {
													if ("onBlur$" in props) {
														const fn = (
															props as unknown as {
																onBlur$?: (e: Event, el?: Element) => void;
															}
														).onBlur$;
														fn?.(e, el);
													}
												} catch {
													/* ignore */
												}
												passwordEditing.value = false;
											})}
										/>
									</div>
								)}
							</Field>

							<button
								type="submit"
								class="btn-cta mt-5 w-full"
								disabled={submitting.value}
								aria-busy={submitting.value}
							>
								{submitting.value ? "Signing up…" : "Sign Up"}
							</button>
						</MForm>

						{/* Social auth removed as requested */}

						<p class="mt-3 text-center text-sm">
							Already have an account?{" "}
							<a
								href="/login/"
								class="link"
								preventdefault:click
								onClick$={$((e: Event) => {
									e.preventDefault();
									const el = auth.formWrap.value;
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
									const desc = auth.description.value;
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
										void nav("/login/");
									} catch {
										/* ignore */
									}
									// Fast safety fallback: if SPA nav fails, force navigation
									setTimeout(() => {
										try {
											const path = globalThis.location?.pathname || "";
											if (path === "/signup" || path === "/signup/") {
												globalThis.location.assign("/login/");
											}
										} catch {
											/* ignore */
										}
									}, 220);
								})}
							>
								Login
							</a>
						</p>
						{/* Hidden prefetch for frequent next route */}
						<Link
							href="/login/"
							prefetch="js"
							class="hidden"
							aria-hidden="true"
						/>
					</AuthCard>
				</div>
			</div>
		</main>
	);
});

export const head: DocumentHead = {
	title: "Sign Up | Stack",
	meta: [
		{
			name: "description",
			content:
				"Create your Stack account to start building and personalize your experience.",
		},
	],
};
