import { defineConfig } from "vitest/config";
import { PACKAGES } from "../../tooling/temper/thresholds";

export default defineConfig({
	test: {
		coverage: {
			include: ["src/**"],
			reporter: ["text", "json-summary", "json"],
			thresholds: PACKAGES["@ryuujs/generators"].temper,
		},
		environment: "node",
		include: ["tests/**/*.test.ts"],
	},
});
