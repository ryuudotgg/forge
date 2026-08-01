import type { CatalogEntry } from "./types";

export function matchQuery(entry: CatalogEntry, query: string) {
	if (query.length === 0) return true;

	const haystack = [
		entry.id,
		entry.name,
		entry.summary,
		entry.description,
		...entry.keywords,
	]
		.join(" ")
		.toLowerCase();

	return haystack.includes(query.toLowerCase());
}
