declare module "velvette" {
	export interface VelvetteOptions {
		effect?: string;
		onNavigate?: (from: string, to: string) => void;
	}

	const velvette: (options?: VelvetteOptions) => void;
	export default velvette;
}
