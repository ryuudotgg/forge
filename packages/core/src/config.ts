import { dirname, join, relative } from "node:path";
import { FileSystem } from "@effect/platform";
import { Effect, Schema } from "effect";
import {
	DiscoveryError,
	DuplicateModuleIdError,
	ModuleConfigError,
	ModuleIdGenerationError,
} from "./errors";
import { formatJson } from "./format/json";
import { decodeJsonString } from "./json";

const MODULE_CONFIG_FILE = "forge.json";

const MODULE_ID_LENGTH = 5;
const MODULE_ID_ATTEMPTS = 32;
const MODULE_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz";

const MODULE_IGNORED_DIRS = new Set([
	".cache",
	".forge",
	".git",
	".next",
	".nuxt",
	".turbo",
	".yarn",
	"coverage",
	"dist",
	"node_modules",
]);

export const ModuleIdSchema = Schema.String.pipe(
	Schema.pattern(new RegExp(`^[a-z]{${String(MODULE_ID_LENGTH)}}$`)),
);

export type ModuleId = typeof ModuleIdSchema.Type;

export const TemplateSchema = Schema.Struct({
	id: Schema.String,
	version: Schema.Number.pipe(Schema.int(), Schema.positive()),
});

export type Template = typeof TemplateSchema.Type;

export const SlotsSchema = Schema.Record({
	key: Schema.String,
	value: Schema.String,
});

export type Slots = typeof SlotsSchema.Type;

export const AppConfigSchema = Schema.Struct({
	id: ModuleIdSchema,
	type: Schema.Literal("app"),
	framework: Schema.String,
	template: TemplateSchema,
	slots: SlotsSchema,
});

export type AppConfig = typeof AppConfigSchema.Type;

export const PackageConfigSchema = Schema.Struct({
	id: ModuleIdSchema,
	type: Schema.Literal("package"),
	packageType: Schema.String,
	template: TemplateSchema,
	capabilities: Schema.optionalWith(Schema.Array(Schema.String), {
		default: () => [],
	}),
	slots: SlotsSchema,
});

export type PackageConfig = typeof PackageConfigSchema.Type;

export const ConfigSchema = Schema.Union(AppConfigSchema, PackageConfigSchema);
export type Config = typeof ConfigSchema.Type;

export type DiscoveredModule = Config & {
	readonly packageName?: string;
	readonly root: string;
};

function moduleConfigPath(moduleRoot: string) {
	return join(moduleRoot, MODULE_CONFIG_FILE);
}

function randomModuleId() {
	const values = crypto.getRandomValues(new Uint32Array(MODULE_ID_LENGTH));
	return values.reduce((result, value) => {
		const index = value % MODULE_ID_ALPHABET.length;
		const char = MODULE_ID_ALPHABET[index] ?? "a";
		return result + char;
	}, "");
}

function normalizeRelativePath(projectRoot: string, path: string) {
	const normalized = relative(projectRoot, path);
	return normalized === "" ? "." : normalized;
}

function maybeReadPackageName(
	fs: FileSystem.FileSystem,
	moduleRoot: string,
): Effect.Effect<string | undefined> {
	return Effect.gen(function* () {
		const packageJsonPath = join(moduleRoot, "package.json");
		const exists = yield* fs
			.exists(packageJsonPath)
			.pipe(Effect.catchAll(() => Effect.succeed(false)));

		if (!exists) return undefined;

		const raw = yield* fs
			.readFileString(packageJsonPath)
			.pipe(Effect.catchAll(() => Effect.succeed("")));

		if (raw === "") return undefined;

		const parsed = yield* decodeJsonString(
			raw,
			Schema.Struct({ name: Schema.optional(Schema.String) }),
			{ onParseError: () => undefined, onValidationError: () => undefined },
		).pipe(Effect.catchAll(() => Effect.void));

		return parsed?.name;
	});
}

function scanModuleRoots(
	fs: FileSystem.FileSystem,
	projectRoot: string,
	currentPath: string,
): Effect.Effect<string[], unknown> {
	return Effect.gen(function* () {
		const entries = yield* fs
			.readDirectory(currentPath)
			.pipe(
				Effect.catchTag("SystemError", () => Effect.succeed([] as string[])),
			);

		const roots: string[] = [];
		if (entries.includes(MODULE_CONFIG_FILE)) roots.push(currentPath);

		for (const entry of entries) {
			if (entry === MODULE_CONFIG_FILE || MODULE_IGNORED_DIRS.has(entry))
				continue;

			const fullPath = join(currentPath, entry);
			const stat = yield* fs
				.stat(fullPath)
				.pipe(Effect.catchTag("SystemError", () => Effect.succeed(null)));

			if (!stat?.type || stat.type !== "Directory") continue;
			if (relative(projectRoot, fullPath).startsWith("..")) continue;

			roots.push(...(yield* scanModuleRoots(fs, projectRoot, fullPath)));
		}

		return roots;
	});
}

export class ConfigStore extends Effect.Service<ConfigStore>()("ConfigStore", {
	accessors: true,
	effect: Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;

		const read = Effect.fn("ConfigStore.read")(function* (moduleRoot: string) {
			const path = moduleConfigPath(moduleRoot);
			const exists = yield* fs.exists(path);

			if (!exists)
				return yield* new ModuleConfigError({
					filePath: path,
					message: "Module Config Not Found",
				});

			const raw = yield* fs.readFileString(path).pipe(
				Effect.catchTag(
					"SystemError",
					() =>
						new ModuleConfigError({
							filePath: path,
							message: "Module Config Read Failed",
						}),
				),
			);

			return yield* decodeJsonString(raw, ConfigSchema, {
				onParseError: (message) =>
					new ModuleConfigError({
						filePath: path,
						message: `Module Config Parse Failed: ${message}`,
					}),

				onValidationError: (issues) =>
					new ModuleConfigError({
						filePath: path,
						message: `Invalid Module Config\n${issues
							.map((issue) => `  ${issue}`)
							.join("\n")}`,
					}),
			});
		});

		const write = Effect.fn("ConfigStore.write")(function* (
			moduleRoot: string,
			config: Config,
		) {
			const path = moduleConfigPath(moduleRoot);
			const dir = dirname(path);

			yield* fs.makeDirectory(dir, { recursive: true }).pipe(
				Effect.catchTag(
					"SystemError",
					() =>
						new ModuleConfigError({
							filePath: path,
							message: "Module Config Directory Failed",
						}),
				),
			);

			yield* fs
				.writeFileString(path, formatJson(config, { compact: false }))
				.pipe(
					Effect.catchTag(
						"SystemError",
						() =>
							new ModuleConfigError({
								filePath: path,
								message: "Module Config Write Failed",
							}),
					),
				);
		});

		const discover = Effect.fn("ConfigStore.discover")(function* (
			projectRoot: string,
		) {
			const roots = yield* scanModuleRoots(fs, projectRoot, projectRoot).pipe(
				Effect.mapError(
					(error) =>
						new DiscoveryError({
							path: projectRoot,
							message: `Module Discovery Failed: ${String(error)}`,
						}),
				),
			);

			const discovered = yield* Effect.forEach(roots, (moduleRoot) =>
				Effect.gen(function* () {
					const config = yield* read(moduleRoot);
					const packageName = yield* maybeReadPackageName(fs, moduleRoot);

					return {
						...config,
						root: normalizeRelativePath(projectRoot, moduleRoot),
						...(packageName ? { packageName } : {}),
					} satisfies DiscoveredModule;
				}),
			);

			const seen = new Map<string, string>();
			for (const module of discovered) {
				const existing = seen.get(module.id);
				if (existing)
					return yield* new DuplicateModuleIdError({
						moduleId: module.id,
						firstPath: existing,
						secondPath: module.root,
						message: "Duplicate Module Id",
					});

				seen.set(module.id, module.root);
			}

			return discovered;
		});

		const generateId = Effect.fn("ConfigStore.generateId")(function* (
			usedIds: ReadonlySet<string>,
		) {
			for (let attempt = 0; attempt < MODULE_ID_ATTEMPTS; attempt++) {
				const id = randomModuleId();
				if (!usedIds.has(id)) return id as ModuleId;
			}

			return yield* new ModuleIdGenerationError({
				message: "Module Id Generation Failed",
			});
		});

		return { discover, generateId, read, write };
	}),
}) {}
