export function stripNulls<
	T extends Record<string, unknown>,
	Entries extends boolean = false,
>(
	object: T,
	entries?: Entries,
): Entries extends true ? [string, unknown][] : Record<string, unknown>;
export function stripNulls<T>(array: T[]): NonNullable<T>[];
export function stripNulls(
	input: Record<string, unknown> | unknown[],
	entries = false,
) {
	if (Array.isArray(input)) return input.filter((value) => value != null);
	else {
		const entriesArray = Object.entries(input).filter(
			([_, value]) => value != null,
		);

		if (entries) return entriesArray;
		else return Object.fromEntries(entriesArray);
	}
}
