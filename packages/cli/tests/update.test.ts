import { log } from "@clack/prompts";
import { expect, it, vi } from "@effect/vitest";
import * as generators from "@ryuugg/generators";
import { Effect, Layer } from "effect";
import type {
	applyInstalledPlan as ApplyInstalledPlan,
	loadManagedProject as LoadManagedProject,
	loadProjectRegistry as LoadProjectRegistry,
} from "../src/commands/lifecycle";
import { applyInstalledPlan } from "../src/commands/lifecycle";
import {
	runUpdate,
	runUpdateEffect,
	UpdateCommand,
	type UpdateCommandService,
} from "../src/commands/update";
import {
	adminModule,
	failingAddonRegistry,
	managedProject,
	planningFailures,
} from "./lifecycle-fixtures";

type ApplyInstalledPlanFunction = typeof ApplyInstalledPlan;
type LoadManagedProjectFunction = typeof LoadManagedProject;
type LoadProjectRegistryFunction = typeof LoadProjectRegistry;

interface UpdateFixtureOptions {
	readonly project?: Awaited<ReturnType<LoadManagedProjectFunction>>;
	readonly registry?: Awaited<ReturnType<LoadProjectRegistryFunction>>;
}

function updateFixture(options: UpdateFixtureOptions) {
	const project = options.project ?? managedProject();
	const registry = options.registry ?? {
		catalog: [],
		descriptors: [],
		registry: {
			adapters: [],
			addons: [],
			frameworks: [],
			templates: [],
			recipes: [],
		},
	};

	const applyInstalledPlan = vi.fn<ApplyInstalledPlanFunction>(async () => ({
		retained: [],
		dependenciesChanged: false,
	}));

	const intro = vi.fn();
	const loadManagedProject = vi.fn<LoadManagedProjectFunction>(
		async () => project,
	);

	const loadProjectRegistry = vi.fn<LoadProjectRegistryFunction>(
		async () => registry,
	);

	const logInfo = vi.fn();
	const logWarn = vi.fn();
	const service: UpdateCommandService = {
		applyInstalledPlan,
		intro,
		loadManagedProject,
		loadProjectRegistry,
		logInfo,
		logWarn,
	};

	return {
		applyInstalledPlan,
		intro,
		layer: Layer.succeed(UpdateCommand, UpdateCommand.of(service)),
		loadManagedProject,
		loadProjectRegistry,
		logInfo,
		logWarn,
	};
}

it.each(planningFailures)(
	"prints planning failure: $message",
	async ({ failure, message }) => {
		const loaded = failingAddonRegistry(failure);
		const registry = vi
			.spyOn(generators, "loadDefinitionRegistry")
			.mockReturnValue(loaded);

		const fixture = updateFixture({
			registry: loaded,
			project: managedProject({
				config: { slug: "acme" },
				modules: [],
				installs: [
					{ definitionId: "test-refusal", targets: [{ kind: "project" }] },
				],
			}),
		});

		const logError = vi.spyOn(log, "error").mockImplementation(() => {});
		const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
			throw new Error(`exit:${code ?? 0}`);
		});

		fixture.applyInstalledPlan.mockImplementation(
			(projectRoot, config, installs) =>
				applyInstalledPlan(projectRoot, config, installs, {
					node: "22.11.0",
					pnpm: "10.12.1",
				}),
		);

		try {
			await expect(runUpdate({}, fixture.layer)).rejects.toThrow("exit:1");
			expect(logError).toHaveBeenCalledExactlyOnceWith(message);
			expect(exit).toHaveBeenCalledWith(1);
		} finally {
			registry.mockRestore();
			logError.mockRestore();
			exit.mockRestore();
		}
	},
);

it.effect("re-applies the plan with the manifest installs", () => {
	const project = managedProject({
		installs: [{ definitionId: "tailwind", targets: [{ kind: "project" }] }],
	});

	const fixture = updateFixture({ project });
	return Effect.gen(function* () {
		yield* runUpdateEffect({});

		expect(fixture.loadManagedProject).toHaveBeenCalledWith(".", "update");
		expect(fixture.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ slug: "acme", web: "nextjs" },
			[
				{
					definitionId: "tailwind",
					targets: [{ kind: "project" }],
				},
			],
			undefined,
			undefined,
		);

		const [, config, installs] = fixture.applyInstalledPlan.mock.calls[0] ?? [];
		expect(config).toBe(project.config);
		expect(installs).toBe(project.manifest.installs);
	}).pipe(Effect.provide(fixture.layer));
});

it.effect("warns when a configured secondary web app is missing", () => {
	const fixture = updateFixture({
		project: managedProject({
			config: {
				slug: "acme",
				web: "nextjs",
				webApps: [{ name: "admin", framework: "nextjs" }],
			},
		}),
	});

	return Effect.gen(function* () {
		yield* runUpdateEffect({});

		expect(fixture.logWarn).toHaveBeenCalledOnce();
		expect(fixture.logWarn).toHaveBeenCalledWith(
			"We skipped the admin web app because its folder is missing. Run forge remove admin to drop it from your config.",
		);
	}).pipe(Effect.provide(fixture.layer));
});

it.effect("does not warn when a configured secondary web app exists", () => {
	const fixture = updateFixture({
		project: managedProject({
			config: {
				slug: "acme",
				web: "nextjs",
				webApps: [{ name: "admin", framework: "nextjs" }],
			},
			modules: [adminModule],
		}),
	});

	return Effect.gen(function* () {
		yield* runUpdateEffect({});
		expect(fixture.logWarn).not.toHaveBeenCalled();
	}).pipe(Effect.provide(fixture.layer));
});

it.effect("runs the Promise command wrapper with an injected layer", () => {
	const fixture = updateFixture({});

	return Effect.promise(() => runUpdate({}, fixture.layer)).pipe(
		Effect.tap(() =>
			Effect.sync(() => {
				expect(fixture.applyInstalledPlan).toHaveBeenCalledOnce();
			}),
		),
	);
});

it.effect("prints the intro before applying the plan", () => {
	const fixture = updateFixture({});
	return Effect.gen(function* () {
		yield* runUpdateEffect({});

		expect(fixture.intro).toHaveBeenCalledOnce();
		expect(fixture.intro).toHaveBeenCalledWith(
			"We're reconciling your installed addons and templates...",
		);

		const introOrder =
			fixture.intro.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY;

		const applyOrder =
			fixture.applyInstalledPlan.mock.invocationCallOrder[0] ?? 0;

		expect(introOrder).toBeLessThan(applyOrder);
	}).pipe(Effect.provide(fixture.layer));
});

it.effect("forwards opted-in registries", () => {
	const fixture = updateFixture({
		project: managedProject({ registries: ["@acme/forge-sentry"] }),
	});

	return Effect.gen(function* () {
		yield* runUpdateEffect({});

		expect(fixture.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ slug: "acme", web: "nextjs" },
			[],
			undefined,
			["@acme/forge-sentry"],
		);
	}).pipe(Effect.provide(fixture.layer));
});

it.effect("forwards the selected conflict resolution policy", () => {
	const fixture = updateFixture({});
	return Effect.gen(function* () {
		yield* runUpdateEffect({ "keep-user": true });

		expect(fixture.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ slug: "acme", web: "nextjs" },
			[],
			undefined,
			undefined,
			{ resolutionPolicy: "keep-user" },
		);
	}).pipe(Effect.provide(fixture.layer));
});

it.effect("reports registry package version changes", () => {
	const fixture = updateFixture({
		project: managedProject({
			registries: ["@acme/forge-sentry"],
			registryDescriptors: [
				{
					apiVersion: 1,
					id: "@acme/forge-sentry",
					source: "npm",
					units: [{ id: "@acme/sentry", kind: "addon" }],
					version: "1.4.2",
				},
			],
		}),
		registry: {
			catalog: [],
			descriptors: [
				{
					apiVersion: 1,
					id: "@acme/forge-sentry",
					source: "npm",
					units: [{ id: "@acme/sentry", kind: "addon" }],
					version: "1.5.0",
				},
			],
			registry: {
				adapters: [],
				addons: [],
				frameworks: [],
				templates: [],
				recipes: [],
			},
		},
	});

	return Effect.gen(function* () {
		yield* runUpdateEffect({});

		expect(fixture.loadProjectRegistry).toHaveBeenCalledWith(".", [
			"@acme/forge-sentry",
		]);

		expect(fixture.logInfo).toHaveBeenCalledWith(
			"@acme/forge-sentry 1.4.2 -> 1.5.0.",
		);
	}).pipe(Effect.provide(fixture.layer));
});
