import { Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import rpcStep, { rpcSchema } from "../src/steps/backend/rpc";

const promptMocks = vi.hoisted(() => ({
	isCancel: vi.fn(() => false),
	select: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
	cancel: vi.fn(),
	isCancel: promptMocks.isCancel,
	select: promptMocks.select,
}));

vi.mock("@ryuugg/generators", async (importOriginal) => {
	const original = await importOriginal<typeof import("@ryuugg/generators")>();
	return {
		...original,
		rpcProviders: {
			...original.rpcProviders,
			ids: ["trpc", "orpc", "fake"],
			availableIds: ["trpc"],
			available: (id: string) => id === "trpc",
			accepted: (id: string) => id === "trpc" || id === "orpc",
			label: (id: "trpc" | "orpc" | "fake") =>
				id === "fake" ? "Fake RPC" : original.rpcProviders.label(id),
		},
	};
});

describe("rpc step with an unavailable provider", () => {
	it("accepts the preview provider from config without prompting", async () => {
		expect(Schema.decodeUnknownSync(rpcSchema)("orpc")).toBe("orpc");
		await expect(rpcStep.execute({ rpc: "orpc" }, false)).resolves.toBe("orpc");
	});

	it("requires an API host for preview oRPC on TanStack Router", () => {
		expect(() =>
			rpcStep.validate?.("orpc", { backend: "self", web: "tanstack-router" }),
		).toThrow(expect.objectContaining({ reason: "api-host-required" }));
	});

	it("accepts preview oRPC on a Next.js self host", () => {
		expect(() =>
			rpcStep.validate?.("orpc", { backend: "self", web: "nextjs" }),
		).not.toThrow();
	});

	it("leaves the unavailable provider out of the options", async () => {
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

	it("rejects the unavailable provider at decode", () => {
		expect(() => Schema.decodeUnknownSync(rpcSchema)("fake")).toThrow(
			"We don't support Fake RPC yet.",
		);

		expect(Schema.decodeUnknownSync(rpcSchema)("trpc")).toBe("trpc");
	});
});
