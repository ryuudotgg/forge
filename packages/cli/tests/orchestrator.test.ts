import { Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import { orchestrate } from "../src/orchestrator";
import { pathSchema } from "../src/steps/project/path";
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

	it("awaits a step's validate hook when the config pre-supplies its key", async () => {
		const validate = vi.fn(async () => undefined);
		const execute = vi.fn(async () => "blue");
		const step = makeStep({
			id: "color",
			configKey: "color",
			schema: Schema.String,
			validate,
			execute,
		});

		const config = await orchestrate([step], {
			interactive: false,
			initialConfig: { color: "red" },
		});

		expect(validate).toHaveBeenCalledWith("red", { color: "red" });
		expect(execute).not.toHaveBeenCalled();
		expect(config.color).toBe("red");
	});

	it("skips a step's validate hook when the key is absent and runs execute", async () => {
		const validate = vi.fn(async () => undefined);
		const execute = vi.fn(async () => "blue");
		const step = makeStep({
			id: "color",
			configKey: "color",
			schema: Schema.String,
			validate,
			execute,
		});

		const config = await orchestrate([step], {
			interactive: false,
			initialConfig: {},
		});

		expect(validate).not.toHaveBeenCalled();
		expect(execute).toHaveBeenCalled();
		expect(config.color).toBe("blue");
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

	it("throws an invalid configuration error before a side-effecting step runs", async () => {
		const generate = vi.fn(async () => undefined);
		const steps = [
			makeStep({
				id: "path",
				configKey: "path",
				schema: pathSchema,
			}),
			makeStep({ id: "generate", group: "generate", execute: generate }),
		];

		await expect(
			orchestrate(steps, {
				interactive: false,
				initialConfig: { path: "./../x" },
			}),
		).rejects.toThrow(
			"Invalid Configuration:\n  path: You need to provide a path inside the current directory.",
		);

		expect(generate).not.toHaveBeenCalled();
	});

	it("returns decoded pre-supplied config after side-effecting steps run", async () => {
		const generate = vi.fn(async () => undefined);
		const steps = [
			makeStep({
				id: "path",
				configKey: "path",
				schema: pathSchema,
			}),
			makeStep({ id: "generate", group: "generate", execute: generate }),
		];

		await expect(
			orchestrate(steps, {
				interactive: false,
				initialConfig: { path: "./apps/web" },
			}),
		).resolves.toEqual({ path: "./apps/web" });

		expect(generate).toHaveBeenCalledTimes(1);
	});

	it("throws an invalid configuration error when the decode fails", async () => {
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
