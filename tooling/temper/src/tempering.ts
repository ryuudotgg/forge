import type { Temper } from "./thresholds.ts";

export const MARKER = "<!-- temper-report -->";

const MAX_BRITTLE_REFS = 8;

export function isTemperComment(body: string): boolean {
	return body.startsWith(MARKER);
}

export interface PackageReport {
	readonly branches: number;
	readonly lines: number;
	readonly name: string;
	readonly temper: Temper;
}

export interface LineRange {
	end: number;
	start: number;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function metricPct(
	summary: unknown,
	metric: "branches" | "lines",
	path: string,
): number {
	if (isRecord(summary) && isRecord(summary.total)) {
		const section = summary.total[metric];
		if (isRecord(section) && typeof section.pct === "number")
			return section.pct;
	}

	throw new Error(`Malformed Coverage Summary: no ${metric} total in ${path}`);
}

export function lineCoverage(fileCoverage: unknown): Map<number, number> {
	const lines = new Map<number, number>();
	if (
		!isRecord(fileCoverage) ||
		!isRecord(fileCoverage.statementMap) ||
		!isRecord(fileCoverage.s)
	)
		return lines;

	for (const [id, statement] of Object.entries(fileCoverage.statementMap)) {
		const count = fileCoverage.s[id];
		if (typeof count !== "number") continue;

		if (!isRecord(statement) || !isRecord(statement.start)) continue;

		const line = statement.start.line;
		if (typeof line !== "number") continue;

		const previous = lines.get(line);
		if (previous === undefined || previous < count) lines.set(line, count);
	}

	return lines;
}

export function parseAddedLines(diff: string): Map<string, Set<number>> {
	const added = new Map<string, Set<number>>();

	let current: Set<number> | undefined;
	let inHunk = false;
	let line = 0;
	for (const row of diff.split("\n")) {
		if (row.startsWith("diff --git ")) {
			inHunk = false;
			continue;
		}

		if (!inHunk && row.startsWith("+++ ")) {
			const target = row.slice(4).trim();
			if (target === "/dev/null") {
				current = undefined;
				continue;
			}

			const path = target.replace(/^b\//, "");

			current = added.get(path) ?? new Set();
			added.set(path, current);

			continue;
		}

		const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(row);
		if (hunk) {
			inHunk = true;
			line = Number(hunk[1]);
			continue;
		}

		if (!current || !inHunk) continue;

		if (row.startsWith("+")) {
			current.add(line);
			line++;
		} else if (row.startsWith(" ")) line++;
	}

	return added;
}

export function toRanges(lines: readonly number[]): LineRange[] {
	const ranges: LineRange[] = [];
	for (const line of [...lines].sort((a, b) => a - b)) {
		const last = ranges.at(-1);
		if (last && line === last.end + 1) last.end = line;
		else ranges.push({ end: line, start: line });
	}

	return ranges;
}

export function formatRange(file: string, range: LineRange): string {
	const lines =
		range.start === range.end
			? `${range.start}`
			: `${range.start}-${range.end}`;

	return `${file}:${lines}`;
}

function formatPct(value: number): string {
	return `${value.toFixed(1)}%`;
}

function plural(count: number, word: string): string {
	return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function tier(report: PackageReport): string {
	const { branches, lines, temper } = report;

	if (lines >= temper.lines && branches >= temper.branches) return "🔥";
	if (lines >= temper.lines * 0.9 && branches >= temper.branches * 0.9)
		return "🟠";

	return "🧊";
}

export function freshSteel(
	tempered: number,
	brittle: number,
	brittleRefs: readonly string[],
): string {
	const measured = tempered + brittle;
	if (measured === 0)
		return "**Fresh Steel:** nothing to temper (this diff changes no measured lines).";

	if (brittle === 0)
		return `**Fresh Steel:** fully tempered with ${plural(measured, "changed line")} covered.`;

	const pct = formatPct((tempered / measured) * 100);
	const shown = brittleRefs
		.slice(0, MAX_BRITTLE_REFS)
		.map((ref) => `\`${ref}\``);

	const overflow = brittleRefs.length - shown.length;
	const list =
		overflow > 0
			? `${shown.join(", ")}, and ${overflow} more`
			: new Intl.ListFormat("en-US").format(shown);

	return `**Fresh Steel:** ${pct} tempered with ${plural(brittle, "brittle line")} in ${list}.`;
}

export function render(
	reports: readonly PackageReport[],
	tempered: number,
	brittle: number,
	brittleRefs: readonly string[],
): string {
	return [
		MARKER,
		"",
		"## ⚒️ Temper Report",
		"",
		"| Package | Temper | Branches |",
		"| --- | --- | --- |",
		...reports.map(
			(report) =>
				`| \`${report.name}\` | ${tier(report)} ${formatPct(report.lines)} | ${formatPct(report.branches)} |`,
		),
		"",
		freshSteel(tempered, brittle, brittleRefs),
	].join("\n");
}
