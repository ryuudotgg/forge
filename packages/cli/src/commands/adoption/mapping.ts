import {
	type PackageManager,
	packageManagers,
	type Runtime,
	runtimes,
} from "@ryuujs/core";
import {
	databaseProviders,
	databases,
	type ForgeConfig,
} from "@ryuujs/generators";
import type { CatalogEntry, PackageJson } from "./workspace";

export type ModuleKind =
	| "auth"
	| "backend-app"
	| "db"
	| "trpc"
	| "ui"
	| "web-app";

export type DependencySection =
	| "dependencies"
	| "devDependencies"
	| "optionalDependencies"
	| "peerDependencies";

export interface CapturedDependencyPin {
	readonly name: string;
	readonly section: DependencySection;
	readonly specifier: string;
	readonly version?: string;
}

export interface AdoptedModuleVersions {
	readonly dependencies: ReadonlyArray<CapturedDependencyPin>;
	readonly root: string;
}

export interface ModuleMappingProposal {
	readonly evidence: string;
	readonly proposal: ModuleKind | "unadopted";
	readonly root: string;
}

const dependencySections: ReadonlyArray<DependencySection> = [
	"dependencies",
	"devDependencies",
	"optionalDependencies",
	"peerDependencies",
];

export function dependencyNames(packageJson: PackageJson): ReadonlySet<string> {
	return new Set(Object.keys(packageJson.dependencies ?? {}));
}

export function allDependencyNames(
	packageJson: PackageJson,
): ReadonlySet<string> {
	return new Set(
		dependencySections.flatMap((section) =>
			Object.keys(packageJson[section] ?? {}),
		),
	);
}

export function hasTanstackRouterApplicationDependencies(
	packageJson: PackageJson,
): boolean {
	const dependencies = dependencyNames(packageJson);
	if (!dependencies.has("@tanstack/react-router")) return false;

	if (
		["next", "react-router", "@tanstack/react-start"].some((dependency) =>
			dependencies.has(dependency),
		)
	)
		return false;

	return allDependencyNames(packageJson).has("@tanstack/router-plugin");
}

// A library can depend on hono to compose routes or middleware. Only a package
// that also serves them is an app we can adopt as the standalone backend.
export function isBackendPackage(
	packageJson: PackageJson,
	hasTanstackRouterConfig: boolean,
): boolean {
	const dependencies = dependencyNames(packageJson);
	if (!dependencies.has("hono") || !dependencies.has("@hono/node-server"))
		return false;

	if (
		["next", "react-router", "@tanstack/react-start"].some((dependency) =>
			dependencies.has(dependency),
		)
	)
		return false;

	return !(
		hasTanstackRouterConfig &&
		hasTanstackRouterApplicationDependencies(packageJson)
	);
}

export function oneDetected<T>(
	values: ReadonlyArray<T | undefined>,
): T | undefined {
	const detected = new Set(values.filter((value) => value !== undefined));
	return detected.size === 1 ? detected.values().next().value : undefined;
}

export function packageManagerFromLockfiles(
	lockfiles: ReadonlySet<string>,
): PackageManager | undefined {
	return oneDetected([
		lockfiles.has("pnpm-lock.yaml")
			? packageManagers.pnpm.displayName
			: undefined,
		lockfiles.has("package-lock.json")
			? packageManagers.npm.displayName
			: undefined,
		lockfiles.has("yarn.lock") ? packageManagers.yarn.displayName : undefined,
		lockfiles.has("bun.lock") || lockfiles.has("bun.lockb")
			? packageManagers.bun.displayName
			: undefined,
	]);
}

export function runtimeFromPackageJson(
	packageJson: PackageJson | undefined,
	hasNvmrc: boolean,
): Runtime | undefined {
	return oneDetected([
		hasNvmrc || packageJson?.engines?.node !== undefined
			? runtimes.node.displayName
			: undefined,
		packageJson?.engines?.bun !== undefined
			? runtimes.bun.displayName
			: undefined,
		packageJson?.engines?.deno !== undefined
			? runtimes.deno.displayName
			: undefined,
	]);
}

export function moduleProposal(
	root: string,
	packageJson: PackageJson,
	hasComponentsJson: boolean,
	hasTanstackRouterConfig: boolean,
): ModuleMappingProposal {
	const dependencies = dependencyNames(packageJson);
	const signatures: Array<{
		readonly evidence: string;
		readonly proposal: ModuleKind;
	}> = [];

	if (dependencies.has("next"))
		signatures.push({
			evidence: "found next in its dependencies",
			proposal: "web-app",
		});

	if (dependencies.has("@tanstack/react-start"))
		signatures.push({
			evidence: "found @tanstack/react-start in its dependencies",
			proposal: "web-app",
		});

	if (
		hasTanstackRouterConfig &&
		hasTanstackRouterApplicationDependencies(packageJson)
	)
		signatures.push({
			evidence: "found @tanstack/react-router in its dependencies",
			proposal: "web-app",
		});

	if (dependencies.has("react-router"))
		signatures.push({
			evidence: "found react-router in its dependencies",
			proposal: "web-app",
		});

	if (isBackendPackage(packageJson, hasTanstackRouterConfig))
		signatures.push({
			evidence: "found hono and @hono/node-server in its dependencies",
			proposal: "backend-app",
		});

	if (dependencies.has("drizzle-orm"))
		signatures.push({
			evidence: "found drizzle-orm in its dependencies",
			proposal: "db",
		});

	if (dependencies.has("@prisma/client"))
		signatures.push({
			evidence: "found @prisma/client in its dependencies",
			proposal: "db",
		});

	if (dependencies.has("better-auth"))
		signatures.push({
			evidence: "found better-auth in its dependencies",
			proposal: "auth",
		});

	if (dependencies.has("@trpc/server"))
		signatures.push({
			evidence: "found @trpc/server in its dependencies",
			proposal: "trpc",
		});

	if (dependencies.has("@base-ui/react"))
		signatures.push({
			evidence: "found @base-ui/react in its dependencies",
			proposal: "ui",
		});

	if (hasComponentsJson)
		signatures.push({
			evidence: "found components.json in the module",
			proposal: "ui",
		});

	const winner = signatures[0];
	if (winner !== undefined)
		return {
			evidence: `${winner.evidence}${signatures
				.slice(1)
				.map((signature) => `; also ${signature.evidence}`)
				.join("")}`,
			proposal: winner.proposal,
			root,
		};

	return {
		evidence: "found no known adoption signature",
		proposal: "unadopted",
		root,
	};
}

function resolvedCatalogVersion(
	name: string,
	specifier: string,
	catalogEntries: ReadonlyArray<CatalogEntry>,
): string | undefined {
	if (!specifier.startsWith("catalog:")) return specifier;

	const catalog = specifier.slice("catalog:".length) || undefined;
	return catalogEntries.find(
		(entry) => entry.name === name && entry.catalog === catalog,
	)?.version;
}

export function captureVersions(
	root: string,
	packageJson: PackageJson,
	catalogEntries: ReadonlyArray<CatalogEntry>,
): AdoptedModuleVersions {
	const dependencies = dependencySections.flatMap((section) =>
		Object.entries(packageJson[section] ?? {}).map(([name, specifier]) => ({
			name,
			section,
			specifier,
			version: resolvedCatalogVersion(name, specifier, catalogEntries),
		})),
	);

	return { dependencies, root };
}

export function databaseFromDependencies(
	dependencies: ReadonlySet<string>,
): ForgeConfig["database"] {
	return oneDetected([
		[
			"@planetscale/database",
			"@prisma/adapter-mariadb",
			"@prisma/adapter-planetscale",
			"mysql2",
		].some((name) => dependencies.has(name))
			? databases.normalize("mysql")
			: undefined,
		[
			"@neondatabase/serverless",
			"@prisma/adapter-neon",
			"@prisma/adapter-pg",
			"pg",
			"postgres",
		].some((name) => dependencies.has(name))
			? databases.normalize("postgresql")
			: undefined,
		[
			"@libsql/client",
			"@prisma/adapter-better-sqlite3",
			"@prisma/adapter-libsql",
			"better-sqlite3",
		].some((name) => dependencies.has(name))
			? databases.normalize("sqlite")
			: undefined,
	]);
}

export function providerFromSignals(
	database: ForgeConfig["database"],
	dependencies: ReadonlySet<string>,
	envNames: ReadonlySet<string>,
): ForgeConfig["databaseProvider"] {
	if (database === databases.normalize("mysql"))
		return oneDetected([
			dependencies.has("@planetscale/database") ||
			dependencies.has("@prisma/adapter-planetscale") ||
			envNames.has("PLANETSCALE_DATABASE_URL")
				? databaseProviders.normalize("planetscale")
				: undefined,
		]);

	if (database === databases.normalize("postgresql"))
		return oneDetected([
			dependencies.has("@prisma/adapter-neon") ||
			envNames.has("NEON_DATABASE_URL")
				? databaseProviders.normalize("neon")
				: undefined,
			envNames.has("NILE_DATABASE_URL") || envNames.has("NILEDB_URL")
				? databaseProviders.normalize("nile")
				: undefined,
			envNames.has("SUPABASE_DATABASE_URL") || envNames.has("SUPABASE_DB_URL")
				? databaseProviders.normalize("supabase")
				: undefined,
			envNames.has("PRISMA_DATABASE_URL") || envNames.has("PRISMA_POSTGRES_URL")
				? databaseProviders.normalize("prisma-postgres")
				: undefined,
		]);

	if (database === databases.normalize("sqlite"))
		return oneDetected([
			envNames.has("TURSO_DATABASE_URL")
				? databaseProviders.normalize("turso")
				: undefined,
		]);

	return undefined;
}

export function envNames(rawFiles: ReadonlyArray<string>): ReadonlySet<string> {
	const names = rawFiles.flatMap((raw) =>
		raw.split(/\r?\n/).flatMap((line) => {
			const match = line.match(
				/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/,
			);
			return match?.[1] === undefined ? [] : [match[1]];
		}),
	);

	return new Set(names);
}
