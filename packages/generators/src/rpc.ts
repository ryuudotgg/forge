import type { ForgeConfig, RpcProvider, WebFramework } from "./config";

export type RpcHostFramework =
	| "nextjs"
	| "react-router"
	| "tanstack-start"
	| "hono"
	| "express"
	| "fastify";

export type RpcClientFramework = WebFramework | "expo";

export interface RpcDescriptor {
	readonly client: { readonly component: string; readonly module: string };
	readonly routes: { readonly module: string; readonly register: string };
	readonly support: {
		readonly hosts: Readonly<Record<RpcHostFramework, boolean>>;
		readonly clients: Readonly<Record<RpcClientFramework, boolean>>;
	};
}

export const rpcDescriptors: { readonly [Id in RpcProvider]: RpcDescriptor } = {
	trpc: {
		client: { component: "TRPCReactProvider", module: "@/trpc/react" },
		routes: { module: "./routes/trpc.js", register: "registerTrpcRoutes" },
		support: {
			hosts: {
				nextjs: true,
				"react-router": true,
				"tanstack-start": true,
				hono: true,
				express: true,
				fastify: true,
			},
			clients: {
				nextjs: true,
				"react-router": true,
				"tanstack-router": true,
				"tanstack-start": true,
				expo: true,
			},
		},
	},
	orpc: {
		client: { component: "ORPCReactProvider", module: "@/orpc/react" },
		routes: { module: "./routes/orpc.js", register: "registerOrpcRoutes" },
		support: {
			hosts: {
				nextjs: false,
				"react-router": true,
				"tanstack-start": true,
				hono: true,
				express: true,
				fastify: true,
			},
			clients: {
				nextjs: true,
				"react-router": true,
				"tanstack-router": true,
				"tanstack-start": true,
				expo: false,
			},
		},
	},
};

export function rpcDescriptor(config: ForgeConfig): RpcDescriptor | undefined {
	return config.rpc === undefined ? undefined : rpcDescriptors[config.rpc];
}

export function rpcProviderTemplate(template: string, id: RpcProvider): string {
	if (id === "trpc") return template;

	let rendered = template;
	for (const anchor of ["trpc?: ElementType", "dataProviders.trpc"]) {
		if (rendered.split(anchor).length !== 2)
			throw new Error(`Template Anchor Not Unique: ${anchor}`);

		rendered = rendered.replace(anchor, anchor.replace("trpc", id));
	}

	return rendered;
}
