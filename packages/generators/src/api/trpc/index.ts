import { defineAddon, dependencies, filePath } from "@ryuujs/core";
import type { ForgeConfig } from "../../config";
import { deps } from "../../deps";
import { templateFiles } from "../../template";

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
		...templateFiles("api/trpc", "apps/web"),
		dependencies(filePath("apps/web/package.json"), [
			{ ...deps.trpcServer, type: "dependencies" },
			{ ...deps.trpcClient, type: "dependencies" },
			{ ...deps.trpcReactQuery, type: "dependencies" },
			{ ...deps.tanstackReactQuery, type: "dependencies" },
			{ ...deps.superjson, type: "dependencies" },
		]),
	],
});

export default trpc;
