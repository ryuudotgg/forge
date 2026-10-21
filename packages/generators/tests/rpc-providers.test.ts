import { describe, expect, it, vi } from "vitest";
import { listCatalogEntries } from "../src/index";

vi.mock("../src/config", async (importOriginal) => {
	const original = await importOriginal<typeof import("../src/config")>();
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

describe("RPC providers", () => {
	it("announces unavailable RPC providers alongside available addons", () => {
		const entries = listCatalogEntries();

		expect(entries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "fake",
					kind: "addon",
					available: false,
					category: "addon",
					name: "Fake RPC",
				}),
				expect.objectContaining({
					id: "trpc",
					kind: "addon",
					available: true,
				}),
			]),
		);
	});
});
