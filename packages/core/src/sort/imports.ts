// Biome and oxfmt disagree on import sources: Biome ranks "/" below "-" and
// digit runs by length, oxfmt ranks "-" first and reads a leading zero as a
// fraction, so "@hono/x" against "@hono-api/x" has no order both accept.
export type ImportOrder = "scope" | "text";

interface ImportStatement {
	readonly lines: ReadonlyArray<string>;
	readonly scopedSource: string | undefined;
}

type Segment =
	| { readonly _tag: "Line"; readonly line: string }
	| {
			readonly _tag: "Chunk";
			readonly statements: ReadonlyArray<ImportStatement>;
	  };

const scriptPath = /\.[cm]?[jt]sx?$/;
const importStart = /^import\s+(?!["'])/;
const singleLineImport = /^import\s+(?!["']).*\bfrom\s+["']([^"']+)["'];?$/;
const openImport = /^import\s+(?:type\s+)?\{$/;
const importSpecifier = /^\s+(?:type\s+)?[\w$]+(?:\s+as\s+[\w$]+)?,?$/;
const closeImport = /^\}\s*from\s+["']([^"']+)["'];?$/;
const scopedSource = /^@[^/]+\//;
const digitRun = /^\d+/;

function characterRank(character: string, order: ImportOrder) {
	if (character === "/") return order === "scope" ? 0 : 1;
	if (character === "-") return order === "scope" ? 1 : 0;
	if (/\d/.test(character)) return 2;
	return 3;
}

function compareText(left: string, right: string) {
	if (left === right) return 0;
	return left < right ? -1 : 1;
}

function compareDigitRuns(left: string, right: string, order: ImportOrder) {
	const byLength = left.length - right.length;
	if (order === "scope") return byLength || compareText(left, right);

	const leftFraction = left.startsWith("0");
	const rightFraction = right.startsWith("0");
	if (leftFraction !== rightFraction) return leftFraction ? -1 : 1;

	if (leftFraction)
		return compareText(left.slice(1), right.slice(1)) || byLength;

	return byLength || compareText(left, right);
}

function compareSources(left: string, right: string, order: ImportOrder) {
	let leftIndex = 0;
	let rightIndex = 0;

	while (leftIndex < left.length && rightIndex < right.length) {
		const leftDigits = digitRun.exec(left.slice(leftIndex))?.[0];
		const rightDigits = digitRun.exec(right.slice(rightIndex))?.[0];

		if (leftDigits !== undefined && rightDigits !== undefined) {
			const difference = compareDigitRuns(leftDigits, rightDigits, order);
			if (difference !== 0) return difference;

			leftIndex += leftDigits.length;
			rightIndex += rightDigits.length;
			continue;
		}

		const leftCharacter = left.charAt(leftIndex);
		const rightCharacter = right.charAt(rightIndex);
		const rank =
			characterRank(leftCharacter, order) -
			characterRank(rightCharacter, order);

		if (rank !== 0) return rank;

		const difference = compareText(leftCharacter, rightCharacter);
		if (difference !== 0) return difference;

		leftIndex += 1;
		rightIndex += 1;
	}

	return left.length - leftIndex - (right.length - rightIndex);
}

function statementOf(lines: ReadonlyArray<string>, source: string) {
	return {
		lines,
		scopedSource: scopedSource.test(source) ? source : undefined,
	};
}

function readStatement(lines: ReadonlyArray<string>, start: number) {
	const first = lines[start] ?? "";
	const source = singleLineImport.exec(first)?.[1];
	if (source !== undefined)
		return { end: start, statement: statementOf([first], source) };

	if (!openImport.test(first)) return undefined;

	for (let end = start + 1; end < lines.length; end++) {
		const line = lines[end] ?? "";
		const closing = closeImport.exec(line)?.[1];
		if (closing !== undefined)
			return {
				end,
				statement: statementOf(lines.slice(start, end + 1), closing),
			};

		if (!importSpecifier.test(line)) return undefined;
	}

	return undefined;
}

function segment(lines: ReadonlyArray<string>): ReadonlyArray<Segment> {
	const segments: Segment[] = [];

	let chunk: ImportStatement[] = [];
	let index = 0;
	while (index < lines.length) {
		const line = lines[index] ?? "";
		const read = importStart.test(line)
			? readStatement(lines, index)
			: undefined;

		if (read !== undefined) {
			chunk.push(read.statement);
			index = read.end + 1;
			continue;
		}

		if (chunk.length > 0) segments.push({ _tag: "Chunk", statements: chunk });
		chunk = [];
		segments.push({ _tag: "Line", line });
		index += 1;
	}

	if (chunk.length > 0) segments.push({ _tag: "Chunk", statements: chunk });
	return segments;
}

function sortChunk(
	statements: ReadonlyArray<ImportStatement>,
	order: ImportOrder,
): ReadonlyArray<ImportStatement> {
	const scoped = statements.filter(
		(statement) => statement.scopedSource !== undefined,
	);

	const sorted = [...scoped].sort((left, right) =>
		compareSources(left.scopedSource ?? "", right.scopedSource ?? "", order),
	);

	let next = 0;
	return statements.map((statement) =>
		statement.scopedSource === undefined
			? statement
			: (sorted[next++] ?? statement),
	);
}

export function sortScopedImports(
	path: string,
	content: string,
	order: ImportOrder,
): string {
	if (!scriptPath.test(path)) return content;

	return segment(content.split("\n"))
		.flatMap((part) =>
			part._tag === "Line"
				? [part.line]
				: sortChunk(part.statements, order).flatMap(
						(statement) => statement.lines,
					),
		)
		.join("\n");
}
