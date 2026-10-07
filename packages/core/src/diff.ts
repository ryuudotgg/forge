const maxEditDistance = 500;

type LineChange = {
	readonly kind: "equal" | "add" | "remove";
	readonly line: string;
};

function changedLines(
	before: ReadonlyArray<string>,
	after: ReadonlyArray<string>,
): LineChange[] {
	let prefix = 0;
	while (
		prefix < before.length &&
		prefix < after.length &&
		before[prefix] === after[prefix]
	)
		prefix++;

	let suffix = 0;
	while (
		suffix < before.length - prefix &&
		suffix < after.length - prefix &&
		before[before.length - suffix - 1] === after[after.length - suffix - 1]
	)
		suffix++;

	const oldLines = before.slice(prefix, before.length - suffix);
	const newLines = after.slice(prefix, after.length - suffix);
	const trace: Map<number, number>[] = [];
	let frontier = new Map<number, number>([[1, 0]]);
	let distance = 0;
	search: for (
		;
		distance <= Math.min(oldLines.length + newLines.length, maxEditDistance);
		distance++
	) {
		trace.push(new Map(frontier));
		const next = new Map<number, number>();
		for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
			const left = frontier.get(diagonal - 1) ?? -Infinity;
			const right = frontier.get(diagonal + 1) ?? -Infinity;

			let oldIndex =
				diagonal === -distance || (diagonal !== distance && left < right)
					? right
					: left + 1;
			let newIndex = oldIndex - diagonal;
			while (
				oldIndex < oldLines.length &&
				newIndex < newLines.length &&
				oldLines[oldIndex] === newLines[newIndex]
			) {
				oldIndex++;
				newIndex++;
			}

			next.set(diagonal, oldIndex);
			if (oldIndex === oldLines.length && newIndex === newLines.length)
				break search;
		}

		frontier = next;
	}

	const equalLines = (lines: ReadonlyArray<string>) =>
		lines.map((line): LineChange => ({ kind: "equal", line }));

	if (distance > maxEditDistance)
		return [
			...equalLines(before.slice(0, prefix)),
			...oldLines.map((line): LineChange => ({ kind: "remove", line })),
			...newLines.map((line): LineChange => ({ kind: "add", line })),
			...equalLines(before.slice(before.length - suffix)),
		];

	const reversed: LineChange[] = [];

	let oldIndex = oldLines.length;
	let newIndex = newLines.length;
	for (let step = distance; step >= 0; step--) {
		const previous = trace[step];
		const diagonal = oldIndex - newIndex;
		const left = previous?.get(diagonal - 1) ?? -Infinity;
		const right = previous?.get(diagonal + 1) ?? -Infinity;
		const previousDiagonal =
			diagonal === -step || (diagonal !== step && left < right)
				? diagonal + 1
				: diagonal - 1;

		const previousOldIndex = previous?.get(previousDiagonal) ?? 0;
		const previousNewIndex = previousOldIndex - previousDiagonal;
		while (oldIndex > previousOldIndex && newIndex > previousNewIndex) {
			oldIndex--;
			newIndex--;
			reversed.push({ kind: "equal", line: oldLines[oldIndex] ?? "" });
		}

		if (step === 0) break;
		if (oldIndex === previousOldIndex) {
			newIndex--;
			reversed.push({ kind: "add", line: newLines[newIndex] ?? "" });
		} else {
			oldIndex--;
			reversed.push({ kind: "remove", line: oldLines[oldIndex] ?? "" });
		}
	}

	return [
		...before
			.slice(0, prefix)
			.map((line): LineChange => ({ kind: "equal", line })),
		...reversed.reverse(),
		...before
			.slice(before.length - suffix)
			.map((line): LineChange => ({ kind: "equal", line })),
	];
}

function hunkRange(start: number, count: number): string {
	return count === 1
		? String(start)
		: `${count === 0 ? start - 1 : start},${count}`;
}

export function unifiedDiff(
	path: string,
	before: string,
	after: string,
): string {
	if (before === after) return "";

	const changes = changedLines(
		before.match(/[^\n]*\n|[^\n]+$/g) ?? [],
		after.match(/[^\n]*\n|[^\n]+$/g) ?? [],
	);
	const hunks: { start: number; end: number }[] = [];
	for (const [index, change] of changes.entries()) {
		if (change.kind === "equal") continue;

		const start = Math.max(0, index - 3);
		const end = Math.min(changes.length, index + 4);
		const previous = hunks.at(-1);
		if (previous !== undefined && start <= previous.end) previous.end = end;
		else hunks.push({ start, end });
	}

	let diff = `--- a/${path}\n+++ b/${path}\n`;
	let oldStart = 1;
	let newStart = 1;
	let cursor = 0;
	for (const hunk of hunks) {
		for (; cursor < hunk.start; cursor++) {
			const change = changes[cursor];
			if (change?.kind !== "add") oldStart++;
			if (change?.kind !== "remove") newStart++;
		}

		const body = changes.slice(hunk.start, hunk.end);
		const removed = body.filter((change) => change.kind !== "add").length;
		const added = body.filter((change) => change.kind !== "remove").length;
		diff += `@@ -${hunkRange(oldStart, removed)} +${hunkRange(newStart, added)} @@\n`;

		for (const change of body) {
			const marker =
				change.kind === "equal" ? " " : change.kind === "add" ? "+" : "-";
			diff += `${marker}${change.line}`;
			if (!change.line.endsWith("\n"))
				diff += "\n\\ No newline at end of file\n";
		}
	}

	return diff;
}
