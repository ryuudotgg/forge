import { defineConfig } from "tsdown";

const isDev = process.env.npm_lifecycle_event === "dev";

export default defineConfig({
	entry: ["./src/index.ts"],
	outDir: "dist",

	format: "esm",
	platform: "node",
	target: "esnext",

	clean: ["dist", "templates"],
	dts: false,

	minify: !isDev,
	treeshake: true,

	deps: { onlyBundle: false },
	copy: { from: "../generators/templates", to: "." },

	onSuccess: isDev ? "pnpm start" : undefined,
});
