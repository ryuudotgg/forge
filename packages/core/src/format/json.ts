const LINE_WIDTH = 80;

const INDENT = "  ";
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
	trailingWidth = 0,
): string {
	if (value === null) return "null";
	if (typeof value === "boolean") return String(value);
	if (typeof value === "number") return serializeNumber(value);
	if (typeof value === "string") return JSON.stringify(value);

	if (Array.isArray(value))
		return serializeArray(value, depth, column, compact, trailingWidth);

	if (isJsonObject(value))
		return serializeObject(value, depth, column, compact, trailingWidth);

	return "null";
}

function serializeArray(
	arr: unknown[],
	depth: number,
	column: number,
	compact: boolean,
	trailingWidth: number,
): string {
	if (arr.length === 0) return "[]";

	if (compact) {
		const inlined = compactArray(arr);
		if (column + inlined.length + trailingWidth <= LINE_WIDTH) return inlined;
	}

	const indent = INDENT.repeat(depth + 1);
	const closing = INDENT.repeat(depth);
	const items = arr.map(
		(item, index) =>
			`${indent}${serializeValue(item, depth + 1, indentWidth(depth + 1), compact, index < arr.length - 1 ? 1 : 0)}`,
	);

	return `[\n${items.join(",\n")}\n${closing}]`;
}

function serializeObject(
	obj: Record<string, unknown>,
	depth: number,
	column: number,
	compact: boolean,
	trailingWidth: number,
): string {
	const keys = Object.keys(obj).filter((key) => obj[key] !== undefined);
	if (keys.length === 0) return "{}";

	if (compact) {
		const inlined = compactObject(obj);
		if (column + inlined.length + trailingWidth <= LINE_WIDTH) return inlined;
	}

	const indent = INDENT.repeat(depth + 1);
	const closing = INDENT.repeat(depth);

	const entries = keys.map((key, index) => {
		const prefix = `${JSON.stringify(key)}: `;
		const col = indentWidth(depth + 1) + prefix.length;
		return `${indent}${prefix}${serializeValue(obj[key], depth + 1, col, compact, index < keys.length - 1 ? 1 : 0)}`;
	});

	return `{\n${entries.join(",\n")}\n${closing}}`;
}

function compactArray(arr: unknown[]): string {
	return `[${arr.map(compactValue).join(", ")}]`;
}

function compactObject(obj: Record<string, unknown>): string {
	const keys = Object.keys(obj).filter((key) => obj[key] !== undefined);
	if (keys.length === 0) return "{}";

	const entries = keys.map(
		(key) => `${JSON.stringify(key)}: ${compactValue(obj[key])}`,
	);

	return `{ ${entries.join(", ")} }`;
}

function compactValue(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "boolean") return String(value);
	if (typeof value === "number") return serializeNumber(value);
	if (typeof value === "string") return JSON.stringify(value);
	if (Array.isArray(value)) return compactArray(value);
	if (isJsonObject(value)) return compactObject(value);

	return "null";
}

function serializeNumber(value: number): string {
	if (!Number.isFinite(value))
		throw new RangeError(`JSON Number Must Be Finite: ${value}`);

	return String(value);
}

function indentWidth(depth: number): number {
	return depth * TAB_WIDTH;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
