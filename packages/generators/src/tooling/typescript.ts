import {
	defineAddon,
	projectTarget,
	surfaceDependencies,
	surfaceJson,
} from "@ryuujs/core";
import type { ForgeConfig } from "../config";
import { deps } from "../deps";

const typescript = defineAddon<ForgeConfig, "typescript">({
	id: "typescript",
	name: "TypeScript",
	version: "0.1.0",
	category: "tooling",
	exclusive: false,
	targetMode: "single",
	when: () => true,
	contribute: () => [
		surfaceJson(projectTarget(), "rootTsconfig", {
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
		}),
		surfaceDependencies(projectTarget(), "rootPackageJson", [
			{ ...deps.typescript, type: "devDependencies" },
		]),
	],
});

export default typescript;
