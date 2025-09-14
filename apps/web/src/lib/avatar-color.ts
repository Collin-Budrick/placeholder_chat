export function pastelFor(name: string): string {
	const key = (name || "?").trim();
	let h = 0 >>> 0;
	for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
	const pastels = [
		"#FDE68A", // amber-300
		"#BFDBFE", // blue-200
		"#C7D2FE", // indigo-200
		"#FBCFE8", // pink-200
		"#A7F3D0", // emerald-300
		"#DDD6FE", // violet-200
		"#FEF3C7", // amber-200
		"#FECACA", // red-200
	];
	return pastels[h % pastels.length];
}
