import { PACKAGES } from "@ryuugg/temper/thresholds";
import { defineConfig } from "vitest/config";

const { perFileOverrides, ...thresholds } =
	PACKAGES["@ryuugg/generators"].temper;

export default defineConfig({
	test: {
		environment: "node",
		include: ["tests/**/*.test.ts"],
		coverage: {
			include: ["src/**"],
			reporter: ["text", "json-summary", "json"],
			thresholds: { ...thresholds, ...perFileOverrides },
		},
	},
});
