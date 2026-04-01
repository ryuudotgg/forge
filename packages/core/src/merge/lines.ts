interface Section {
	readonly header: string;
	readonly lines: string[];
}

function parseSections(content: string): Section[] {
	const sections: Section[] = [];
	let current: Section = { header: "", lines: [] };

	for (const line of content.split("\n")) {
		if (line.startsWith("# ") && current.lines.length > 0) {
			sections.push(current);
			current = { header: line, lines: [] };
		} else if (line.startsWith("# ") && current.lines.length === 0)
			current = { header: line, lines: [] };
		else if (line.trim() !== "") current.lines.push(line);
	}

	if (current.header !== "" || current.lines.length > 0) sections.push(current);

	return sections;
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
			conflicts.push(
				baseSeg.length > 0 ? baseSeg.join(", ") : "concurrent insertion",
			);
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
