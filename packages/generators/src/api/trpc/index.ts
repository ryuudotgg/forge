import type { FileOperation } from "@ryuujs/core";
import { defineGenerator, filePath } from "@ryuujs/core";
import { Effect } from "effect";
import type { ForgeConfig } from "../../config";
import { deps } from "../../deps";
import { templateFiles } from "../../template";

export default defineGenerator<ForgeConfig>({
	id: "api/trpc",
	name: "tRPC",
	version: "0.1.0",
	category: "addon",
	exclusive: false,
	dependencies: ["frameworks/nextjs", "tooling/typescript"],

	appliesTo: (config) => config.api === "tRPC",

	generate: () => Effect.succeed(buildOperations()),
});

function buildOperations(): ReadonlyArray<FileOperation> {
	const templates = templateFiles("api/trpc", "apps/web");

	return [
		...templates,
		{
			_tag: "AddDependencies",
			path: filePath("apps/web/package.json"),
			dependencies: [
				{ ...deps.trpcServer, type: "dependencies" },
				{ ...deps.trpcClient, type: "dependencies" },
				{ ...deps.trpcReactQuery, type: "dependencies" },
				{ ...deps.tanstackReactQuery, type: "dependencies" },
				{ ...deps.superjson, type: "dependencies" },
			],
		},
	];
}
