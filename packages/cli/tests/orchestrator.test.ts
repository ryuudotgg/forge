import { Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import { orchestrate } from "../src/orchestrator";
import type { Step } from "../src/steps/types";
import { SKIP } from "../src/steps/types";

function makeStep(step: Pick<Step, "id"> & Partial<Step>): Step {
	return {
		group: "project",
		schema: null,
		shouldRun: () => true,
		execute: async () => undefined,
		...step,
	};
}

describe("orchestrate", () => {
	it("skips steps whose shouldRun returns false", async () => {
		const execute = vi.fn(async () => "red");
		const step = makeStep({
			id: "color",
			schema: Schema.String,
			shouldRun: () => false,
			execute,
		});

		const config = await orchestrate([step], {
			interactive: false,
			initialConfig: {},
		});

		expect(execute).not.toHaveBeenCalled();
		expect(config).not.toHaveProperty("color");
	});

	it("short-circuits steps whose config key is already filled", async () => {
		const execute = vi.fn(async () => "blue");
		const step = makeStep({
			id: "color",
			configKey: "color",
			schema: Schema.String,
			execute,
		});

		const config = await orchestrate([step], {
			interactive: false,
			initialConfig: { color: "red" },
		});

		expect(execute).not.toHaveBeenCalled();
		expect(config.color).toBe("red");
	});

	it("stores results under the step id when no config key is given", async () => {
		const step = makeStep({
			id: "color",
			schema: Schema.String,
			execute: async () => "red",
		});

		const config = await orchestrate([step], {
			interactive: false,
			initialConfig: {},
		});

		expect(config.color).toBe("red");
	});

	it("skips a null-key step when every schema shape key is filled", async () => {
		const execute = vi.fn(async () => ({ name: "Prompted", slug: "prompted" }));
		const step = makeStep({
			id: "name",
			configKey: null,
			schemaShape: { name: Schema.String, slug: Schema.String },
			execute,
		});

		const config = await orchestrate([step], {
			interactive: false,
			initialConfig: { name: "Acme", slug: "acme" },
		});

		expect(execute).not.toHaveBeenCalled();
		expect(config).toMatchObject({ name: "Acme", slug: "acme" });
	});

	it("runs a null-key step when a schema shape key is missing and merges its result", async () => {
		const execute = vi.fn(async () => ({ name: "Acme", slug: "acme" }));
		const step = makeStep({
			id: "name",
			configKey: null,
			schemaShape: { name: Schema.String, slug: Schema.String },
			execute,
		});

		const config = await orchestrate([step], {
			interactive: true,
			initialConfig: { name: "Acme" },
		});

		expect(execute).toHaveBeenCalledWith(expect.anything(), true);
		expect(config).toMatchObject({ name: "Acme", slug: "acme" });
	});

	it("leaves the config untouched when a step returns SKIP or undefined", async () => {
		const skipExecute = vi.fn(async () => SKIP);
		const undefinedExecute = vi.fn(async () => undefined);
		const steps = [
			makeStep({ id: "a", schema: Schema.String, execute: skipExecute }),
			makeStep({ id: "b", schema: Schema.String, execute: undefinedExecute }),
		];

		const config = await orchestrate(steps, {
			interactive: false,
			initialConfig: {},
		});

		expect(skipExecute).toHaveBeenCalled();
		expect(undefinedExecute).toHaveBeenCalled();
		expect(config).not.toHaveProperty("a");
		expect(config).not.toHaveProperty("b");
	});

	it("throws an invalid configuration error when the final decode fails", async () => {
		const step = makeStep({
			id: "color",
			configKey: "color",
			schema: Schema.String,
		});

		await expect(
			orchestrate([step], {
				interactive: false,
				initialConfig: { color: 42 },
			}),
		).rejects.toThrow(
			"Invalid Configuration:\n  color: Expected string, actual 42",
		);
	});
});
