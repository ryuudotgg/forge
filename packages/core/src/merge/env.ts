import type { LineMergeConflict } from "./lines";

export interface EnvMergeResult {
	readonly merged: string;
	readonly conflicts: ReadonlyArray<string>;
	readonly conflictValues?: ReadonlyArray<LineMergeConflict>;
}

interface EnvLine {
	readonly name?: string;
	readonly raw: string;
}

function parseEnv(content: string): EnvLine[] {
	return content
		.replaceAll("\r\n", "\n")
		.split("\n")
		.filter((line, index, lines) => line !== "" || index < lines.length - 1)
		.map((raw) => {
			const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(raw);
			return { raw, name: match?.[1] };
		});
}

function variables(lines: ReadonlyArray<EnvLine>): Map<string, string> {
	const result = new Map<string, string>();
	for (const line of lines)
		if (line.name !== undefined) result.set(line.name, line.raw);

	return result;
}

function duplicateVariableNames(lines: ReadonlyArray<EnvLine>): Set<string> {
	const seen = new Set<string>();
	const duplicates = new Set<string>();

	for (const line of lines) {
		if (line.name === undefined) continue;
		if (seen.has(line.name)) duplicates.add(line.name);
		seen.add(line.name);
	}

	return duplicates;
}

function variableLines(
	lines: ReadonlyArray<EnvLine>,
	name: string,
): string | undefined {
	const matches = lines.filter((line) => line.name === name);
	return matches.length === 0
		? undefined
		: matches.map((line) => line.raw).join("\n");
}

export function threeWayMergeEnv(
	base: string,
	current: string,
	incoming: string,
): EnvMergeResult {
	const baseLines = parseEnv(base);
	const currentLines = parseEnv(current);
	const incomingLines = parseEnv(incoming);
	const duplicateNames = new Set([
		...duplicateVariableNames(baseLines),
		...duplicateVariableNames(currentLines),
		...duplicateVariableNames(incomingLines),
	]);

	if (duplicateNames.size > 0) {
		const conflicts = [...duplicateNames].map(
			(name) => `duplicate variable ${name}`,
		);

		return {
			merged: incoming,
			conflicts,
			conflictValues: [...duplicateNames].map((name) => ({
				...(variableLines(baseLines, name) === undefined
					? {}
					: { base: variableLines(baseLines, name) }),
				...(variableLines(incomingLines, name) === undefined
					? {}
					: { forge: variableLines(incomingLines, name) }),
				label: `duplicate variable ${name}`,
				...(variableLines(currentLines, name) === undefined
					? {}
					: { user: variableLines(currentLines, name) }),
			})),
		};
	}

	const baseVariables = variables(baseLines);
	const currentVariables = variables(currentLines);

	const baseNonVariables = new Set(
		baseLines.filter((line) => line.name === undefined).map((line) => line.raw),
	);

	const incomingNonVariables = new Set(
		incomingLines
			.filter((line) => line.name === undefined)
			.map((line) => line.raw),
	);

	const output: string[] = [];
	const emitted = new Set<string>();

	for (const line of incomingLines) {
		if (line.name === undefined) {
			output.push(line.raw);
			continue;
		}

		if (emitted.has(line.name)) continue;

		const currentLine = currentVariables.get(line.name);
		const baseLine = baseVariables.get(line.name);

		output.push(
			currentLine !== undefined &&
				(baseLine === undefined || currentLine !== baseLine)
				? currentLine
				: line.raw,
		);

		emitted.add(line.name);
	}

	for (const line of currentLines) {
		if (line.name === undefined) {
			if (
				!baseNonVariables.has(line.raw) &&
				!incomingNonVariables.has(line.raw)
			)
				output.push(line.raw);

			continue;
		}

		if (emitted.has(line.name)) continue;

		const baseLine = baseVariables.get(line.name);
		if (baseLine === undefined || baseLine !== line.raw) output.push(line.raw);
	}

	return {
		merged: output.length === 0 ? "" : output.join("\n").concat("\n"),
		conflicts: [],
	};
}

export function envResidue(base: string, current: string): string {
	const result = threeWayMergeEnv(base, current, "");
	return result.conflicts.length === 0 ? result.merged : current;
}
