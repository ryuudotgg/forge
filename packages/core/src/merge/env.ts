import type { LineMergeConflict } from "./lines";
import { lcsMatchPairs } from "./lines";
import type { MergeConflictResolution, MergeConflictResolver } from "./types";

export interface EnvMergeResult {
	readonly merged: string;
	readonly conflicts: ReadonlyArray<string>;
	readonly conflictValues?: ReadonlyArray<LineMergeConflict>;
}

interface EnvLine {
	readonly name?: string;
	readonly raw: string;
}

function envLineKey(line: EnvLine): string {
	return line.name === undefined ? `text:${line.raw}` : `variable:${line.name}`;
}

function envKeysEqual(
	left: ReadonlyArray<EnvLine>,
	right: ReadonlyArray<EnvLine>,
): boolean {
	return (
		left.length === right.length &&
		left.every((line, index) => {
			const other = right[index];
			return other !== undefined && envLineKey(line) === envLineKey(other);
		})
	);
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

function serializeEnv(lines: ReadonlyArray<EnvLine>): string {
	return lines.length === 0
		? ""
		: lines
				.map((line) => line.raw)
				.join("\n")
				.concat("\n");
}

function collapseDuplicateVariables(
	lines: ReadonlyArray<EnvLine>,
	duplicateNames: ReadonlySet<string>,
): EnvLine[] {
	const effective = variables(lines);

	const emitted = new Set<string>();
	const collapsed: EnvLine[] = [];
	for (const line of lines) {
		if (line.name === undefined || !duplicateNames.has(line.name)) {
			collapsed.push(line);
			continue;
		}

		if (emitted.has(line.name)) continue;

		emitted.add(line.name);
		collapsed.push({
			name: line.name,
			raw: effective.get(line.name) ?? line.raw,
		});
	}

	return collapsed;
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
	resolution?: MergeConflictResolution,
	resolveConflict?: MergeConflictResolver,
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

		const resolutions = new Map(
			[...duplicateNames].map((name) => [
				name,
				resolveConflict?.(`duplicate variable ${name}`) ?? resolution,
			]),
		);

		const fullyResolved = [...resolutions.values()].every(
			(candidate) => candidate !== undefined,
		);

		const nonConflictingMerge = !fullyResolved
			? undefined
			: threeWayMergeEnv(
					serializeEnv(collapseDuplicateVariables(baseLines, duplicateNames)),
					serializeEnv(
						collapseDuplicateVariables(currentLines, duplicateNames),
					),
					serializeEnv(
						collapseDuplicateVariables(incomingLines, duplicateNames),
					),
					resolution,
					resolveConflict,
				);

		const currentVariables = variables(
			collapseDuplicateVariables(currentLines, duplicateNames),
		);

		const incomingVariables = variables(
			collapseDuplicateVariables(incomingLines, duplicateNames),
		);

		const selectedVariables = new Map<string, string>();
		for (const name of duplicateNames) {
			const selected =
				resolutions.get(name) === "user"
					? currentVariables.get(name)
					: incomingVariables.get(name);

			if (selected !== undefined) selectedVariables.set(name, selected);
		}

		const resolvedLines =
			nonConflictingMerge === undefined
				? undefined
				: parseEnv(nonConflictingMerge.merged).flatMap((line) => {
						if (line.name === undefined || !duplicateNames.has(line.name))
							return [line];

						const selected = selectedVariables.get(line.name);
						return selected === undefined ? [] : [{ ...line, raw: selected }];
					});

		return {
			merged:
				!fullyResolved || resolvedLines === undefined
					? incoming
					: serializeEnv(resolvedLines),
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
	const incomingVariables = variables(incomingLines);
	const selectedVariables = new Map<string, string>();
	for (const line of incomingLines) {
		if (line.name === undefined) continue;

		const currentLine = currentVariables.get(line.name);
		const baseLine = baseVariables.get(line.name);

		selectedVariables.set(
			line.name,
			currentLine !== undefined &&
				(baseLine === undefined || currentLine !== baseLine)
				? currentLine
				: line.raw,
		);
	}

	for (const line of currentLines) {
		if (line.name === undefined || incomingVariables.has(line.name)) continue;

		const baseLine = baseVariables.get(line.name);
		if (baseLine === undefined || baseLine !== line.raw)
			selectedVariables.set(line.name, line.raw);
	}

	const baseKeys = baseLines.map(envLineKey);
	const baseToCurrent = new Map(
		lcsMatchPairs(baseKeys, currentLines.map(envLineKey)),
	);

	const baseToIncoming = new Map(
		lcsMatchPairs(baseKeys, incomingLines.map(envLineKey)),
	);

	const anchors = [...baseToCurrent.keys()].filter((index) =>
		baseToIncoming.has(index),
	);

	const matchedCurrent = new Set(baseToCurrent.values());
	const baseRaw = new Set(baseLines.map((line) => line.raw));
	const currentRaw = new Set(currentLines.map((line) => line.raw));
	const isUserComment = (line: EnvLine | undefined) =>
		line !== undefined &&
		line.name === undefined &&
		line.raw.trim() !== "" &&
		!baseRaw.has(line.raw);

	const userPlaced = new Set(
		currentLines.flatMap((line, index) =>
			line.name === undefined ||
			(matchedCurrent.has(index) && !isUserComment(currentLines[index - 1]))
				? []
				: [line.name],
		),
	);

	const userRemoved = (line: EnvLine) =>
		line.name === undefined &&
		line.raw.trim() !== "" &&
		baseRaw.has(line.raw) &&
		!currentRaw.has(line.raw);

	const output: EnvLine[] = [];
	const emitted = new Set<string>();
	const emit = (line: EnvLine) => {
		if (line.name === undefined) {
			output.push(line);
			return;
		}

		const raw = selectedVariables.get(line.name);
		if (raw === undefined || emitted.has(line.name)) return;

		emitted.add(line.name);
		output.push({ name: line.name, raw });
	};

	let previousBase = 0;
	let previousCurrent = 0;
	let previousIncoming = 0;
	for (const anchor of [...anchors, -1]) {
		const baseEnd = anchor === -1 ? baseLines.length : anchor;
		const currentEnd =
			anchor === -1
				? currentLines.length
				: (baseToCurrent.get(anchor) ?? currentLines.length);

		const incomingEnd =
			anchor === -1
				? incomingLines.length
				: (baseToIncoming.get(anchor) ?? incomingLines.length);

		const baseSegment = baseLines.slice(previousBase, baseEnd);
		const currentSegment = currentLines.slice(previousCurrent, currentEnd);
		const incomingSegment = incomingLines.slice(previousIncoming, incomingEnd);
		if (envKeysEqual(currentSegment, incomingSegment))
			currentSegment.forEach(emit);
		else if (envKeysEqual(baseSegment, currentSegment)) {
			for (const line of incomingSegment)
				if (
					line.name === undefined
						? !userRemoved(line)
						: !userPlaced.has(line.name)
				)
					emit(line);

			for (const line of currentSegment)
				if (
					line.name !== undefined &&
					(userPlaced.has(line.name) || !incomingVariables.has(line.name))
				)
					emit(line);
		} else {
			const baseSegmentKeys = new Set(baseSegment.map(envLineKey));
			const currentSegmentKeys = new Set(currentSegment.map(envLineKey));
			const incomingSegmentKeys = new Set(incomingSegment.map(envLineKey));

			const merged = currentSegment.filter((line) =>
				line.name === undefined
					? !baseSegmentKeys.has(envLineKey(line)) ||
						incomingSegmentKeys.has(envLineKey(line))
					: userPlaced.has(line.name) ||
						!incomingVariables.has(line.name) ||
						incomingSegmentKeys.has(envLineKey(line)),
			);

			let insertAt = 0;
			for (const line of incomingSegment) {
				const found = merged.findIndex(
					(candidate, index) =>
						index >= insertAt && envLineKey(candidate) === envLineKey(line),
				);

				if (found !== -1) insertAt = found + 1;
				else if (
					line.name === undefined
						? !baseSegmentKeys.has(envLineKey(line)) &&
							!currentSegmentKeys.has(envLineKey(line)) &&
							!userRemoved(line)
						: !userPlaced.has(line.name) &&
							!currentSegmentKeys.has(envLineKey(line))
				) {
					merged.splice(insertAt, 0, line);
					insertAt++;
				}
			}

			merged.forEach(emit);
		}

		if (anchor !== -1) {
			const line = currentLines[currentEnd];
			if (line !== undefined) emit(line);
		}

		previousBase = baseEnd + (anchor === -1 ? 0 : 1);
		previousCurrent = currentEnd + (anchor === -1 ? 0 : 1);
		previousIncoming = incomingEnd + (anchor === -1 ? 0 : 1);
	}

	return {
		merged: serializeEnv(output),
		conflicts: [],
	};
}

export function envResidue(base: string, current: string): string {
	const result = threeWayMergeEnv(base, current, "");
	return result.conflicts.length === 0 ? result.merged : current;
}
