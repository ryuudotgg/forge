import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type AppConfig,
	deriveAddonFrameworks,
	isAddonCompatibleWithModule,
	RegistryDescriptorSchema,
} from "@ryuujs/core";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
	addonConfigBindings,
	builtins,
	type ForgeConfig,
	findRemovalBlockers,
	importRegistryPackage,
	type LoadDefinitionRegistryOptions,
	listVisibleAddons,
	loadAddonDefinition,
	loadDefinitionRegistry,
	optionalAddons,
	RegistryLoadError,
	type RegistryPackageManifest,
} from "../src";
import { plannedDefinitionIds, plannedProject } from "./planner-harness";

const fixtureRegistryId = "@fixture/forge-registry";

const duplicateCatalogEntry = {
	available: true,
	category: "tooling",
	description: "A duplicate catalog fixture.",
	experimental: false,
	hidden: false,
	id: "@acme/sentry",
	keywords: ["fixture"],
	kind: "addon",
	name: "Duplicate Sentry",
	summary: "Exercise duplicate catalog validation.",
	targetMode: "multiple",
} satisfies RegistryPackageManifest<ForgeConfig>["catalog"][number];

async function importFixtureRegistry() {
	const registryModule = await import("./fixtures/registry-package/index");
	return {
		module: registryModule,
		version: "1.2.3",
	};
}

async function loadFailure(
	options: LoadDefinitionRegistryOptions,
): Promise<RegistryLoadError> {
	try {
		await loadDefinitionRegistry(options);
		throw new Error("Expected registry loading to fail");
	} catch (error) {
		if (error instanceof RegistryLoadError) return error;
		throw error;
	}
}

describe("registry loader", () => {
	it("loads first-party definitions only", () => {
		const loaded = loadDefinitionRegistry();

		expect(loaded.registry).toBe(builtins);

		expect(loaded.registry.frameworks.map((entry) => entry.id)).toEqual(
			expect.arrayContaining(["nextjs", "react-router", "tanstack-start"]),
		);

		expect(loaded.registry.templates.map((entry) => entry.id)).toEqual(
			expect.arrayContaining([
				"nextjs/base",
				"react-router/base",
				"tanstack-start/base",
			]),
		);

		expect(loaded.registry.addons.map((entry) => entry.id)).toEqual(
			expect.arrayContaining(["root", "pnpm", "tailwind", "trpc"]),
		);
		expect(
			loaded.catalog.every((entry) => entry.source === "first-party"),
		).toBe(true);
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
		const resolved = await plannedDefinitionIds({
			name: "Acme",
			packageManager: "pnpm",
			path: ".",
			platforms: ["web"],
			runtime: "Node.js",
			slug: "acme",
			style: "tailwind",
			web: "nextjs",
		});

		expect(resolved).toEqual(
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
			"vitest",
			"vscode",
		];

		const withoutIds = await plannedDefinitionIds(baseConfig);
		for (const id of optInIds) expect(withoutIds).not.toContain(id);

		const withIds = await plannedDefinitionIds({
			...baseConfig,
			addons: ["lefthook", "shared", "vitest"],
		});

		expect(withIds).toEqual(
			expect.arrayContaining(["lefthook", "shared", "vitest"]),
		);
		expect(withIds).not.toContain("vscode");
		expect(withIds).not.toContain("github-ci");
	});

	it("loads and merges every registry unit kind and catalog support cell", async () => {
		const loaded = await loadDefinitionRegistry({
			importRegistry: importFixtureRegistry,
			projectRoot: "/fixture-project",
			registries: [fixtureRegistryId],
		});

		expect(loaded.registry.addons.map((entry) => entry.id)).toContain(
			"@fixture/neutral",
		);
		expect(loaded.registry.frameworks.map((entry) => entry.id)).toContain(
			"@fixture/web",
		);
		expect(loaded.registry.templates.map((entry) => entry.id)).toContain(
			"@fixture/base",
		);
		expect(
			loaded.registry.adapters.some(
				(entry) => entry.addon === "vitest" && entry.framework === "nextjs",
			),
		).toBe(true);
		expect(
			loaded.catalog.find(
				(entry) => entry.kind === "addon" && entry.id === "vitest",
			),
		).toMatchObject({
			frameworks: ["nextjs"],
			frameworkSources: { nextjs: fixtureRegistryId },
			source: "first-party",
		});
		expect(
			loaded.catalog.find(
				(entry) => entry.kind === "addon" && entry.id === "@fixture/mixed",
			),
		).toMatchObject({
			frameworks: ["nextjs", "@fixture/web"],
			frameworkSources: {
				"@fixture/web": fixtureRegistryId,
				nextjs: fixtureRegistryId,
			},
			source: fixtureRegistryId,
		});
		expect(
			loaded.catalog.find(
				(entry) =>
					entry.kind === "addon" && entry.id === "@fixture/unconstrained",
			),
		).toMatchObject({
			frameworks: undefined,
			frameworkSources: {},
			source: fixtureRegistryId,
		});
		expect(
			loaded.catalog.find((entry) => entry.id === "@fixture/neutral"),
		).toMatchObject({ source: fixtureRegistryId });
		expect(
			loaded.catalog.find((entry) => entry.id === "@fixture/web"),
		).toMatchObject({ source: fixtureRegistryId });
		expect(
			loaded.catalog.find((entry) => entry.id === "@fixture/base"),
		).toMatchObject({ source: fixtureRegistryId });

		const plan = await plannedProject(
			{
				addons: ["vitest"],
				packageManager: "pnpm",
				path: ".",
				platforms: ["web"],
				runtime: "Node.js",
				slug: "acme",
				web: "nextjs",
			},
			{},
			loaded.registry,
		);
		expect(
			plan.manifest.installs.find((entry) => entry.definitionId === "vitest")
				?.targets,
		).toEqual([{ kind: "module", moduleId: expect.any(String) }]);
		expect(loaded.descriptors).toEqual([
			{
				apiVersion: 1,
				id: fixtureRegistryId,
				source: "npm",
				units: [
					{ id: "@fixture/neutral", kind: "addon" },
					{ id: "@fixture/mixed", kind: "addon" },
					{ id: "@fixture/unconstrained", kind: "addon" },
					{ addon: "vitest", framework: "nextjs", kind: "adapter" },
					{
						addon: "@fixture/mixed",
						framework: "@fixture/web",
						kind: "adapter",
					},
					{
						addon: "@fixture/unconstrained",
						framework: "@fixture/web",
						kind: "adapter",
					},
					{ id: "@fixture/web", kind: "framework" },
					{ id: "@fixture/base", kind: "template" },
				],
				version: "1.2.3",
			},
		]);
		expect(
			Schema.decodeUnknownSync(Schema.Array(RegistryDescriptorSchema))(
				JSON.parse(JSON.stringify(loaded.descriptors)),
			),
		).toEqual(loaded.descriptors);
	});

	it("matches derived frameworks to real compatibility membership", async () => {
		const loaded = await loadDefinitionRegistry({
			importRegistry: importFixtureRegistry,
			projectRoot: "/fixture-project",
			registries: [fixtureRegistryId],
		});
		const addon = loaded.registry.addons.find(
			(entry) => entry.id === "@fixture/unconstrained",
		);
		if (!addon) throw new Error("Missing Addon: @fixture/unconstrained");

		const derivedFrameworks = deriveAddonFrameworks(
			addon,
			loaded.registry.adapters,
		);
		for (const framework of loaded.registry.frameworks) {
			const module: AppConfig = {
				id: "abcde",
				type: "app",
				framework: framework.id,
				template: { id: `${framework.id}/fixture`, version: 1 },
				slots: Object.fromEntries(
					framework.slots.map((slot) => [slot, `src/${slot}.ts`]),
				),
			};
			const expectedMembership =
				derivedFrameworks === undefined ||
				derivedFrameworks.includes(framework.id);

			expect(
				isAddonCompatibleWithModule(
					addon,
					module,
					loaded.registry.frameworks,
					loaded.registry.adapters,
				),
				framework.id,
			).toBe(expectedMembership);
		}
	});

	it("accepts self-contained structural registry definitions", async () => {
		const loaded = await loadDefinitionRegistry({
			importRegistry: async () => ({
				module: {
					default: {
						apiVersion: 1,
						addons: [
							{
								_tag: "AddonDefinition",
								category: "tooling",
								contribute: () => [],
								dependencies: [],
								exclusive: false,
								id: "@fixture/structural",
								name: "Structural Fixture",
								targetMode: "multiple",
								version: "1.0.0",
								when: () => false,
							},
						],
						catalog: [
							{
								available: true,
								category: "tooling",
								description: "A structural fixture.",
								experimental: false,
								hidden: false,
								id: "@fixture/structural",
								keywords: ["fixture"],
								kind: "addon",
								name: "Structural Fixture",
								summary: "Exercise structural loading.",
								targetMode: "multiple",
							},
						],
					},
				},
				version: "1.0.0",
			}),
			projectRoot: "/fixture-project",
			registries: ["@fixture/structural-registry"],
		});

		expect(
			loaded.registry.addons.find(
				(entry) => entry.id === "@fixture/structural",
			),
		).toMatchObject({ _tag: "AddonDefinition" });
		expect(loaded.descriptors[0]?.units).toEqual([
			{ id: "@fixture/structural", kind: "addon" },
		]);
	});

	it("accepts nested default interop and preserves package integrity", async () => {
		const loaded = await loadDefinitionRegistry({
			importRegistry: async () => ({
				integrity: "sha512-fixture",
				module: {
					default: { default: { apiVersion: 1, catalog: [] } },
				},
				version: "1.0.0",
			}),
			projectRoot: "/fixture-project",
			registries: ["@fixture/nested-default"],
		});

		expect(loaded.descriptors).toEqual([
			{
				apiVersion: 1,
				id: "@fixture/nested-default",
				integrity: "sha512-fixture",
				source: "npm",
				units: [],
				version: "1.0.0",
			},
		]);
	});

	it("resolves packages from the project's node_modules", async () => {
		const projectRoot = await mkdtemp(
			join(tmpdir(), "forge-registry-resolve-"),
		);
		const packageRoot = join(
			projectRoot,
			"node_modules/@fixture/empty-registry",
		);
		const versionlessRoot = join(
			projectRoot,
			"node_modules/@fixture/versionless-registry",
		);

		try {
			await mkdir(packageRoot, { recursive: true });
			await writeFile(
				join(packageRoot, "package.json"),
				JSON.stringify({
					name: "@fixture/empty-registry",
					version: "4.5.6",
					type: "module",
					exports: { ".": "./index.mjs" },
				}),
			);
			await writeFile(
				join(packageRoot, "index.mjs"),
				"export default { apiVersion: 1, catalog: [] };\n",
			);

			const loaded = await loadDefinitionRegistry({
				importRegistry: importRegistryPackage,
				projectRoot,
				registries: ["@fixture/empty-registry"],
			});

			expect(loaded.descriptors).toEqual([
				{
					apiVersion: 1,
					id: "@fixture/empty-registry",
					source: "npm",
					units: [],
					version: "4.5.6",
				},
			]);

			await mkdir(versionlessRoot, { recursive: true });
			await writeFile(
				join(versionlessRoot, "package.json"),
				JSON.stringify({
					name: "@fixture/versionless-registry",
					type: "module",
					exports: { ".": "./index.mjs" },
				}),
			);
			await writeFile(
				join(versionlessRoot, "index.mjs"),
				"export default { apiVersion: 1, catalog: [] };\n",
			);
			await expect(
				importRegistryPackage("@fixture/versionless-registry", projectRoot),
			).rejects.toThrow(
				"Registry Package Version Missing: @fixture/versionless-registry",
			);
			const versionlessError = await loadFailure({
				projectRoot,
				registries: ["@fixture/versionless-registry"],
			});
			expect(versionlessError.message).toBe(
				"Registry Package Version Missing: @fixture/versionless-registry",
			);
		} finally {
			await rm(projectRoot, { force: true, recursive: true });
		}
	});

	it("loads CommonJS interop and import-only registry packages", async () => {
		const projectRoot = await mkdtemp(
			join(tmpdir(), "forge-registry-interop-"),
		);
		const cjsRoot = join(projectRoot, "node_modules/@fixture/cjs-registry");
		const esmRoot = join(projectRoot, "node_modules/@fixture/esm-registry");
		const nestedEsmRoot = join(
			projectRoot,
			"node_modules/@fixture/nested-esm-registry",
		);
		const arrayEsmRoot = join(
			projectRoot,
			"node_modules/@fixture/array-esm-registry",
		);
		const requireRoot = join(
			projectRoot,
			"node_modules/@fixture/require-registry",
		);

		try {
			await mkdir(cjsRoot, { recursive: true });
			await writeFile(
				join(cjsRoot, "package.json"),
				JSON.stringify({
					name: "@fixture/cjs-registry",
					version: "1.0.0",
					main: "index.cjs",
				}),
			);
			await writeFile(
				join(cjsRoot, "index.cjs"),
				"exports.default = { apiVersion: 1, catalog: [] };\n",
			);

			await mkdir(esmRoot, { recursive: true });
			await writeFile(
				join(esmRoot, "package.json"),
				JSON.stringify({
					name: "@fixture/esm-registry",
					version: "2.0.0",
					type: "module",
					exports: { import: "./index.mjs" },
				}),
			);
			await writeFile(
				join(esmRoot, "index.mjs"),
				"export default { apiVersion: 1, catalog: [] };\n",
			);
			await mkdir(nestedEsmRoot, { recursive: true });
			await writeFile(
				join(nestedEsmRoot, "package.json"),
				JSON.stringify({
					name: "@fixture/nested-esm-registry",
					version: "2.1.0",
					type: "module",
					exports: { ".": { node: { import: "./index.mjs" } } },
				}),
			);
			await writeFile(
				join(nestedEsmRoot, "index.mjs"),
				"export default { apiVersion: 1, catalog: [] };\n",
			);
			await mkdir(arrayEsmRoot, { recursive: true });
			await writeFile(
				join(arrayEsmRoot, "package.json"),
				JSON.stringify({
					name: "@fixture/array-esm-registry",
					version: "2.2.0",
					type: "module",
					exports: { ".": { import: [null, {}, "./index.mjs"] } },
				}),
			);
			await writeFile(
				join(arrayEsmRoot, "index.mjs"),
				"export default { apiVersion: 1, catalog: [] };\n",
			);
			await mkdir(requireRoot, { recursive: true });
			await writeFile(
				join(requireRoot, "package.json"),
				JSON.stringify({
					name: "@fixture/require-registry",
					version: "3.0.0",
					exports: { ".": { require: "./index.cjs" } },
				}),
			);
			await writeFile(
				join(requireRoot, "index.cjs"),
				"module.exports = { apiVersion: 1, catalog: [] };\n",
			);

			const loaded = await loadDefinitionRegistry({
				projectRoot,
				registries: [
					"@fixture/cjs-registry",
					"@fixture/esm-registry",
					"@fixture/nested-esm-registry",
					"@fixture/array-esm-registry",
					"@fixture/require-registry",
				],
			});

			expect(loaded.descriptors.map((entry) => entry.version)).toEqual([
				"1.0.0",
				"2.0.0",
				"2.1.0",
				"2.2.0",
				"3.0.0",
			]);
		} finally {
			await rm(projectRoot, { force: true, recursive: true });
		}
	});

	it("loads the registry package from the fixture project only", async () => {
		const projectRoot = await mkdtemp(
			join(tmpdir(), "forge-registry-project-only-"),
		);
		const packageRoot = join(
			projectRoot,
			"node_modules/@fixture/project-only-registry",
		);

		try {
			await mkdir(packageRoot, { recursive: true });
			await writeFile(
				join(packageRoot, "package.json"),
				JSON.stringify({
					name: "@fixture/project-only-registry",
					version: "9.8.7",
					type: "module",
					exports: { ".": { import: "./index.mjs" } },
				}),
			);
			await writeFile(
				join(packageRoot, "index.mjs"),
				'export default { source: "fixture-project" };\n',
			);

			const loaded = await importRegistryPackage(
				"@fixture/project-only-registry",
				projectRoot,
			);

			expect(loaded.version).toBe("9.8.7");
			expect(loaded.module).toMatchObject({
				default: { source: "fixture-project" },
			});
		} finally {
			await rm(projectRoot, { force: true, recursive: true });
		}
	});

	it("keeps project-anchored resolution failures on the install path", async () => {
		const projectRoot = await mkdtemp(
			join(tmpdir(), "forge-registry-resolution-failures-"),
		);
		const missingEntryRoot = join(
			projectRoot,
			"node_modules/@fixture/missing-entry-registry",
		);
		const noTargetRoot = join(
			projectRoot,
			"node_modules/@fixture/no-target-registry",
		);

		try {
			await mkdir(missingEntryRoot, { recursive: true });
			await writeFile(
				join(missingEntryRoot, "package.json"),
				JSON.stringify({
					name: "@fixture/missing-entry-registry",
					version: "1.0.0",
					main: "missing.cjs",
				}),
			);
			await mkdir(noTargetRoot, { recursive: true });
			await writeFile(
				join(noTargetRoot, "package.json"),
				JSON.stringify({
					name: "@fixture/no-target-registry",
					version: "1.0.0",
					type: "module",
					exports: { import: [null, {}] },
				}),
			);

			for (const registryId of [
				"@fixture/missing-entry-registry",
				"@fixture/no-target-registry",
			]) {
				const error = await loadFailure({
					projectRoot,
					registries: [registryId],
				});
				expect(error.message).toBe(`Registry Not Installed: ${registryId}`);
			}

			await expect(
				importRegistryPackage("node:path", projectRoot),
			).rejects.toThrow("The URL must be of scheme file");
		} finally {
			await rm(projectRoot, { force: true, recursive: true });
		}
	});

	it("distinguishes a registry package that fails while running", async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), "forge-registry-throws-"));
		const packageRoot = join(
			projectRoot,
			"node_modules/@fixture/throws-registry",
		);

		try {
			await mkdir(packageRoot, { recursive: true });
			await writeFile(
				join(packageRoot, "package.json"),
				JSON.stringify({
					name: "@fixture/throws-registry",
					version: "1.0.0",
					type: "module",
					exports: { ".": "./index.mjs" },
				}),
			);
			await writeFile(
				join(packageRoot, "index.mjs"),
				'throw new Error("boom");\n',
			);

			const error = await loadFailure({
				projectRoot,
				registries: ["@fixture/throws-registry"],
			});

			expect(error.message).toBe(
				"Registry Import Failed: @fixture/throws-registry: boom",
			);
			expect(error.detail).toContain("boom");
		} finally {
			await rm(projectRoot, { force: true, recursive: true });
		}
	});

	it("rejects an incompatible authoring API version", async () => {
		const error = await loadFailure({
			importRegistry: async () => ({
				module: {
					default: {
						apiVersion: 2,
						catalog: [],
					},
				},
				version: "1.0.0",
			}),
			projectRoot: "/fixture-project",
			registries: ["@acme/forge-sentry"],
		});

		expect(error.message).toBe(
			"Registry Api Version Unsupported: @acme/forge-sentry expected 1, found 2",
		);
	});

	it("tells users to install an unresolved registry as a devDependency", async () => {
		const error = await loadFailure({
			importRegistry: () => Promise.reject("missing"),
			projectRoot: "/fixture-project",
			registries: ["@acme/forge-sentry"],
		});

		expect(error).toBeInstanceOf(RegistryLoadError);
		expect(error.message).toBe("Registry Not Installed: @acme/forge-sentry");
	});

	it("reports a package that neither resolver can find", async () => {
		const projectRoot = await mkdtemp(
			join(tmpdir(), "forge-registry-missing-"),
		);
		try {
			const error = await loadFailure({
				projectRoot,
				registries: ["@fixture/absent-registry"],
			});
			expect(error.message).toBe(
				"Registry Not Installed: @fixture/absent-registry",
			);
			expect(error.detail).toContain("@fixture/absent-registry");
		} finally {
			await rm(projectRoot, { force: true, recursive: true });
		}
	});

	it("rejects invalid wrappers and unscoped third-party unit ids", async () => {
		const primitiveWrapper = await loadFailure({
			importRegistry: async () => ({ module: null, version: "1.0.0" }),
			projectRoot: "/fixture-project",
			registries: ["@acme/invalid"],
		});
		expect(primitiveWrapper.message).toBe(
			"Registry Package Invalid: @acme/invalid",
		);

		const invalidWrapper = await loadFailure({
			importRegistry: async () => ({
				module: { default: { apiVersion: 1 } },
				version: "1.0.0",
			}),
			projectRoot: "/fixture-project",
			registries: ["@acme/invalid"],
		});
		expect(invalidWrapper.message).toBe(
			"Registry Package Invalid: @acme/invalid",
		);

		const invalidUnit = await loadFailure({
			importRegistry: async () => ({
				module: {
					default: { addons: [{}], apiVersion: 1, catalog: [] },
				},
				version: "1.0.0",
			}),
			projectRoot: "/fixture-project",
			registries: ["@acme/invalid"],
		});
		expect(invalidUnit.message).toBe("Registry Package Invalid: @acme/invalid");

		const invalidId = await loadFailure({
			importRegistry: async () => ({
				module: {
					default: {
						apiVersion: 1,
						addons: [builtins.addons[0]],
						catalog: [],
					},
				},
				version: "1.0.0",
			}),
			projectRoot: "/fixture-project",
			registries: ["@acme/invalid"],
		});
		expect(invalidId.message).toBe("Registry Unit Id Invalid: root");
	});

	it("rejects tagged but structurally incomplete units", async () => {
		for (const manifest of [
			{ addons: [{ _tag: "AddonDefinition" }], apiVersion: 1, catalog: [] },
			{
				apiVersion: 1,
				catalog: [],
				templates: [{ _tag: "TemplateDefinition" }],
			},
		]) {
			const error = await loadFailure({
				importRegistry: async () => ({
					module: { default: manifest },
					version: "1.0.0",
				}),
				projectRoot: "/fixture-project",
				registries: ["@acme/invalid"],
			});

			expect(error.message).toBe("Registry Package Invalid: @acme/invalid");
		}
	});

	it("rejects duplicate registry package entries before importing", async () => {
		let importCount = 0;
		const error = await loadFailure({
			importRegistry: async () => {
				importCount += 1;
				return { module: {}, version: "1.0.0" };
			},
			projectRoot: "/fixture-project",
			registries: ["@acme/forge-sentry", "@acme/forge-sentry"],
		});

		expect(error.message).toBe("Registry Duplicate: @acme/forge-sentry");
		expect(importCount).toBe(0);
	});

	it("rejects catalog ids duplicated across registries", async () => {
		const error = await loadFailure({
			importRegistry: async () => ({
				module: {
					default: {
						apiVersion: 1,
						catalog: [duplicateCatalogEntry],
					},
				},
				version: "1.0.0",
			}),
			projectRoot: "/fixture-project",
			registries: ["@acme/registry-a", "@other/registry-b"],
		});

		expect(error.message).toBe("Registry Catalog Duplicate: @acme/sentry");
		expect(error.registryId).toBe("@other/registry-b");
	});

	it("rejects catalog ids duplicated within one registry", async () => {
		const error = await loadFailure({
			importRegistry: async () => ({
				module: {
					default: {
						apiVersion: 1,
						catalog: [duplicateCatalogEntry, duplicateCatalogEntry],
					},
				},
				version: "1.0.0",
			}),
			projectRoot: "/fixture-project",
			registries: ["@acme/registry-a"],
		});

		expect(error.message).toBe("Registry Catalog Duplicate: @acme/sentry");
		expect(error.registryId).toBe("@acme/registry-a");
	});

	it("rejects a descriptor that cannot round-trip", async () => {
		const error = await loadFailure({
			importRegistry: async () => ({
				module: { default: { apiVersion: 1, catalog: [] } },
				version: "1.0.0",
			}),
			projectRoot: "/fixture-project",
			registries: ["unscoped"],
		});

		expect(error.message).toBe("Registry Package Invalid: unscoped");
	});

	it("runs merged registry validation across first- and third-party units", async () => {
		const error = await loadFailure({
			importRegistry: async () => ({
				module: {
					default: {
						adapters: [builtins.adapters[0]],
						apiVersion: 1,
						catalog: [],
					},
				},
				version: "1.0.0",
			}),
			projectRoot: "/fixture-project",
			registries: ["@acme/invalid"],
		});

		expect(error.message).toBe("Adapter Duplicate: trpc:nextjs");
		expect(error.registryId).toBe("@acme/invalid");
	});
});

describe("removal blockers", () => {
	it("ignores the removed addon in the installed-id scan", () => {
		expect(findRemovalBlockers("drizzle", {}, ["drizzle"], [])).toEqual({
			dependents: [],
			frameworks: [],
		});
	});

	it("falls back to a template's framework id in an explicit registry", () => {
		const template = builtins.templates.find(
			(entry) => entry.id === "nextjs/base",
		);
		if (template === undefined)
			throw new Error("Missing Template: nextjs/base");

		const registry = {
			...builtins,
			frameworks: [],
			templates: [{ ...template, framework: "@fixture/missing-framework" }],
		};
		const blockers = findRemovalBlockers(
			"root",
			{ web: "nextjs" },
			[],
			[{ id: "nextjs/base", version: 1 }],
			registry,
		);

		expect(blockers.frameworks).toEqual(["@fixture/missing-framework"]);
	});

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
			const nextjsBlockers = findRemovalBlockers(
				addonId,
				{ web: "nextjs" },
				[],
				[{ id: "nextjs/base", version: 1 }],
			);

			expect(nextjsBlockers.frameworks, addonId).toEqual(["Next.js"]);

			const reactRouterBlockers = findRemovalBlockers(
				addonId,
				{ web: "react-router" },
				[],
				[{ id: "react-router/base", version: 1 }],
			);

			expect(reactRouterBlockers.frameworks, addonId).toEqual(["React Router"]);

			const tanstackBlockers = findRemovalBlockers(
				addonId,
				{ web: "tanstack-start" },
				[],
				[{ id: "tanstack-start/base", version: 1 }],
			);

			expect(tanstackBlockers.frameworks, addonId).toEqual(["TanStack Start"]);
		}

		const blockers = findRemovalBlockers(
			"drizzle",
			{ web: "nextjs" },
			[],
			[{ id: "nextjs/base", version: 1 }],
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
