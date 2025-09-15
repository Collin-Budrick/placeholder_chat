import type { QRL } from "@builder.io/qwik";
import { Slot, component$ } from "@builder.io/qwik";
import BackButton from "~/components/BackButton";
import TypeTitle from "~/components/TypeTitle";
import { cn } from "~/lib/cn";

type AuthHeaderProps = {
	backHref: string;
	title: string;
	description: string;
	titleStartKey: number;
	eraseKey?: number | null;
	onErased$?: QRL<() => void>;
	setDescription?: (el: HTMLElement | undefined) => void;
	class?: string;
	backClass?: string;
	titleClass?: string;
	descriptionClass?: string;
	startDelayMs?: number;
	speedMs?: number;
	suppressTyping?: boolean;
	cache?: false | "route" | "global";
};

const AuthHeader = component$((props: AuthHeaderProps) => {
	const {
		backHref,
		title,
		description,
		titleStartKey,
		eraseKey,
		onErased$,
		setDescription,
		class: className,
		backClass,
		titleClass,
		descriptionClass,
		startDelayMs = 200,
		speedMs = 45,
		suppressTyping = false,
		cache = false,
	} = props;

	return (
		<div class={cn("mb-4", className)}>
			<BackButton class={cn("mb-2", backClass)} fallbackHref={backHref} />
			<TypeTitle
				text={title}
				class={cn("text-3xl font-semibold tracking-tight", titleClass)}
				startDelayMs={startDelayMs}
				speedMs={speedMs}
				suppressTyping={suppressTyping}
				cache={cache}
				resetOnReload
				startKey={titleStartKey}
				eraseKey={eraseKey}
				onErased$={onErased$}
			/>
			<p
				class={cn("text-base-content/70 mt-2", descriptionClass)}
				ref={(el) => setDescription?.(el ?? undefined)}
			>
				{description}
			</p>
			<Slot />
		</div>
	);
});

export default AuthHeader;
