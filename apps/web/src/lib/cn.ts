import { twJoin, twMerge } from "tailwind-merge";

// Small helper to compose Tailwind/DaisyUI classes with conflict resolution.
// Accepts the same inputs as twJoin and then resolves conflicts via twMerge.
export function cn(
	...inputs: Array<Parameters<typeof twJoin>[number]>
): string {
	return twMerge(twJoin(...inputs));
}
