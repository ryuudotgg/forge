import type { FileOperation } from "@ryuujs/core";
import { defineGenerator, filePath } from "@ryuujs/core";
import { Effect } from "effect";
import type { ForgeConfig } from "../../config";
import { deps } from "../../deps";
import { templateFiles } from "../../template";

export default defineGenerator<ForgeConfig>({
	id: "auth/better-auth",
	name: "better-auth",
	version: "0.1.0",
	category: "auth",
	exclusive: true,
	dependencies: ["frameworks/nextjs", "orm/drizzle"],

	appliesTo: (config) => config.auth === "better-auth",

	generate: () => Effect.succeed(buildOperations()),
});

function buildOperations(): ReadonlyArray<FileOperation> {
	const templates = templateFiles("auth/better-auth", "apps/web");

	return [
		...templates,
		{
			_tag: "AddDependencies",
			path: filePath("apps/web/package.json"),
			dependencies: [{ ...deps.betterAuth, type: "dependencies" }],
		},
		{
			_tag: "AppendLines",
			path: filePath("apps/web/.env"),
			lines: ["BETTER_AUTH_SECRET=", "BETTER_AUTH_URL=http://localhost:3000"],
			section: "Auth",
		},
		{
			_tag: "AppendLines",
			path: filePath("apps/web/.env.example"),
			lines: ["BETTER_AUTH_SECRET=", "BETTER_AUTH_URL=http://localhost:3000"],
			section: "Auth",
		},
	];
}
