import { log } from "@clack/prompts";
import {
	type AddonCatalogEntry,
	type CatalogEntry,
	getCatalogEntry,
	listCatalogEntries,
	matchQuery,
} from "@ryuujs/generators";
import color from "picocolors";
import { listAnd, listOr } from "../utils/list";
import { buildJsonEntry } from "./list";

function formatValues(values: ReadonlyArray<string>) {
	return listAnd.format(values);
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
			value: formatValues(entry.frameworks ?? []),
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

export function buildInfoOutput(entry: CatalogEntry) {
	const header = `${color.bold(entry.name)} ${color.dim(entry.id)}`;

	if (!entry.available)
		return `${[
			header,
			formatRows([
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

export function buildInfoEnvelope(entry: CatalogEntry) {
	return {
		forgeListVersion: 1,
		entry: buildJsonEntry(entry),
	};
}

export async function runInfo(
	id: string,
	values: Record<string, string | boolean | undefined>,
) {
	const entry = getCatalogEntry(id);
	if (!entry || entry.hidden) {
		log.error(buildInfoNotFoundMessage(id, listCatalogEntries()));
		process.exit(1);
	}
	if (values.json === true) {
		console.log(JSON.stringify(buildInfoEnvelope(entry), null, "\t"));
		return;
	}

	log.message(buildInfoOutput(entry));
}
