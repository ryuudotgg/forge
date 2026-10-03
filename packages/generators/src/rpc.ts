import type { ForgeConfig, RpcProvider } from "./config";

export interface RpcDescriptor {
	readonly client: { readonly component: string; readonly module: string };
	readonly routes: { readonly module: string; readonly register: string };
}

export const rpcDescriptors: { readonly [Id in RpcProvider]: RpcDescriptor } = {
	trpc: {
		client: { component: "TRPCReactProvider", module: "@/trpc/react" },
		routes: { module: "./routes/trpc.js", register: "registerTrpcRoutes" },
	},
};

export function rpcDescriptor(config: ForgeConfig): RpcDescriptor | undefined {
	return config.rpc === undefined ? undefined : rpcDescriptors[config.rpc];
}
