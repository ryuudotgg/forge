/**
 * It'll convert a string to a URL-friendly slug.
 */
export function slugify(input: string): string {
	return input
		.toLowerCase()
		.replace(/[^\w\s-]/g, "") // We remove special characters except whitespace, hyphens, and underscores.
		.replace(/[\s_]+/g, "-") // We replace spaces and underscores with hyphens.
		.replace(/-+/g, "-") // We replace multiple hyphens with a single hyphen.
		.trim();
}
