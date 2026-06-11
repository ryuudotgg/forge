import { defineConfig } from "vitest/config";
import { PACKAGES } from "../../scripts/temper";

export default defineConfig({
	test: {
		coverage: {
			include: ["src/**"],
			reporter: ["text", "json-summary", "json"],
			thresholds: PACKAGES["@ryuujs/generators"].temper,
		},
		environment: "node",
		include: ["test/**/*.test.ts"],
	},
});
