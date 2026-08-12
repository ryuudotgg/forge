import { getCatalogEntry } from "@ryuujs/generators";

export function addonSupportsWebFramework(
	addonId: string,
	web: string | undefined,
): boolean {
	if (web === undefined) return true;

	const entry = getCatalogEntry(addonId);
	if (entry === undefined || entry.kind !== "addon") return true;

	const frameworks = entry.frameworks;
	if (frameworks === undefined || frameworks.length === 0) return true;

	return frameworks.includes(web);
}
