import { defineConfig } from "vitest/config";

const DEFAULT_SCENARIO_TIMEOUT = 30_000;

export default defineConfig({
	test: {
		environment: "node",
		hookTimeout: DEFAULT_SCENARIO_TIMEOUT,
		include: ["src/scenarios/**/*.test.ts", "src/scenarios/**/*.smoke.test.ts"],
		testTimeout: DEFAULT_SCENARIO_TIMEOUT,
	},
});
