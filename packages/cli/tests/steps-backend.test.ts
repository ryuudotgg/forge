import { beforeEach, describe, expect, it, vi } from "vitest";
import backendStep from "../src/steps/backend/framework";
import rpcStep from "../src/steps/backend/rpc";
import rpcPublicStep from "../src/steps/backend/rpc-public";
import { type PartialConfig, SKIP } from "../src/steps/types";

const promptMocks = vi.hoisted(() => ({
	cancel: vi.fn(),
	confirm: vi.fn(),
	isCancel: vi.fn(),
	logWarn: vi.fn(),
	select: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
	cancel: promptMocks.cancel,
	confirm: promptMocks.confirm,
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
		promptMocks.confirm.mockReset();
		promptMocks.isCancel.mockReset();
		promptMocks.logWarn.mockReset();
		promptMocks.select.mockReset();
		promptMocks.isCancel.mockReturnValue(false);
	});

	it("accepts a canonical backend id without prompting", async () => {
		await expect(
			backendStep.execute({ backend: "nextjs" }, false),
		).resolves.toBe("nextjs");

		expect(promptMocks.select).not.toHaveBeenCalled();
	});

	it("normalizes display-name aliases in non-interactive mode", async () => {
		await expect(
			backendStep.execute(rawConfig({ backend: "Next.js" }), false),
		).resolves.toBe("nextjs");
	});

	it("skips unavailable backends in non-interactive mode", async () => {
		await expect(backendStep.execute({ backend: "hono" }, false)).resolves.toBe(
			SKIP,
		);
	});

	it("skips when the configured backend is unknown", async () => {
		await expect(
			backendStep.execute(rawConfig({ backend: "rails" }), false),
		).resolves.toBe(SKIP);
	});

	it("marks the chosen web framework as recommended", async () => {
		promptMocks.select.mockResolvedValue("nextjs");

		await expect(backendStep.execute({ web: "nextjs" }, true)).resolves.toBe(
			"nextjs",
		);

		expect(promptMocks.select).toHaveBeenCalledWith({
			message: "What is your preferred backend framework?",
			options: [
				{ label: "Next.js (Recommended)", value: "nextjs" },
				{ label: "Convex", value: "convex", hint: "coming soon" },
				{ label: "Hono", value: "hono", hint: "coming soon" },
				{ label: "Elysia", value: "elysia", hint: "coming soon" },
				{ label: "µWebSockets", value: "uwebsockets", hint: "coming soon" },
				{ label: "Fastify", value: "fastify", hint: "coming soon" },
				{ label: "Express", value: "express", hint: "coming soon" },
				{ label: "None", value: "none" },
			],
		});
	});

	it("warns and re-prompts when an unavailable backend is selected", async () => {
		promptMocks.select
			.mockResolvedValueOnce("hono")
			.mockResolvedValueOnce("nextjs");

		await expect(backendStep.execute({}, true)).resolves.toBe("nextjs");

		expect(promptMocks.logWarn).toHaveBeenCalledWith(
			"Hono isn't available yet.",
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
		promptMocks.confirm.mockReset();
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

describe("rpcPublic step", () => {
	beforeEach(() => {
		promptMocks.cancel.mockReset();
		promptMocks.confirm.mockReset();
		promptMocks.isCancel.mockReset();
		promptMocks.logWarn.mockReset();
		promptMocks.select.mockReset();
		promptMocks.isCancel.mockReturnValue(false);
	});

	it("only runs when an rpc provider is selected", () => {
		expect(rpcPublicStep.shouldRun({})).toBe(false);
		expect(rpcPublicStep.shouldRun({ rpc: "trpc" })).toBe(true);
	});

	it("always skips in non-interactive mode", async () => {
		await expect(rpcPublicStep.execute({ rpc: "trpc" }, false)).resolves.toBe(
			SKIP,
		);

		expect(promptMocks.confirm).not.toHaveBeenCalled();
	});

	it("returns a declined confirm as false instead of skipping", async () => {
		promptMocks.confirm.mockResolvedValue(false);

		await expect(rpcPublicStep.execute({ rpc: "trpc" }, true)).resolves.toBe(
			false,
		);

		expect(promptMocks.confirm).toHaveBeenCalledWith({
			message: "Do you want your API to be publicly available?",
			active: "Yes (OpenAPI Specification)",
			inactive: "No",
			initialValue: false,
		});
	});

	it("returns an accepted confirm as true", async () => {
		promptMocks.confirm.mockResolvedValue(true);

		await expect(rpcPublicStep.execute({ rpc: "trpc" }, true)).resolves.toBe(
			true,
		);
	});

	it("exits when the confirm is cancelled", async () => {
		const exit = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		try {
			promptMocks.confirm.mockResolvedValue(Symbol.for("clack:cancel"));
			promptMocks.isCancel.mockReturnValue(true);

			await expect(
				rpcPublicStep.execute({ rpc: "trpc" }, true),
			).rejects.toThrow("exit:0");
		} finally {
			exit.mockRestore();
		}
	});
});
