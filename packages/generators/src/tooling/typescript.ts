import type { FileOperation } from "@ryuujs/core";
import { defineGenerator, filePath } from "@ryuujs/core";
import { Effect } from "effect";
import type { ForgeConfig } from "../config";
import { deps } from "../deps";

export default defineGenerator<ForgeConfig>({
	id: "tooling/typescript",
	name: "TypeScript",
	version: "0.1.0",
	category: "tooling",
	exclusive: false,
	dependencies: [],

	appliesTo: () => true,

	generate: () => Effect.succeed(buildOperations()),
});

function buildOperations(): ReadonlyArray<FileOperation> {
	return [
		{
			_tag: "CreateFile",
			path: filePath("tsconfig.json"),
			content: `${JSON.stringify(
				{
					$schema: "https://json.schemastore.org/tsconfig",
					compilerOptions: {
						target: "ES2022",
						lib: ["ES2022"],
						module: "preserve",
						moduleResolution: "bundler",
						resolveJsonModule: true,
						verbatimModuleSyntax: true,
						strict: true,
						noUncheckedIndexedAccess: true,
						noEmit: true,
						esModuleInterop: true,
						isolatedModules: true,
						skipLibCheck: true,
						declaration: true,
						declarationMap: true,
						sourceMap: true,
						incremental: true,
						tsBuildInfoFile: ".cache/tsbuildinfo.json",
					},
					exclude: ["node_modules", "dist", ".next", ".turbo"],
				},
				null,
				"\t",
			)}\n`,
			overwrite: false,
		},
		{
			_tag: "AddDependencies",
			path: filePath("package.json"),
			dependencies: [{ ...deps.typescript, type: "devDependencies" }],
		},
	];
}
