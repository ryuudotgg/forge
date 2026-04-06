const LINE_WIDTH = 80;

const INDENT = "\t";
const TAB_WIDTH = 2;

export interface FormatJsonOptions {
	readonly compact?: boolean;
}

export function formatJson(
	value: unknown,
	options?: FormatJsonOptions,
): string {
	const compact = options?.compact ?? true;
	return `${serializeValue(value, 0, 0, compact)}\n`;
}

function serializeValue(
	value: unknown,
	depth: number,
	column: number,
	compact: boolean,
): string {
	if (value === null) return "null";

	if (typeof value === "boolean") return String(value);
	if (typeof value === "number") return String(value);

	if (typeof value === "string") return JSON.stringify(value);

	if (Array.isArray(value))
		return serializeArray(value, depth, column, compact);

	if (typeof value === "object")
		return serializeObject(
			value as Record<string, unknown>,
			depth,
			column,
			compact,
		);

	return "null";
}

function serializeArray(
	arr: unknown[],
	depth: number,
	column: number,
	compact: boolean,
): string {
	if (arr.length === 0) return "[]";

	if (compact) {
		const inlined = compactArray(arr);
		if (column + inlined.length <= LINE_WIDTH) return inlined;
	}

	const indent = INDENT.repeat(depth + 1);
	const closing = INDENT.repeat(depth);
	const items = arr.map(
		(item) =>
			`${indent}${serializeValue(item, depth + 1, indentWidth(depth + 1), compact)}`,
	);

	return `[\n${items.join(",\n")}\n${closing}]`;
}

function serializeObject(
	obj: Record<string, unknown>,
	depth: number,
	column: number,
	compact: boolean,
): string {
	const keys = Object.keys(obj);
	if (keys.length === 0) return "{}";

	if (compact) {
		const inlined = compactObject(obj);
		if (column + inlined.length <= LINE_WIDTH) return inlined;
	}

	const indent = INDENT.repeat(depth + 1);
	const closing = INDENT.repeat(depth);

	const entries = keys.map((key) => {
		const prefix = `${JSON.stringify(key)}: `;
		const col = indentWidth(depth + 1) + prefix.length;
		return `${indent}${prefix}${serializeValue(obj[key], depth + 1, col, compact)}`;
	});

	return `{\n${entries.join(",\n")}\n${closing}}`;
}

function compactArray(arr: unknown[]): string {
	return `[${arr.map(compactValue).join(", ")}]`;
}

function compactObject(obj: Record<string, unknown>): string {
	const entries = Object.keys(obj).map(
		(key) => `${JSON.stringify(key)}: ${compactValue(obj[key])}`,
	);
	return `{ ${entries.join(", ")} }`;
}

function compactValue(value: unknown): string {
	if (value === null) return "null";

	if (typeof value === "boolean") return String(value);
	if (typeof value === "number") return String(value);

	if (typeof value === "string") return JSON.stringify(value);

	if (Array.isArray(value)) return compactArray(value);
	if (typeof value === "object")
		return compactObject(value as Record<string, unknown>);

	return "null";
}

function indentWidth(depth: number): number {
	return depth * TAB_WIDTH;
}
