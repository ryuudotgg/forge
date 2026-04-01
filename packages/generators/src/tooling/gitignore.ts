import type { FileOperation } from "@ryuujs/core";
import { defineGenerator, filePath } from "@ryuujs/core";
import { Effect } from "effect";
import type { ForgeConfig } from "../config";

export default defineGenerator<ForgeConfig>({
	id: "tooling/gitignore",
	name: ".gitignore",
	version: "0.1.0",
	category: "tooling",
	exclusive: false,
	dependencies: [],

	appliesTo: () => true,

	generate: (config) => Effect.succeed(buildOperations(config)),
});

function buildOperations(config: ForgeConfig): ReadonlyArray<FileOperation> {
	const path = filePath(".gitignore");

	const buildLines = ["dist/", ".turbo/", ".cache/"];
	if (config.web === "Next.js") buildLines.push(".next/");
	if (config.mobile) buildLines.push(".expo/");

	return [
		{
			_tag: "AppendLines",
			path,
			lines: ["node_modules/"],
			section: "Dependencies",
		},
		{
			_tag: "AppendLines",
			path,
			lines: buildLines,
			section: "Build",
		},
		{
			_tag: "AppendLines",
			path,
			lines: [".env", ".env.local", ".env*.local"],
			section: "Environment",
		},
		{
			_tag: "AppendLines",
			path,
			lines: [".DS_Store", "Thumbs.db"],
			section: "OS",
		},
	];
}
