export interface Section {
	readonly header: string;
	readonly lines: string[];
}

export function parseSections(content: string): Section[] {
	const sections: Section[] = [];
	let current: Section = { header: "", lines: [] };

	for (const line of content.replaceAll("\r\n", "\n").split("\n")) {
		if (line.startsWith("# ") && current.lines.length > 0) {
			sections.push(current);
			current = { header: line, lines: [] };
		} else if (line.startsWith("# ") && current.lines.length === 0)
			current = {
				header: current.header === "" ? line : `${current.header}\n${line}`,
				lines: [],
			};
		else if (line.trim() !== "") current.lines.push(line);
	}

	if (current.header !== "" || current.lines.length > 0) sections.push(current);

	return sections;
}

function mergeSectionLines(
	base: ReadonlyArray<string>,
	current: ReadonlyArray<string>,
	incoming: ReadonlyArray<string>,
): LineMergeResult {
	if (linesEqual(base, incoming))
		return { merged: current.join("\n").concat("\n"), conflicts: [] };

	if (linesEqual(base, current))
		return { merged: incoming.join("\n").concat("\n"), conflicts: [] };

	if (linesEqual(current, incoming))
		return { merged: current.join("\n").concat("\n"), conflicts: [] };

	const baseSet = new Set(base);
	const currentSet = new Set(current);
	const incomingSet = new Set(incoming);

	const currentAdds = current.filter((line) => !baseSet.has(line));
	const incomingAdds = incoming.filter((line) => !baseSet.has(line));

	const currentRemovals = base.filter((line) => !currentSet.has(line));
	const incomingRemovals = base.filter((line) => !incomingSet.has(line));

	const currentPreservesOrder = isSubsequence(
		current.filter((line) => baseSet.has(line)),
		base,
	);

	const incomingPreservesOrder = isSubsequence(
		incoming.filter((line) => baseSet.has(line)),
		base,
	);

	const currentOnlyAdds = isSubsequence(base, current);
	const incomingOnlyAdds = isSubsequence(base, incoming);

	if (currentOnlyAdds && incomingOnlyAdds) {
		const merged = [...base];
		const mergedSet = new Set(base);

		for (const line of [...current, ...incoming]) {
			if (baseSet.has(line) || mergedSet.has(line)) continue;
			mergedSet.add(line);
			merged.push(line);
		}

		return { merged: merged.join("\n").concat("\n"), conflicts: [] };
	}

	if (
		currentPreservesOrder &&
		incomingPreservesOrder &&
		currentAdds.length === 0 &&
		incomingRemovals.length === 0
	)
		return {
			merged: incoming
				.filter((line) => !currentRemovals.includes(line))
				.join("\n")
				.concat("\n"),
			conflicts: [],
		};

	if (
		currentPreservesOrder &&
		incomingPreservesOrder &&
		incomingAdds.length === 0 &&
		currentRemovals.length === 0
	)
		return {
			merged: current
				.filter((line) => !incomingRemovals.includes(line))
				.join("\n")
				.concat("\n"),
			conflicts: [],
		};

	if (
		currentPreservesOrder &&
		incomingPreservesOrder &&
		currentAdds.length === 0 &&
		incomingAdds.length === 0
	)
		return {
			merged: base
				.filter((line) => currentSet.has(line) && incomingSet.has(line))
				.join("\n")
				.concat("\n"),
			conflicts: [],
		};

	return threeWayMergeLines(
		base.join("\n").concat("\n"),
		current.join("\n").concat("\n"),
		incoming.join("\n").concat("\n"),
	);
}

function isSubsequence(
	expected: ReadonlyArray<string>,
	actual: ReadonlyArray<string>,
): boolean {
	let expectedIndex = 0;
	for (const line of actual)
		if (line === expected[expectedIndex]) expectedIndex++;

	return expectedIndex === expected.length;
}

export function threeWayMergeSections(
	base: string,
	current: string,
	incoming: string,
): LineMergeResult {
	const baseSections = parseSections(base);
	const currentSections = parseSections(current);
	const incomingSections = parseSections(incoming);

	if (
		hasDuplicateHeaders(baseSections) ||
		hasDuplicateHeaders(currentSections) ||
		hasDuplicateHeaders(incomingSections)
	)
		return threeWayMergeLines(
			serializeSections(baseSections),
			serializeSections(currentSections),
			serializeSections(incomingSections),
		);

	const byHeader = (sections: ReadonlyArray<Section>) =>
		new Map(sections.map((section) => [section.header, section]));

	const baseByHeader = byHeader(baseSections);
	const currentByHeader = byHeader(currentSections);
	const incomingByHeader = byHeader(incomingSections);

	const headers = new Set([
		...baseSections.map((section) => section.header),
		...currentSections.map((section) => section.header),
		...incomingSections.map((section) => section.header),
	]);

	const sections: Section[] = [];

	const conflicts: string[] = [];
	const conflictValues: LineMergeConflict[] = [];

	for (const header of headers) {
		const result = mergeSectionLines(
			baseByHeader.get(header)?.lines ?? [],
			currentByHeader.get(header)?.lines ?? [],
			incomingByHeader.get(header)?.lines ?? [],
		);

		const lines = splitLines(result.merged);
		if (header !== "" || lines.length > 0) sections.push({ header, lines });

		for (const conflict of result.conflicts)
			conflicts.push(
				`${header === "" ? "unsectioned" : header.slice(2)} -> ${conflict}`,
			);

		for (const conflict of result.conflictValues ?? [])
			conflictValues.push({
				...conflict,
				label: `${header === "" ? "unsectioned" : header.slice(2)} -> ${conflict.label}`,
			});
	}

	return {
		merged: serializeSections(sections),
		conflicts,
		...(conflictValues.length === 0 ? {} : { conflictValues }),
	};
}

function hasDuplicateHeaders(sections: ReadonlyArray<Section>): boolean {
	const headers = new Set<string>();
	for (const section of sections) {
		if (headers.has(section.header)) return true;
		headers.add(section.header);
	}

	return false;
}

export function sectionResidue(base: string, current: string): string {
	const baseSections = parseSections(base);
	const baseByHeader = new Map(
		baseSections.map((section) => [section.header, new Set(section.lines)]),
	);

	const residue = parseSections(current)
		.map((section) => {
			const baseLines = baseByHeader.get(section.header);
			return {
				header: section.header,
				lines:
					baseLines === undefined
						? section.lines
						: section.lines.filter((line) => !baseLines.has(line)),
			};
		})
		.filter(
			(section) =>
				section.lines.length > 0 || !baseByHeader.has(section.header),
		);

	return residue.length === 0 ? "" : serializeSections(residue);
}

function serializeSections(sections: ReadonlyArray<Section>): string {
	const parts: string[] = [];

	for (const section of sections) {
		if (section.header !== "") parts.push(section.header);
		for (const line of section.lines) parts.push(line);
		parts.push("");
	}

	return parts.join("\n").trimEnd().concat("\n");
}

export function appendLines(
	existing: string,
	lines: ReadonlyArray<string>,
	section?: string,
	position: "start" | "end" = "end",
): string {
	const sections = parseSections(existing);

	if (section) {
		const header = section.startsWith("# ") ? section : `# ${section}`;
		const found = sections.find((s) => s.header === header);

		if (found) {
			const existingSet = new Set(found.lines);
			for (const line of lines)
				if (!existingSet.has(line)) found.lines.push(line);
		} else sections.push({ header, lines: [...lines] });
	} else if (position === "start") {
		const target =
			sections.find((s) => s.header === "") ??
			(() => {
				const s: Section = { header: "", lines: [] };
				sections.unshift(s);

				return s;
			})();

		const existingSet = new Set(target.lines);
		const toAdd = lines.filter((line) => !existingSet.has(line));
		target.lines.unshift(...toAdd);
	} else {
		const target =
			sections.find((s) => s.header === "") ??
			(() => {
				const s: Section = { header: "", lines: [] };
				sections.unshift(s);

				return s;
			})();

		const existingSet = new Set(target.lines);
		for (const line of lines)
			if (!existingSet.has(line)) target.lines.push(line);
	}

	return serializeSections(sections);
}

export interface LineMergeResult {
	readonly merged: string;
	readonly conflicts: ReadonlyArray<string>;
	readonly conflictValues?: ReadonlyArray<LineMergeConflict>;
}

export interface LineMergeConflict {
	readonly base?: string;
	readonly forge?: string;
	readonly label: string;
	readonly user?: string;
}

export function threeWayMergeLines(
	base: string,
	current: string,
	incoming: string,
): LineMergeResult {
	const baseLines = splitLines(base);
	const currentLines = splitLines(current);
	const incomingLines = splitLines(incoming);

	const matchesCurrent = lcsMatchPairs(baseLines, currentLines);
	const matchesIncoming = lcsMatchPairs(baseLines, incomingLines);

	const currentMatchedBase = new Set(matchesCurrent.map(([b]) => b));
	const incomingMatchedBase = new Set(matchesIncoming.map(([b]) => b));

	const stableSet = new Set<number>();
	for (const b of currentMatchedBase)
		if (incomingMatchedBase.has(b)) stableSet.add(b);

	const stablePositions = [...stableSet].sort((a, b) => a - b);

	const baseToCurrent = new Map<number, number>();
	for (const [b, c] of matchesCurrent)
		if (stableSet.has(b)) baseToCurrent.set(b, c);

	const baseToIncoming = new Map<number, number>();
	for (const [b, c] of matchesIncoming)
		if (stableSet.has(b)) baseToIncoming.set(b, c);

	const merged: string[] = [];

	const conflicts: string[] = [];
	const conflictValues: LineMergeConflict[] = [];

	let prevBase = 0;
	let prevCurrent = 0;
	let prevIncoming = 0;

	for (const anchor of [...stablePositions, -1]) {
		const baseEnd = anchor === -1 ? baseLines.length : anchor;

		const currentEnd =
			anchor === -1
				? currentLines.length
				: (baseToCurrent.get(anchor) ?? currentLines.length);

		const incomingEnd =
			anchor === -1
				? incomingLines.length
				: (baseToIncoming.get(anchor) ?? incomingLines.length);

		const baseSeg = baseLines.slice(prevBase, baseEnd);
		const currentSeg = currentLines.slice(prevCurrent, currentEnd);
		const incomingSeg = incomingLines.slice(prevIncoming, incomingEnd);

		if (linesEqual(currentSeg, incomingSeg)) merged.push(...currentSeg);
		else if (linesEqual(baseSeg, currentSeg)) merged.push(...incomingSeg);
		else if (linesEqual(baseSeg, incomingSeg)) merged.push(...currentSeg);
		else {
			merged.push(...incomingSeg);

			const label =
				baseSeg.length > 0 ? baseSeg.join(", ") : "concurrent insertion";

			conflicts.push(label);
			conflictValues.push({
				...(baseSeg.length === 0 ? {} : { base: baseSeg.join("\n") }),
				...(incomingSeg.length === 0 ? {} : { forge: incomingSeg.join("\n") }),
				label,
				...(currentSeg.length === 0 ? {} : { user: currentSeg.join("\n") }),
			});
		}

		if (anchor !== -1) {
			const line = baseLines[anchor];
			if (line !== undefined) merged.push(line);
		}

		prevBase = baseEnd + (anchor === -1 ? 0 : 1);
		prevCurrent = currentEnd + (anchor === -1 ? 0 : 1);
		prevIncoming = incomingEnd + (anchor === -1 ? 0 : 1);
	}

	return {
		merged: merged.join("\n").concat("\n"),
		conflicts,
		...(conflictValues.length === 0 ? {} : { conflictValues }),
	};
}

function splitLines(content: string): string[] {
	const lines = content.split("\n");
	if (lines.at(-1) === "") lines.pop();

	return lines;
}

function linesEqual(
	a: ReadonlyArray<string>,
	b: ReadonlyArray<string>,
): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;

	return true;
}

function lcsMatchPairs(
	a: ReadonlyArray<string>,
	b: ReadonlyArray<string>,
): Array<[number, number]> {
	const m = a.length;
	const n = b.length;
	const dp: number[][] = Array.from({ length: m + 1 }, () =>
		new Array<number>(n + 1).fill(0),
	);

	for (let i = 1; i <= m; i++) {
		const row = dp[i];
		const prevRow = dp[i - 1];

		if (!row || !prevRow) continue;

		for (let j = 1; j <= n; j++) {
			if (a[i - 1] === b[j - 1]) row[j] = (prevRow[j - 1] ?? 0) + 1;
			else row[j] = Math.max(prevRow[j] ?? 0, row[j - 1] ?? 0);
		}
	}

	const pairs: Array<[number, number]> = [];

	let i = m;
	let j = n;

	while (i > 0 && j > 0) {
		const row = dp[i];
		const prevRow = dp[i - 1];

		if (!row || !prevRow) break;

		if (a[i - 1] === b[j - 1]) {
			pairs.unshift([i - 1, j - 1]);
			i--;
			j--;
		} else if ((prevRow[j] ?? 0) >= (row[j - 1] ?? 0)) i--;
		else j--;
	}

	return pairs;
}
