import {
	defineAddon,
	leafTextFile,
	selectedModuleTarget,
	surfaceDependencies,
} from "@ryuujs/core";
import type { ForgeConfig } from "../../config";
import { deps } from "../../deps";
import { readTemplate } from "../../template";

const trpc = defineAddon<ForgeConfig, "trpc", "nextjs">({
	id: "trpc",
	name: "tRPC",
	version: "0.1.0",
	category: "addon",
	exclusive: false,
	dependencies: [
		{ id: "nextjs/base", type: "template" },
		{ id: "typescript", type: "addon" },
	],
	targetMode: "single",
	compatibility: {
		app: {
			frameworks: ["nextjs"],
			requiredSlots: ["trpc"],
			templates: [{ id: "nextjs/base", version: 1 }],
		},
	},
	when: (config) => config.rpc === "trpc",
	contribute: () => [
		leafTextFile(
			selectedModuleTarget(),
			"app/api/trpc/[trpc]/route.ts",
			readTemplate("api/trpc/app/api/trpc/[trpc]/route.ts"),
		),
		leafTextFile(
			selectedModuleTarget(),
			"src/trpc/index.ts",
			readTemplate("api/trpc/src/trpc/index.ts"),
		),
		leafTextFile(
			selectedModuleTarget(),
			"src/trpc/query-client.ts",
			readTemplate("api/trpc/src/trpc/query-client.ts"),
		),
		leafTextFile(
			selectedModuleTarget(),
			"src/trpc/react.tsx",
			readTemplate("api/trpc/src/trpc/react.tsx"),
		),
		leafTextFile(
			selectedModuleTarget(),
			"src/trpc/root.ts",
			readTemplate("api/trpc/src/trpc/root.ts"),
		),
		leafTextFile(
			selectedModuleTarget(),
			"src/trpc/server.tsx",
			readTemplate("api/trpc/src/trpc/server.tsx"),
		),
		leafTextFile(
			selectedModuleTarget(),
			"src/trpc/trpc.ts",
			readTemplate("api/trpc/src/trpc/trpc.ts"),
		),
		surfaceDependencies(selectedModuleTarget(), "packageJson", [
			{ ...deps.trpcServer, type: "dependencies" },
			{ ...deps.trpcClient, type: "dependencies" },
			{ ...deps.trpcReactQuery, type: "dependencies" },
			{ ...deps.tanstackReactQuery, type: "dependencies" },
			{ ...deps.superjson, type: "dependencies" },
		]),
	],
});

export default trpc;
