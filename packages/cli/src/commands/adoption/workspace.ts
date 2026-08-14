import { Effect, Result, Schema } from "effect";

const DependencyRecordSchema = Schema.Record(Schema.String, Schema.String);

export const PackageJsonSchema = Schema.fromJsonString(
	Schema.Struct({
		name: Schema.optional(Schema.String),
		bin: Schema.optional(Schema.Unknown),
		dependencies: Schema.optional(DependencyRecordSchema),
		devDependencies: Schema.optional(DependencyRecordSchema),
		engines: Schema.optional(DependencyRecordSchema),
		exports: Schema.optional(Schema.Unknown),
		main: Schema.optional(Schema.String),
		module: Schema.optional(Schema.String),
		optionalDependencies: Schema.optional(DependencyRecordSchema),
		peerDependencies: Schema.optional(DependencyRecordSchema),
		workspaces: Schema.optional(
			Schema.Union([
				Schema.Array(Schema.String),
				Schema.Struct({ packages: Schema.Array(Schema.String) }),
			]),
		),
	}),
);

export const ComponentsJsonSchema = Schema.fromJsonString(
	Schema.Struct({ style: Schema.optional(Schema.String) }),
);

const PnpmWorkspaceSchema = Schema.Struct({
	catalogEntries: Schema.Array(
		Schema.Struct({
			catalog: Schema.optional(Schema.String),
			name: Schema.String,
			version: Schema.String,
		}),
	),
	packages: Schema.optional(Schema.Array(Schema.String)),
});

export type PackageJson = typeof PackageJsonSchema.Type;

export interface CatalogEntry {
	readonly catalog?: string;
	readonly name: string;
	readonly version: string;
}

export class AdoptionFileReadError extends Schema.TaggedError<AdoptionFileReadError>()(
	"AdoptionFileReadError",
	{ detail: Schema.String, filePath: Schema.String, message: Schema.String },
) {}

export class AdoptionFileParseError extends Schema.TaggedError<AdoptionFileParseError>()(
	"AdoptionFileParseError",
	{ detail: Schema.String, filePath: Schema.String, message: Schema.String },
) {}

export class AdoptionTraversalLimitError extends Schema.TaggedError<AdoptionTraversalLimitError>()(
	"AdoptionTraversalLimitError",
	{ detail: Schema.String, filePath: Schema.String, message: Schema.String },
) {}

export function workspacePatterns(
	workspaces: NonNullable<PackageJson["workspaces"]>,
) {
	return "packages" in workspaces ? workspaces.packages : workspaces;
}

function braceAlternatives(pattern: string): ReadonlyArray<string> | undefined {
	const start = pattern.indexOf("{");
	if (start === -1) return pattern.includes("}") ? undefined : [pattern];

	const end = pattern.indexOf("}", start + 1);
	if (end === -1 || pattern.slice(start + 1, end).includes("{"))
		return undefined;

	const choices = pattern.slice(start + 1, end).split(",");
	if (choices.length < 2 || choices.some((choice) => choice.length === 0))
		return undefined;

	const expanded: string[] = [];
	for (const choice of choices) {
		const alternatives = braceAlternatives(
			`${pattern.slice(0, start)}${choice}${pattern.slice(end + 1)}`,
		);

		if (alternatives === undefined) return undefined;
		expanded.push(...alternatives);
	}

	return expanded;
}

function globSource(pattern: string): string {
	let source = "";
	for (let index = 0; index < pattern.length; index += 1) {
		const character = pattern[index];
		if (character === "*") {
			if (pattern[index + 1] === "*") {
				if (pattern[index + 2] === "/") {
					source += "(?:[^/]+/)*";
					index += 2;
				} else {
					source += ".*";
					index += 1;
				}
			} else source += "[^/]*";
		} else if (character === "?") source += "[^/]";
		else if (character !== undefined)
			source += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
	}

	return source;
}

function globAlternatives(pattern: string): ReadonlyArray<string> | undefined {
	const normalized = pattern.replace(/^\.\//, "").replace(/\/$/, "");
	if (
		normalized.length === 0 ||
		normalized.startsWith("/") ||
		normalized.split("/").includes("..")
	)
		return undefined;

	return braceAlternatives(normalized);
}

function globPattern(pattern: string): RegExp | undefined {
	const alternatives = globAlternatives(pattern);
	if (alternatives === undefined) return undefined;

	return new RegExp(`^(?:${alternatives.map(globSource).join("|")})$`);
}

function literalPrefix(pattern: string): string {
	const prefix: string[] = [];
	for (const segment of pattern.split("/")) {
		if (segment.includes("*") || segment.includes("?")) break;
		prefix.push(segment);
	}
	return prefix.join("/");
}

function isCoveredBy(frontier: string, other: string): boolean {
	return other.length === 0 || frontier.startsWith(`${other}/`);
}

export function workspaceFrontiers(
	patterns: ReadonlyArray<string>,
): ReadonlyArray<string> {
	const frontiers = new Set<string>();

	for (const pattern of patterns) {
		if (pattern.startsWith("!")) continue;

		const alternatives = globAlternatives(pattern);
		if (alternatives === undefined) continue;

		for (const alternative of alternatives)
			frontiers.add(literalPrefix(alternative));
	}

	const uniqueFrontiers = [...frontiers];
	return uniqueFrontiers.filter(
		(frontier) =>
			!uniqueFrontiers.some(
				(other) => other !== frontier && isCoveredBy(frontier, other),
			),
	);
}

export function matchesWorkspacePatterns(
	path: string,
	patterns: ReadonlyArray<string>,
): boolean {
	const included = patterns
		.filter((pattern) => !pattern.startsWith("!"))
		.map(globPattern)
		.filter((pattern) => pattern !== undefined);

	const excluded = patterns
		.filter((pattern) => pattern.startsWith("!"))
		.map((pattern) => globPattern(pattern.slice(1)))
		.filter((pattern) => pattern !== undefined);

	return (
		included.some((pattern) => pattern.test(path)) &&
		!excluded.some((pattern) => pattern.test(path))
	);
}

function yamlScalar(value: string): string | undefined {
	const trimmed = value.trim();

	if (trimmed.length === 0) return undefined;
	if (trimmed.startsWith('"')) {
		if (!trimmed.endsWith('"')) return undefined;
		const decoded = Schema.decodeResult(Schema.fromJsonString(Schema.String))(
			trimmed,
		);

		return Result.isSuccess(decoded) ? decoded.success : undefined;
	}

	if (trimmed.startsWith("'")) {
		if (!trimmed.endsWith("'")) return undefined;
		return trimmed.slice(1, -1).replace(/''/g, "'");
	}

	const comment = trimmed.indexOf(" #");
	return (comment === -1 ? trimmed : trimmed.slice(0, comment)).trim();
}

function yamlEntry(line: string): { key: string; value: string } | undefined {
	const separator = line.indexOf(":");
	if (separator < 1) return undefined;

	const key = yamlScalar(line.slice(0, separator));
	const value = yamlScalar(line.slice(separator + 1));
	return key === undefined || value === undefined ? undefined : { key, value };
}

export function parsePnpmWorkspace(raw: string, filePath: string) {
	const packages: string[] = [];
	const catalogEntries: CatalogEntry[] = [];
	const invalidDetails: string[] = [];

	let section: "catalog" | "catalogs" | "packages" | undefined;
	let currentCatalog: string | undefined;
	let catalogIndent: number | undefined;
	let catalogsIndent: number | undefined;
	let catalogEntryIndent: number | undefined;

	if (raw.trim().length === 0) invalidDetails.push("Workspace YAML is empty.");

	for (const [index, line] of raw.split(/\r?\n/).entries()) {
		if (line.trim().length === 0 || line.trimStart().startsWith("#")) continue;
		if (line.includes("\t")) {
			invalidDetails.push(`Tabs are not supported on line ${index + 1}.`);
			continue;
		}

		const indent = line.length - line.trimStart().length;
		const trimmed = line.trim();
		if (section === "packages" && trimmed.startsWith("- ")) {
			const pattern = yamlScalar(trimmed.slice(2));

			if (pattern === undefined)
				invalidDetails.push(`Invalid package pattern on line ${index + 1}.`);
			else packages.push(pattern);

			continue;
		}

		if (indent === 0) {
			currentCatalog = undefined;
			catalogIndent = undefined;
			catalogsIndent = undefined;
			catalogEntryIndent = undefined;

			if (trimmed === "packages:") section = "packages";
			else if (trimmed === "catalog:") section = "catalog";
			else if (trimmed === "catalogs:") section = "catalogs";
			else {
				section = undefined;
				if (
					/^(?:catalog|catalogs|packages)\s*:/.test(trimmed) ||
					!trimmed.includes(":")
				)
					invalidDetails.push(`Unsupported YAML syntax on line ${index + 1}.`);
			}

			continue;
		}

		if (section === "catalog") {
			catalogIndent ??= indent;

			const entry = yamlEntry(trimmed);
			if (indent !== catalogIndent || entry === undefined)
				invalidDetails.push(`Invalid catalog entry on line ${index + 1}.`);
			else catalogEntries.push({ name: entry.key, version: entry.value });

			continue;
		}

		if (section === "catalogs") {
			catalogsIndent ??= indent;

			if (indent === catalogsIndent && trimmed.endsWith(":")) {
				currentCatalog = yamlScalar(trimmed.slice(0, -1));
				catalogEntryIndent = undefined;

				if (currentCatalog === undefined)
					invalidDetails.push(`Invalid catalog name on line ${index + 1}.`);

				continue;
			}

			if (currentCatalog !== undefined && indent > catalogsIndent) {
				catalogEntryIndent ??= indent;

				const entry = yamlEntry(trimmed);
				if (indent !== catalogEntryIndent || entry === undefined)
					invalidDetails.push(
						`Invalid scoped catalog entry on line ${index + 1}.`,
					);
				else
					catalogEntries.push({
						catalog: currentCatalog,
						name: entry.key,
						version: entry.value,
					});

				continue;
			}

			invalidDetails.push(
				`Invalid scoped catalog syntax on line ${index + 1}.`,
			);

			continue;
		}

		if (section === "packages")
			invalidDetails.push(`Invalid package entry on line ${index + 1}.`);
	}

	const decoded = Schema.decodeResult(PnpmWorkspaceSchema)({
		catalogEntries,
		...(packages.length === 0 ? {} : { packages }),
	});

	if (invalidDetails.length > 0 || Result.isFailure(decoded))
		return Effect.fail(
			new AdoptionFileParseError({
				detail: [
					...invalidDetails,
					...(Result.isFailure(decoded) ? [String(decoded.failure)] : []),
				].join("\n"),
				filePath,
				message: `Adoption File Parse Failed: ${filePath}`,
			}),
		);

	return Effect.succeed({
		catalogEntries: decoded.success.catalogEntries,
		packages: decoded.success.packages ?? [],
	});
}
