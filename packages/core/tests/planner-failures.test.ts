import { NodeServices } from "@effect/platform-node";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
	type AdapterModule,
	type AddonDefinition,
	CoreLive,
	type DefinitionRegistry,
	defineAddon,
	defineFramework,
	defineRegistry,
	defineTemplate,
	ensureAppModule,
	ensuredModuleTarget,
	leafTextFile,
	moduleTarget,
	Planner,
	PlannerError,
	projectTarget,
	slotPath,
} from "../src/index";
import { withTempDir } from "./harness";

interface FailureConfig extends Record<string, unknown> {}

const plannerLayer = CoreLive.pipe(Layer.provideMerge(NodeServices.layer));

function addon(
	id: string,
	contribute: AddonDefinition<FailureConfig>["contribute"],
	dependencies: AddonDefinition<FailureConfig>["dependencies"] = [],
) {
	return defineAddon<FailureConfig>({
		id,
		name: id,
		version: "1.0.0",
		category: "tooling",
		dependencies,
		exclusive: false,
		targetMode: "multiple",
		when: () => true,
		contribute,
	});
}

function webRegistry(
	addons: ReadonlyArray<AddonDefinition<FailureConfig>>,
	slots: Readonly<Record<string, string>> = { layout: "app/layout.tsx" },
) {
	const framework = defineFramework({
		id: "nextjs",
		buildOutputs: [],
		configFile: "next.config.ts",
		ignoreDirs: [],
		name: "Next.js",
		slots: ["layout"],
		tsconfigPreset: { content: {}, name: "nextjs" },
	});
	const template = defineTemplate<FailureConfig>({
		id: "nextjs/base",
		framework: "nextjs",
		name: "Base",
		version: 1,
		category: "web",
		exclusive: true,
		when: () => true,
		contribute: () => [
			ensureAppModule("web", "apps/web", {
				framework: "nextjs",
				template: { id: "nextjs/base", version: 1 },
				slots,
			}),
		],
	});

	return defineRegistry({
		addons,
		frameworks: [framework],
		templates: [template],
	});
}

function plan(directory: string, registry: DefinitionRegistry<FailureConfig>) {
	return Effect.flatMap(Planner, (planner) =>
		planner.planCreate(directory, {}, registry, {}),
	).pipe(Effect.provide(plannerLayer));
}

async function failure(
	directory: string,
	registry: DefinitionRegistry<FailureConfig>,
) {
	const exit = await Effect.runPromiseExit(plan(directory, registry));
	if (!Exit.isFailure(exit)) throw new Error("Expected Planner Failure");

	const found = Cause.findErrorOption(exit.cause);
	if (Option.isNone(found) || !(found.value instanceof PlannerError))
		throw new Error("Expected Planner Error");

	return found.value;
}

describe("planner defensive failures", () => {
	it("rejects multiple selected templates", async () => {
		await withTempDir("planner-multiple-templates", async (directory) => {
			const first = defineTemplate<FailureConfig>({
				id: "first/base",
				framework: "first",
				name: "First",
				version: 1,
				category: "web",
				exclusive: true,
				when: () => true,
				contribute: () => [],
			});
			const second = defineTemplate<FailureConfig>({
				...first,
				id: "second/base",
				framework: "second",
				name: "Second",
			});
			const error = await failure(
				directory,
				defineRegistry({
					addons: [],
					frameworks: [],
					templates: [first, second],
				}),
			);

			expect(error.reason).toBe("multiple-templates-selected");
		});
	});

	it("rejects missing and cyclic definition dependencies", async () => {
		await withTempDir("planner-definition-graph", async (directory) => {
			const missing = addon("missing-parent", () => [], [
				{ id: "absent", type: "addon" },
			]);
			expect(
				(
					await failure(
						directory,
						defineRegistry({
							addons: [missing],
							frameworks: [],
							templates: [],
						}),
					)
				).reason,
			).toBe("definition-dependency-missing");

			const first = addon("first", () => [], [{ id: "second", type: "addon" }]);
			const second = addon("second", () => [], [
				{ id: "first", type: "addon" },
			]);
			expect(
				(
					await failure(
						directory,
						defineRegistry({
							addons: [first, second],
							frameworks: [],
							templates: [],
						}),
					)
				).reason,
			).toBe("definition-cycle-detected");
		});
	});

	it("rejects missing ensured modules", async () => {
		await withTempDir("planner-module-failures", async (directory) => {
			const missing = addon("missing", () => [
				leafTextFile(ensuredModuleTarget("absent"), "file.ts", "missing\n"),
			]);
			expect(
				(
					await failure(
						directory,
						defineRegistry({
							addons: [missing],
							frameworks: [],
							templates: [],
						}),
					)
				).reason,
			).toBe("ensured-module-missing");
		});
	});

	it("rejects every invalid slot-path target shape", async () => {
		await withTempDir("planner-slot-path-failures", async (directory) => {
			const ensured = ensuredModuleTarget("web");
			const projectSlot = addon("project-slot", () => [
				leafTextFile(projectTarget(), slotPath(ensured, "layout"), "project\n"),
			]);
			expect(
				(await failure(directory, webRegistry([projectSlot]))).reason,
			).toBe("slot-path-requires-module-target");

			const missingModule: AdapterModule = {
				config: {
					framework: "nextjs",
					id: "zzzzz",
					slots: { layout: "app/layout.tsx" },
					template: { id: "nextjs/base", version: 1 },
					type: "app",
				},
				id: "zzzzz",
				root: "apps/missing",
			};
			const resolved = moduleTarget(missingModule);
			const missingSlotModule = addon("missing-slot-module", () => [
				leafTextFile(resolved, slotPath(resolved, "layout"), "missing\n"),
			]);
			expect(
				(await failure(directory, webRegistry([missingSlotModule]))).reason,
			).toBe("slot-path-module-missing");

			const mismatch = addon("slot-mismatch", () => [
				leafTextFile(ensured, slotPath(resolved, "layout"), "mismatch\n"),
			]);
			expect((await failure(directory, webRegistry([mismatch]))).reason).toBe(
				"slot-path-target-mismatch",
			);

			const invalid = addon("slot-invalid", () => [
				leafTextFile(ensured, slotPath(ensured, "layout"), "invalid\n"),
			]);
			expect(
				(await failure(directory, webRegistry([invalid], {}))).reason,
			).toBe("slot-path-invalid");
		});
	});

	it("maps content hashing failures", async () => {
		await withTempDir("planner-content-hash-failure", async (directory) => {
			const cause = new Error("digest failed");
			vi.spyOn(globalThis.crypto.subtle, "digest").mockRejectedValueOnce(cause);
			const hashing = addon("hashing", () => [
				leafTextFile(projectTarget(), "file.ts", "content\n"),
			]);
			const error = await failure(
				directory,
				defineRegistry({
					addons: [hashing],
					frameworks: [],
					templates: [],
				}),
			);

			expect(error.reason).toBe("content-hash-failed");
			expect(error.cause).toBe(cause);
		});
	});
});
