import { join } from "node:path";
import { FileSystem } from "@effect/platform";
import type { Generator, ResolvedFile } from "@ryuujs/core";
import {
	ConfigStore,
	CoreLive,
	type Lockfile,
	type Manifest,
	State,
} from "@ryuujs/core";
import type { ForgeConfig } from "@ryuujs/generators";
import { Effect } from "effect";

interface BootstrapContext {
	readonly config: ForgeConfig;
	readonly ordered: ReadonlyArray<Generator<ForgeConfig>>;
	readonly projectRoot: string;
	readonly resolved: ReadonlyArray<ResolvedFile>;
}

const LEGACY_LOCKFILE_PATH = ".forge/forge.lock";

function hasPath(resolvedPaths: ReadonlySet<string>, path: string) {
	return resolvedPaths.has(path);
}

function hasDirectory(resolvedPaths: ReadonlySet<string>, directory: string) {
	const prefix = directory.endsWith("/") ? directory : `${directory}/`;
	for (const path of resolvedPaths) if (path.startsWith(prefix)) return true;
	return false;
}

function buildAppSlots(resolvedPaths: ReadonlySet<string>) {
	const slots: Record<string, string> = {};

	if (hasPath(resolvedPaths, "apps/web/app/layout.tsx"))
		slots.layout = "app/layout.tsx";
	if (hasPath(resolvedPaths, "apps/web/app/page.tsx"))
		slots.page = "app/page.tsx";
	if (hasDirectory(resolvedPaths, "apps/web/app/api")) slots.api = "app/api";
	if (hasDirectory(resolvedPaths, "apps/web/src/trpc")) slots.trpc = "src/trpc";
	if (hasDirectory(resolvedPaths, "apps/web/src/db")) slots.db = "src/db";
	if (hasPath(resolvedPaths, "apps/web/src/lib/auth.ts"))
		slots.auth = "src/lib/auth.ts";
	if (hasPath(resolvedPaths, "apps/web/src/lib/auth-client.ts"))
		slots.authClient = "src/lib/auth-client.ts";

	return slots;
}

function buildUiSlots(resolvedPaths: ReadonlySet<string>) {
	const slots: Record<string, string> = {};

	if (hasPath(resolvedPaths, "packages/ui/src/styles/globals.css"))
		slots.globalsCss = "src/styles/globals.css";
	if (hasPath(resolvedPaths, "packages/ui/src/styles/theme.css"))
		slots.themeCss = "src/styles/theme.css";
	if (hasPath(resolvedPaths, "packages/ui/src/lib/utils.ts"))
		slots.utils = "src/lib/utils.ts";
	if (hasPath(resolvedPaths, "packages/ui/postcss.config.mjs"))
		slots.postcssConfig = "postcss.config.mjs";

	return slots;
}

export function bootstrapProject(context: BootstrapContext) {
	return Effect.gen(function* () {
		const { config, ordered, projectRoot, resolved } = context;
		const fs = yield* FileSystem.FileSystem;
		const resolvedPaths = new Set(resolved.map((file) => file.path));
		const installedGeneratorIds = new Set(
			ordered.map((generator) => generator.id),
		);

		const existingModules = yield* ConfigStore.discover(projectRoot);
		const usedIds = new Set(existingModules.map((module) => module.id));

		const moduleIds = new Map<string, string>();
		const assignModuleId = Effect.fn("bootstrapProject.assignModuleId")(
			function* (moduleRoot: string) {
				const existing = moduleIds.get(moduleRoot);
				if (existing) return existing;

				const next = yield* ConfigStore.generateId(usedIds);
				usedIds.add(next);
				moduleIds.set(moduleRoot, next);
				return next;
			},
		);

		if (installedGeneratorIds.has("frameworks/nextjs")) {
			const appRoot = join(projectRoot, "apps/web");
			const exists = yield* fs.exists(join(appRoot, "package.json"));

			if (exists) {
				yield* ConfigStore.write(appRoot, {
					id: yield* assignModuleId(appRoot),
					type: "app",
					framework: "nextjs",
					template: { id: "base", version: 1 },
					slots: buildAppSlots(resolvedPaths),
				});
			}
		}

		if (installedGeneratorIds.has("ui")) {
			const uiRoot = join(projectRoot, "packages/ui");
			const exists = yield* fs.exists(join(uiRoot, "package.json"));

			if (exists) {
				const capabilities = ["react", "ui"];
				if (config.style === "Tailwind CSS") capabilities.push("tailwind");

				yield* ConfigStore.write(uiRoot, {
					id: yield* assignModuleId(uiRoot),
					type: "package",
					packageType: "library",
					template: { id: "ui", version: 1 },
					capabilities,
					slots: buildUiSlots(resolvedPaths),
				});
			}
		}

		const discovered = yield* ConfigStore.discover(projectRoot);
		const manifest: Manifest = {
			version: 1,
			modules: Object.fromEntries(discovered.map((module) => [module.id, {}])),
			installs: [],
		};

		const lockfile: Lockfile = {
			version: 1,
			resolutions: {},
			provenance: {},
		};

		yield* State.writeManifest(projectRoot, manifest);
		yield* State.writeLockfile(projectRoot, lockfile);

		const legacyLockPath = join(projectRoot, LEGACY_LOCKFILE_PATH);
		const legacyLockExists = yield* fs.exists(legacyLockPath);
		if (legacyLockExists) yield* fs.remove(legacyLockPath);
	}).pipe(Effect.provide(CoreLive));
}
