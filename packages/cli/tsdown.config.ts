import { defineConfig } from "tsdown";

const isDev = process.env.npm_lifecycle_event === "dev";

export default defineConfig({
	entry: ["./src/**/*.ts"],
	outDir: "dist",

	format: "esm",
	platform: "node",
	target: "esnext",

	dts: false,

	minify: !isDev,
	treeshake: true,
});
