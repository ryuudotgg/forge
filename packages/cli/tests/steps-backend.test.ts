import { GeneratorError } from "@ryuujs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { orchestrate } from "../src/orchestrator";
import backendStep from "../src/steps/backend/framework";
import rpcStep from "../src/steps/backend/rpc";
import { type PartialConfig, SKIP, type Step } from "../src/steps/types";

const promptMocks = vi.hoisted(() => ({
	cancel: vi.fn(),
	isCancel: vi.fn(),
	logWarn: vi.fn(),
	select: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
	cancel: promptMocks.cancel,
	isCancel: promptMocks.isCancel,
	log: { warn: promptMocks.logWarn },
	select: promptMocks.select,
}));

function rawConfig(values: { [key: string]: unknown }): PartialConfig {
	const config: PartialConfig = {};
	return Object.assign(config, values);
}

describe("backend step", () => {
	beforeEach(() => {
		promptMocks.cancel.mockReset();
		promptMocks.isCancel.mockReset();
		promptMocks.logWarn.mockReset();
		promptMocks.select.mockReset();
		promptMocks.isCancel.mockReturnValue(false);
	});

	it("accepts a canonical backend id without prompting", async () => {
		await expect(backendStep.execute({ backend: "self" }, false)).resolves.toBe(
			"self",
		);

		expect(promptMocks.select).not.toHaveBeenCalled();
	});

	it("normalizes display-name aliases in non-interactive mode", async () => {
		await expect(
			backendStep.execute(rawConfig({ backend: "Next.js" }), false),
		).resolves.toBe("self");
	});

	it("skips unavailable backends in non-interactive mode", async () => {
		await expect(
			backendStep.execute({ backend: "convex" }, false),
		).resolves.toBe(SKIP);
	});

	it("skips when the configured backend is unknown", async () => {
		await expect(
			backendStep.execute(rawConfig({ backend: "rails" }), false),
		).resolves.toBe(SKIP);
	});

	it("marks the chosen web framework as recommended", async () => {
		promptMocks.select.mockResolvedValue("self");

		await expect(backendStep.execute({ web: "nextjs" }, true)).resolves.toBe(
			"self",
		);

		expect(promptMocks.select).toHaveBeenCalledWith({
			message: "What is your preferred backend framework?",
			options: [
				{ label: "Same app (Recommended)", value: "self" },
				{ label: "Convex", value: "convex", hint: "coming soon" },
				{ label: "Hono", value: "hono" },
				{ label: "Elysia", value: "elysia", hint: "coming soon" },
				{ label: "µWebSockets", value: "uwebsockets", hint: "coming soon" },
				{ label: "Fastify", value: "fastify" },
				{ label: "Express", value: "express", hint: "coming soon" },
				{ label: "None", value: "none" },
			],
		});
	});

	it("warns and re-prompts when an unavailable backend is selected", async () => {
		promptMocks.select
			.mockResolvedValueOnce("convex")
			.mockResolvedValueOnce("self");

		await expect(backendStep.execute({}, true)).resolves.toBe("self");

		expect(promptMocks.logWarn).toHaveBeenCalledWith(
			"We don't support Convex yet.",
		);
		expect(promptMocks.select).toHaveBeenCalledTimes(2);
	});

	it("skips when none is selected", async () => {
		promptMocks.select.mockResolvedValue("none");

		await expect(backendStep.execute({}, true)).resolves.toBe(SKIP);
	});

	it("exits when the backend prompt is cancelled", async () => {
		const exit = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		try {
			promptMocks.select.mockResolvedValue(Symbol.for("clack:cancel"));
			promptMocks.isCancel.mockReturnValue(true);

			await expect(backendStep.execute({}, true)).rejects.toThrow("exit:0");

			expect(promptMocks.cancel).toHaveBeenCalledWith(
				"You've extinguished the forge.",
			);
		} finally {
			exit.mockRestore();
		}
	});
});

describe("rpc step", () => {
	beforeEach(() => {
		promptMocks.cancel.mockReset();
		promptMocks.isCancel.mockReset();
		promptMocks.logWarn.mockReset();
		promptMocks.select.mockReset();
		promptMocks.isCancel.mockReturnValue(false);
	});

	it("only runs when a non-convex backend is selected", () => {
		expect(rpcStep.shouldRun({})).toBe(false);
		expect(rpcStep.shouldRun({ backend: "convex" })).toBe(false);
		expect(rpcStep.shouldRun({ backend: "hono" })).toBe(true);
	});

	it("skips web frameworks without tRPC adapter support", () => {
		expect(rpcStep.shouldRun({ backend: "self", web: "tanstack-router" })).toBe(
			false,
		);
		expect(rpcStep.shouldRun({ backend: "self", web: "nextjs" })).toBe(true);
		expect(rpcStep.shouldRun({ backend: "self", web: "react-router" })).toBe(
			true,
		);
		expect(rpcStep.shouldRun({ backend: "self", web: "tanstack-start" })).toBe(
			true,
		);
	});

	it("validates a pre-supplied rpc before generation", async () => {
		const generate = vi.fn(async () => undefined);
		const generateStep: Step = {
			configKey: null,
			execute: generate,
			group: "generate",
			id: "generate",
			schema: null,
			shouldRun: () => true,
		};
		const initialConfig = {
			backend: "self" as const,
			rpc: "trpc" as const,
			web: "tanstack-router" as const,
		};

		expect(rpcStep.shouldRun(initialConfig)).toBe(true);
		await expect(
			orchestrate([rpcStep, generateStep], {
				initialConfig,
				interactive: false,
			}),
		).rejects.toThrow(
			"tRPC needs a backend. TanStack Router can't host it; add a backend framework.",
		);
		expect(generate).not.toHaveBeenCalled();
	});

	it("refuses a mobile-only rpc without an API host", () => {
		let error: unknown;

		try {
			rpcStep.validate?.("trpc", {
				mobile: "expo",
				platforms: ["mobile"],
				rpc: "trpc",
			});
		} catch (cause: unknown) {
			error = cause;
		}

		expect(error).toBeInstanceOf(GeneratorError);
		expect(error).toMatchObject({
			generatorId: "trpc",
			reason: "api-host-required",
		});
		expect(error).toHaveProperty(
			"message",
			"tRPC needs a backend. The selected web framework can't host it; add a backend framework.",
		);
	});

	it("accepts a canonical rpc id without prompting", async () => {
		await expect(rpcStep.execute({ rpc: "trpc" }, false)).resolves.toBe("trpc");

		expect(promptMocks.select).not.toHaveBeenCalled();
	});

	it("skips when the configured rpc provider is unknown", async () => {
		await expect(
			rpcStep.execute(rawConfig({ rpc: "grpc" }), false),
		).resolves.toBe(SKIP);
	});

	it("mentions the web framework in the prompt when one is chosen", async () => {
		promptMocks.select.mockResolvedValue("trpc");

		await expect(rpcStep.execute({ web: "nextjs" }, true)).resolves.toBe(
			"trpc",
		);

		expect(promptMocks.select).toHaveBeenCalledWith({
			message: "Do you want to use an RPC API with Next.js?",
			options: [
				{ label: "tRPC", value: "trpc" },
				{ label: "None", value: "none" },
			],
		});
	});

	it("asks the plain question without a web framework", async () => {
		promptMocks.select.mockResolvedValue("trpc");

		await rpcStep.execute({}, true);

		expect(promptMocks.select).toHaveBeenCalledWith({
			message: "Do you want to use an RPC API?",
			options: [
				{ label: "tRPC", value: "trpc" },
				{ label: "None", value: "none" },
			],
		});
	});

	it("skips when none is selected", async () => {
		promptMocks.select.mockResolvedValue("none");

		await expect(rpcStep.execute({}, true)).resolves.toBe(SKIP);
	});
});
