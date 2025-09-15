// TypeScript shim for unplugin-icons virtual modules in Qwik
// Allows imports like `import LuHome from "~icons/lucide/home"`
declare module "~icons/*" {
	import type { Component, QwikIntrinsicElements } from "@builder.io/qwik";

	type IconProps = QwikIntrinsicElements["svg"];

	const Icon: Component<IconProps>;
	export default Icon;
}
