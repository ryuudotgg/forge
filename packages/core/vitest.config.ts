import { defineConfig } from "vitest/config";
import { PACKAGES } from "../../tooling/temper/thresholds";

const { perFileOverrides, ...thresholds } = PACKAGES["@ryuujs/core"].temper;

export default defineConfig({
	test: {
		coverage: {
			include: ["src/**"],
			reporter: ["text", "json-summary", "json"],
			thresholds: { ...thresholds, ...perFileOverrides },
		},
		environment: "node",
		include: ["tests/**/*.test.ts"],
	},
});
