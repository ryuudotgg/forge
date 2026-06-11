import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
	addonConfigBindings,
	builtins,
	findRemovalBlockers,
	listVisibleAddons,
	loadAddonDefinition,
	loadDefinitionRegistry,
	optionalAddons,
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

	it("gates opt-in tooling addons on the addons selection", async () => {
		const baseConfig = {
			name: "Acme",
			packageManager: "pnpm",
			path: ".",
			platforms: ["web"],
			runtime: "Node.js",
			slug: "acme",
			web: "nextjs",
		} as const;

		const optInIds = [
			"commitlint",
			"github-ci",
			"lefthook",
			"shared",
			"vscode",
		];

		const withoutAddons = await Effect.runPromise(resolveBuiltins(baseConfig));
		const withoutIds = withoutAddons.map((entry) => entry.id);
		for (const id of optInIds) expect(withoutIds).not.toContain(id);

		const withAddons = await Effect.runPromise(
			resolveBuiltins({ ...baseConfig, addons: ["lefthook", "shared"] }),
		);
		const withIds = withAddons.map((entry) => entry.id);

		expect(withIds).toEqual(expect.arrayContaining(["lefthook", "shared"]));
		expect(withIds).not.toContain("vscode");
		expect(withIds).not.toContain("github-ci");
	});
});

describe("removal blockers", () => {
	it("blocks removing the orm while better-auth depends on it", () => {
		const blockers = findRemovalBlockers(
			"drizzle",
			{ authentication: "better-auth", slug: "acme" },
			["better-auth", "trpc"],
			[],
		);

		expect(blockers.dependents.map((dependent) => dependent.id)).toEqual([
			"better-auth",
		]);
		expect(blockers.frameworks).toEqual([]);
	});

	it("allows removing better-auth while the orm stays installed", () => {
		const blockers = findRemovalBlockers(
			"better-auth",
			{ orm: "drizzle" },
			["drizzle", "trpc"],
			[],
		);

		expect(blockers).toEqual({ dependents: [], frameworks: [] });
	});

	it("allows removing the orm once nothing depends on it", () => {
		expect(
			findRemovalBlockers("drizzle", { slug: "acme" }, ["trpc"], []),
		).toEqual({ dependents: [], frameworks: [] });
	});

	it("unblocks a dependent when an active alternative remains", () => {
		const blockers = findRemovalBlockers(
			"drizzle",
			{ authentication: "better-auth", orm: "prisma" },
			["better-auth", "prisma"],
			[],
		);

		expect(blockers.dependents).toEqual([]);
	});

	it("still blocks when the alternative is installed but inactive", () => {
		const blockers = findRemovalBlockers(
			"drizzle",
			{ authentication: "better-auth" },
			["better-auth", "prisma"],
			[],
		);

		expect(blockers.dependents.map((dependent) => dependent.id)).toEqual([
			"better-auth",
		]);
	});

	it("blocks removing addons the active template depends on", () => {
		for (const addonId of ["ui", "typescript", "root"]) {
			const blockers = findRemovalBlockers(
				addonId,
				{ web: "nextjs" },
				[],
				[{ id: "base", version: 1 }],
			);

			expect(blockers.frameworks, addonId).toEqual(["Next.js"]);
		}

		const blockers = findRemovalBlockers(
			"drizzle",
			{ web: "nextjs" },
			[],
			[{ id: "base", version: 1 }],
		);

		expect(blockers.frameworks).toEqual([]);
	});
});

describe("addon config bindings", () => {
	it("activates each bound addon through its own binding", () => {
		for (const [addonId, binding] of Object.entries(addonConfigBindings)) {
			const { addon } = loadAddonDefinition(addonId);

			expect(addon.when({ ...binding }), addonId).toBe(true);
			expect(addon.when({}), addonId).toBe(false);
		}
	});

	it("covers every visible addon with a binding or guard", () => {
		const templateInfra = new Set(
			builtins.templates.flatMap((template) =>
				template.dependencies
					.filter((dependency) => dependency.type === "addon")
					.map((dependency) => dependency.id),
			),
		);

		for (const entry of listVisibleAddons()) {
			const { addon } = loadAddonDefinition(entry.id);
			const covered =
				addonConfigBindings[addon.id] !== undefined ||
				optionalAddons.normalize(addon.id) !== undefined ||
				addon.category === "packageManager" ||
				templateInfra.has(addon.id) ||
				addon.when({});

			expect(covered, addon.id).toBe(true);
		}
	});
});
