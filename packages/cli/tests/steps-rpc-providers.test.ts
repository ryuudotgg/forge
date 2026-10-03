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
			ids: ["trpc", "fake"],
			availableIds: ["trpc"],
			available: (id: string) => id === "trpc",
			label: (id: "trpc" | "fake") =>
				id === "fake" ? "Fake RPC" : original.rpcProviders.label(id),
		},
	};
});

describe("rpc step with an unavailable provider", () => {
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
