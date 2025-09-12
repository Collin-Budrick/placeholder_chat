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
			{props.title && (
				<h2 class="text-2xl font-semibold text-center mb-2">{props.title}</h2>
			)}
			{props.subtitle && (
				<p class="text-sm text-center text-base-content/70 mb-4">
					{props.subtitle}
				</p>
			)}
			<div class="space-y-4 p-4 md:p-6">
				<Slot />
			</div>
		</div>
	);
});

export default AuthCard;
