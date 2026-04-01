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

export function threeWayMergeLines(
	base: string,
	current: string,
	incoming: string,
): string {
	const baseSet = new Set(base.split("\n").filter((l) => l.trim() !== ""));

	const currentSet = new Set(
		current.split("\n").filter((l) => l.trim() !== ""),
	);

	const incomingSet = new Set(
		incoming.split("\n").filter((l) => l.trim() !== ""),
	);

	const userAdded = [...currentSet].filter((l) => !baseSet.has(l));
	const incomingAdded = [...incomingSet].filter((l) => !baseSet.has(l));
	const baseKept = [...incomingSet].filter((l) => baseSet.has(l));

	const merged = new Set([...baseKept, ...userAdded, ...incomingAdded]);

	return [...merged].join("\n").concat("\n");
}
