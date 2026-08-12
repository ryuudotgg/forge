import { log } from "@clack/prompts";
import {
	type AddonCatalogEntry,
	type CatalogEntry,
	type LoadedDefinitionRegistry,
	loadDefinitionRegistry,
	matchQuery,
} from "@ryuujs/generators";
import color from "picocolors";
import { listAnd, listOr } from "../utils/list";
import { loadDiscoveryRegistry } from "./lifecycle";
import { buildJsonEntry } from "./list";

function formatValues(values: ReadonlyArray<string>) {
	return listAnd.format(values);
}

function publisherVersion(
	entry: CatalogEntry,
	descriptors: LoadedDefinitionRegistry["descriptors"],
) {
	if (entry.source === "first-party") return undefined;

	const descriptor = descriptors.find(({ id }) => id === entry.source);
	if (descriptor === undefined)
		throw new Error(`Catalog Publisher Missing: ${entry.source}`);

	return descriptor.version;
}

function publisherValue(
	entry: CatalogEntry,
	descriptors: LoadedDefinitionRegistry["descriptors"],
) {
	if (entry.source === "first-party") return "Ryuu (first party)";
	return `${entry.source} ${publisherVersion(entry, descriptors)}`;
}

interface InfoRow {
	readonly label: string;
	readonly value: string;
}

function addonRows(entry: AddonCatalogEntry) {
	const rows: InfoRow[] = [
		{ label: "Category:", value: entry.category },
		{
			label: "Targets:",
			value:
				entry.targetMode === "single" ? "Single target" : "Multiple targets",
		},
	];

	if ((entry.capabilities?.length ?? 0) > 0)
		rows.push({
			label: "Capabilities:",
			value: formatValues(entry.capabilities ?? []),
		});

	if ((entry.frameworks?.length ?? 0) > 0)
		rows.push({
			label: "Frameworks:",
			value: formatValues(
				(entry.frameworks ?? []).map((framework) => {
					const source = entry.frameworkSources[framework] ?? entry.source;
					return source === entry.source
						? framework
						: `${framework} ${color.dim(`(via ${source})`)}`;
				}),
			),
		});

	if ((entry.requiredSlots?.length ?? 0) > 0)
		rows.push({
			label: "Required slots:",
			value: formatValues(entry.requiredSlots ?? []),
		});

	return rows;
}

function formatRows(rows: ReadonlyArray<InfoRow>) {
	const labelWidth = Math.max(...rows.map(({ label }) => label.length));

	return rows
		.map(
			({ label, value }) => `${color.dim(label.padEnd(labelWidth))}  ${value}`,
		)
		.join("\n");
}

export function buildInfoOutput(
	entry: CatalogEntry,
	descriptors: LoadedDefinitionRegistry["descriptors"],
) {
	const header = `${color.bold(entry.name)} ${color.dim(entry.id)}`;
	const publisher = {
		label: "Publisher:",
		value: publisherValue(entry, descriptors),
	};

	if (!entry.available)
		return `${[
			header,
			formatRows([
				publisher,
				{
					label: "Availability:",
					value: `${entry.name} isn't available yet.`,
				},
			]),
		].join("\n\n")}\n`;

	const sections = [header, entry.summary];
	if (entry.description !== entry.summary) sections.push(entry.description);

	let rows: InfoRow[];
	if (entry.kind === "addon") rows = addonRows(entry);
	else if (entry.kind === "framework")
		rows = [{ label: "Slots:", value: formatValues(entry.slots) }];
	else
		rows = [
			{ label: "Framework:", value: entry.framework },
			{ label: "Version:", value: `${entry.version}` },
		];

	if (entry.keywords.length > 0)
		rows.push({ label: "Keywords:", value: formatValues(entry.keywords) });

	rows.unshift(publisher);

	return `${[...sections, formatRows(rows)].join("\n\n")}\n`;
}

export function suggestCatalogEntries(
	entries: ReadonlyArray<CatalogEntry>,
	query: string,
) {
	const visible = entries.filter((entry) => !entry.hidden);

	for (let length = query.length; length >= 3; length -= 1) {
		const suggestions = visible.filter((entry) =>
			matchQuery(entry, query.slice(0, length)),
		);

		if (suggestions.length > 0) return suggestions.slice(0, 3);
	}

	return [];
}

export function buildInfoNotFoundMessage(
	id: string,
	entries: ReadonlyArray<CatalogEntry>,
) {
	const suggestions = suggestCatalogEntries(entries, id).map(
		(entry) => entry.id,
	);

	const suffix =
		suggestions.length > 0
			? ` Did you mean ${listOr.format(suggestions)}?`
			: "";

	return `We couldn't find "${id}" in the catalog.${suffix}`;
}

export function buildInfoEnvelope(
	entry: CatalogEntry,
	descriptors: LoadedDefinitionRegistry["descriptors"],
) {
	const version = publisherVersion(entry, descriptors);
	return {
		forgeListVersion: 1,
		entry: {
			...buildJsonEntry(entry),
			...(version === undefined ? {} : { publisherVersion: version }),
		},
	};
}

export async function runInfo(
	id: string,
	values: Record<string, string | boolean | undefined>,
	loadRegistry: () => Promise<LoadedDefinitionRegistry> = () =>
		loadDiscoveryRegistry("."),
) {
	const loadedRegistry = await (values["first-party"] === true
		? loadDefinitionRegistry()
		: loadRegistry());

	const entry = loadedRegistry.catalog.find((candidate) => candidate.id === id);
	if (!entry || entry.hidden) {
		log.error(buildInfoNotFoundMessage(id, loadedRegistry.catalog));
		process.exit(1);
	}

	if (values.json === true) {
		console.log(
			JSON.stringify(
				buildInfoEnvelope(entry, loadedRegistry.descriptors),
				null,
				"\t",
			),
		);

		return;
	}

	log.message(buildInfoOutput(entry, loadedRegistry.descriptors));
}
