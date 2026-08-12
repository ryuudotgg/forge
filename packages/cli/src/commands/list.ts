import { log } from "@clack/prompts";
import {
	type CatalogEntry,
	type CatalogKind,
	type LoadedDefinitionRegistry,
	loadDefinitionRegistry,
	matchQuery,
} from "@ryuujs/generators";
import color from "picocolors";
import { loadDiscoveryRegistry } from "./lifecycle";

const groupOrder: ReadonlyArray<readonly [CatalogKind, string]> = [
	["framework", "Frameworks"],
	["template", "Templates"],
	["addon", "Addons"],
];

export interface ListOptions {
	readonly kind?: CatalogKind;
	readonly query: string;
}

export function parseCatalogKind(
	value: string | boolean | undefined,
): CatalogKind | undefined {
	if (value === undefined) return undefined;
	if (value === "addon" || value === "framework" || value === "template")
		return value;

	throw new Error(
		'Catalog Kind Invalid: use "addon", "framework", or "template".',
	);
}

export function selectListEntries(
	entries: ReadonlyArray<CatalogEntry>,
	options: ListOptions,
) {
	return entries.filter(
		(entry) =>
			!entry.hidden &&
			(options.kind === undefined || entry.kind === options.kind) &&
			matchQuery(entry, options.query),
	);
}

export function buildJsonEntry(entry: CatalogEntry) {
	const common = {
		id: entry.id,
		kind: entry.kind,
		name: entry.name,
		source: entry.source,
		summary: entry.summary,
		description: entry.description,
		keywords: entry.keywords,
		experimental: entry.experimental,
		available: entry.available,
	};

	if (entry.kind === "addon")
		return {
			...common,
			category: entry.category,
			targetMode: entry.targetMode,
			capabilities: entry.capabilities ?? [],
			frameworks: entry.frameworks ?? [],
			requiredSlots: entry.requiredSlots ?? [],
		};

	if (entry.kind === "framework")
		return {
			...common,
			category: entry.category,
			slots: entry.slots,
		};

	return {
		...common,
		category: entry.category,
		framework: entry.framework,
		version: entry.version,
	};
}

export function buildListEnvelope(
	entries: ReadonlyArray<CatalogEntry>,
	options: ListOptions,
) {
	return {
		forgeListVersion: 1,
		entries: selectListEntries(entries, options).map(buildJsonEntry),
	};
}

interface ColumnWidths {
	readonly id: number;
	readonly name: number;
}

function displayName(entry: CatalogEntry) {
	return `${entry.name}${entry.experimental ? " (experimental)" : ""}`;
}

function formatRow(entry: CatalogEntry, widths: ColumnWidths, summary: string) {
	const name = displayName(entry);
	const namePadding = " ".repeat(widths.name - name.length + 2);
	const idPadding = " ".repeat(widths.id - entry.id.length + 2);

	const provenance =
		entry.source === "first-party" ? "" : ` ${color.dim(`[${entry.source}]`)}`;

	return `  ${color.bold(name)}${namePadding}${color.dim(entry.id)}${idPadding}${summary}${provenance}`;
}

export function buildListOutput(
	entries: ReadonlyArray<CatalogEntry>,
	options: ListOptions,
) {
	const selected = selectListEntries(entries, options);
	const sections: string[] = [];
	const widths = {
		id: Math.max(0, ...selected.map((entry) => entry.id.length)),
		name: Math.max(0, ...selected.map((entry) => displayName(entry).length)),
	};

	for (const [kind, title] of groupOrder) {
		const rows = selected.filter(
			(entry) => entry.available && entry.kind === kind,
		);

		if (rows.length === 0) continue;

		sections.push(
			[
				color.bold(color.cyan(title)),
				...rows.map((entry) => formatRow(entry, widths, entry.summary)),
			].join("\n"),
		);
	}

	const announced = selected.filter((entry) => !entry.available);
	if (announced.length > 0)
		sections.push(
			color.dim(
				[
					color.bold(color.cyan("Coming Soon")),
					...announced.map((entry) =>
						formatRow(entry, widths, color.dim(`[${entry.kind}]`)),
					),
				].join("\n"),
			),
		);

	const noun = selected.length === 1 ? "entry" : "entries";
	sections.push(`${selected.length} ${noun}. Run forge info <id> for details.`);

	return `${sections.join("\n\n")}\n`;
}

export async function runList(
	query: string | undefined,
	values: Record<string, string | boolean | undefined>,
	loadRegistry: () => Promise<LoadedDefinitionRegistry> = () =>
		loadDiscoveryRegistry("."),
) {
	const loadedRegistry = await (values["first-party"] === true
		? loadDefinitionRegistry()
		: loadRegistry());

	const options = {
		kind: parseCatalogKind(values.kind),
		query: query ?? "",
	};

	if (values.json === true) {
		console.log(
			JSON.stringify(
				buildListEnvelope(loadedRegistry.catalog, options),
				null,
				"\t",
			),
		);

		return;
	}

	log.message(buildListOutput(loadedRegistry.catalog, options));
}
