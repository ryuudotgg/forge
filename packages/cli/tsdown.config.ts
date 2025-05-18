import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["./src/index.ts"],
	outDir: "dist",

	format: "esm",
	platform: "node",
	target: "esnext",

	dts: {
		sourcemap: true,
		compilerOptions: { isolatedDeclarations: true },
	},

	minify: true,
	treeshake: true,
});
