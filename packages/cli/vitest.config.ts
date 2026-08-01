import { PACKAGES } from "@ryuujs/temper/thresholds";
import { defineConfig } from "vitest/config";

const { perFileOverrides, ...thresholds } = PACKAGES["@ryuujs/forge"].temper;

export default defineConfig({
	test: {
		environment: "node",
		env: { NO_COLOR: "1" },
		include: ["tests/**/*.test.ts"],
		coverage: {
			include: ["src/**"],
			reporter: ["text", "json-summary", "json"],
			thresholds: { ...thresholds, ...perFileOverrides },
		},
	},
});
