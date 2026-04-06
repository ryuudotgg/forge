import type { FileOperation } from "@ryuujs/core";
import { defineGenerator, filePath } from "@ryuujs/core";
import { Effect } from "effect";
import type { ForgeConfig } from "../../config";
import { deps } from "../../deps";
import { templateFiles } from "../../template";

export default defineGenerator<ForgeConfig>({
	id: "orm/drizzle",
	name: "Drizzle",
	version: "0.1.0",
	category: "orm",
	exclusive: true,
	dependencies: ["tooling/typescript"],

	appliesTo: (config) => config.orm === "Drizzle",

	generate: () => Effect.succeed(buildOperations()),
});

function buildOperations(): ReadonlyArray<FileOperation> {
	const templates = templateFiles("orm/drizzle", "apps/web");

	return [
		...templates,
		{
			_tag: "AddDependencies",
			path: filePath("apps/web/package.json"),
			dependencies: [
				{ ...deps.drizzleOrm, type: "dependencies" },
				{ ...deps.neonServerless, type: "dependencies" },
				{ ...deps.drizzleKit, type: "devDependencies" },
			],
		},
		{
			_tag: "AddScripts",
			path: filePath("apps/web/package.json"),
			scripts: {
				"db:generate": "drizzle-kit generate",
				"db:migrate": "drizzle-kit migrate",
				"db:push": "drizzle-kit push",
				"db:studio": "drizzle-kit studio",
			},
		},
		{
			_tag: "AppendLines",
			path: filePath("apps/web/.env"),
			lines: ["DATABASE_URL="],
			section: "Database",
		},
		{
			_tag: "AppendLines",
			path: filePath("apps/web/.env.example"),
			lines: ["DATABASE_URL="],
			section: "Database",
		},
	];
}
