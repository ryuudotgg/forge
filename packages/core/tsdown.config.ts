import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["./src/index.ts"],
	outDir: "dist",

	format: "esm",
	platform: "node",
	target: "esnext",

	dts: { tsconfig: "./tsconfig.build.json" },

	minify: false,
	treeshake: true,
});
