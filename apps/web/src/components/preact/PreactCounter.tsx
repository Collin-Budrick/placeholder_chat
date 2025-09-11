/** @jsxImportSource react */
// React-compatible Preact component (runs via preact/compat)
import { useState } from "preact/hooks";

export function PreactCounter({ initial = 0 }: { initial?: number }) {
	const [count, setCount] = useState<number>(initial);
	return (
		<div class="card bg-base-200 shadow-sm">
			<div class="card-body items-center text-center">
				<h2 class="card-title">Preact Island</h2>
				<p class="text-sm opacity-70">
					This interactive counter runs with Preact.
				</p>
				<div class="join mt-2">
					<button
						type="button"
						class="btn join-item"
						onClick={() => setCount((c: number) => c - 1)}
					>
						-
					</button>
					<button
						type="button"
						class="btn btn-ghost join-item no-animation pointer-events-none"
					>
						{count}
					</button>
					<button
						type="button"
						class="btn join-item btn-primary"
						onClick={() => setCount((c: number) => c + 1)}
					>
						+
					</button>
				</div>
			</div>
		</div>
	);
}

export default PreactCounter;
