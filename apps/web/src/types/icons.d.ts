// TypeScript shim for unplugin-icons virtual modules in Qwik
// Allows imports like `import LuHome from '~icons/lucide/home'`
declare module "~icons/*" {
	// Exported icon components are Qwik components; using 'unknown' here avoids
	// explicit 'any' while keeping flexibility for usage in TSX.
	const component: unknown;
	export default component;
}
