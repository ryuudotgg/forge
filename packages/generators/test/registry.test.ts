import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
	builtins,
	loadAddonDefinition,
	loadDefinitionRegistry,
	resolveBuiltins,
} from "../src";

describe("registry loader", () => {
	it("loads first-party definitions only", () => {
		const loaded = loadDefinitionRegistry();

		expect(loaded.registry).toBe(builtins);

		expect(loaded.registry.frameworks.map((entry) => entry.id)).toContain(
			"nextjs",
		);

		expect(loaded.registry.templates.map((entry) => entry.id)).toContain(
			"nextjs/base",
		);

		expect(loaded.registry.addons.map((entry) => entry.id)).toEqual(
			expect.arrayContaining(["root", "pnpm", "tailwind", "trpc"]),
		);
	});

	it("loads a first-party addon by id", () => {
		const loaded = loadAddonDefinition("tailwind");

		expect(loaded.addon.id).toBe("tailwind");
		expect(loaded.catalogEntry).toMatchObject({
			id: "tailwind",
			kind: "addon",
			name: "Tailwind CSS",
		});
	});

	it("resolves first-party definitions for a config", async () => {
		const resolved = await Effect.runPromise(
			resolveBuiltins({
				name: "Acme",
				packageManager: "pnpm",
				path: ".",
				platforms: ["web"],
				runtime: "Node.js",
				slug: "acme",
				style: "tailwind",
				web: "nextjs",
			}),
		);

		expect(resolved.map((entry) => entry.id)).toEqual(
			expect.arrayContaining(["nextjs/base", "root", "pnpm", "tailwind"]),
		);
	});
});
