const KEY_ORDER = [
	"$schema",
	"name",
	"version",
	"private",
	"description",
	"keywords",
	"homepage",
	"bugs",
	"repository",
	"funding",
	"license",
	"author",
	"contributors",
	"sideEffects",
	"type",
	"imports",
	"exports",
	"main",
	"module",
	"types",
	"typings",
	"bin",
	"files",
	"workspaces",
	"scripts",
	"overrides",
	"dependencies",
	"devDependencies",
	"peerDependencies",
	"peerDependenciesMeta",
	"optionalDependencies",
	"bundledDependencies",
	"packageManager",
	"engines",
	"publishConfig",
	"pnpm",
];

const ALPHABETICAL_SORT_KEYS = new Set([
	"bin",
	"dependencies",
	"devDependencies",
	"engines",
	"optionalDependencies",
	"overrides",
	"peerDependencies",
	"resolutions",
	"scripts",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortObjectKeys(obj: Record<string, unknown>): Record<string, unknown> {
	const sorted: Record<string, unknown> = {};
	for (const key of Object.keys(obj).sort()) sorted[key] = obj[key];

	return sorted;
}

export function sortPackageJson(
	json: Record<string, unknown>,
): Record<string, unknown> {
	const sorted: Record<string, unknown> = {};
	for (const key of KEY_ORDER) if (key in json) sorted[key] = json[key];

	const remaining = Object.keys(json)
		.filter((key) => !(key in sorted))
		.sort();

	for (const key of remaining) sorted[key] = json[key];
	for (const key of Object.keys(sorted))
		if (ALPHABETICAL_SORT_KEYS.has(key) && isRecord(sorted[key]))
			sorted[key] = sortObjectKeys(sorted[key] as Record<string, unknown>);

	return sorted;
}
