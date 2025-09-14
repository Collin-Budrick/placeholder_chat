import { component$, Slot } from "@builder.io/qwik";

type AuthCardProps = {
	title?: string;
	subtitle?: string;
	error?: boolean;
	borderless?: boolean;
};

const AuthCard = component$((props: AuthCardProps) => {
	const base = "rounded-xl p-0 w-full mx-auto";
	const normal = props.borderless ? "" : "border border-base-content/10";
	const danger = "border border-red-500/60 ring-1 ring-red-500/30";
	return (
		<div class={`${base} ${props.error ? danger : normal}`}>
			{props.title ? (
				<h2 class="mb-2 text-center text-2xl font-semibold">{props.title}</h2>
			) : null}
			{props.subtitle ? (
				<p class="text-base-content/70 mb-4 text-center text-sm">
					{props.subtitle}
				</p>
			) : null}
			<div class="space-y-4 p-4 md:p-6">
				<Slot />
			</div>
		</div>
	);
});

export default AuthCard;
