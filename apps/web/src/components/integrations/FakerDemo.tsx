import { component$ } from "@builder.io/qwik";

export type FakerUser = { id: string; name: string; email: string };

const MAX_USERS = 3;
const SKELETON_SHAPES: Array<{ name: string; email: string }> = [
	{ name: "w-24", email: "w-40" },
	{ name: "w-20", email: "w-36" },
	{ name: "w-28", email: "w-44" },
];

const normalizeUsers = (value: readonly FakerUser[] | undefined): FakerUser[] => {
	if (!Array.isArray(value)) return [];
	return value
		.filter((user): user is FakerUser => {
			if (!user || typeof user !== "object") return false;
			const { id, name, email } = user as Record<string, unknown>;
			return typeof id === "string" && typeof name === "string" && typeof email === "string";
		})
		.slice(0, MAX_USERS);
};

const FakerDemo = component$<{ initialUsers?: readonly FakerUser[] }>(({ initialUsers }) => {
	const users = normalizeUsers(initialUsers);
	const placeholders = Math.max(0, MAX_USERS - users.length);

	return (
		<div class="space-y-2">
			<h2 class="text-xl font-semibold">Faker</h2>
			<ul class="space-y-1.5">
				{users.map((user) => (
					<li key={user.id} class="min-h-[1.75rem]">
						<div class="grid min-h-[1.75rem] grid-cols-[minmax(0,auto)_auto_minmax(0,1fr)] items-center gap-x-2 text-sm text-zinc-300">
							<span class="min-w-0 truncate font-medium">{user.name}</span>
							<span class="text-zinc-500">—</span>
							<span class="min-w-0 truncate text-xs text-zinc-400">{user.email}</span>
						</div>
					</li>
				))}
				{Array.from({ length: placeholders }).map((_, index) => {
					const shape =
						SKELETON_SHAPES[index] ?? SKELETON_SHAPES[SKELETON_SHAPES.length - 1];
					return (
						<li key={`placeholder-${index}`} class="min-h-[1.75rem]">
							<div class="grid min-h-[1.75rem] grid-cols-[minmax(0,auto)_auto_minmax(0,1fr)] items-center gap-x-3">
								<div class={`skeleton h-3 ${shape.name} rounded`}></div>
								<div class="skeleton h-3 w-4 rounded"></div>
								<div class={`skeleton h-3 ${shape.email} rounded`}></div>
							</div>
						</li>
					);
				})}
			</ul>
		</div>
	);
});

export default FakerDemo;

