import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { PACKAGES, type Temper } from "./temper.ts";

const MARKER = "<!-- temper-report -->";
const MAX_BRITTLE_REFS = 8;

interface PackageReport {
	readonly branches: number;
	readonly lines: number;
	readonly name: string;
	readonly temper: Temper;
}

interface LineRange {
	end: number;
	start: number;
}

class GitHubRequestError extends Error {
	readonly status: number;

	constructor(message: string, status: number) {
		super(message);
		this.status = status;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function git(args: readonly string[], cwd?: string): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
}

function readJson(path: string): unknown {
	return JSON.parse(readFileSync(path, "utf8"));
}

function readCoverageFile(path: string): unknown {
	try {
		return readJson(path);
	} catch {
		throw new Error(
			`Missing Coverage Report: ${path} (run \`pnpm test:coverage\` first)`,
		);
	}
}

function metricPct(
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

function lineCoverage(fileCoverage: unknown): Map<number, number> {
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

function addedLinesByFile(
	root: string,
	baseRef: string,
	paths: readonly string[],
): Map<string, Set<number>> {
	const diff = git(
		["diff", "--unified=0", "--no-color", `${baseRef}...HEAD`, "--", ...paths],
		root,
	);

	const added = new Map<string, Set<number>>();

	let current: Set<number> | undefined;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+++ ")) {
			const target = line.slice(4).trim();
			if (target === "/dev/null") {
				current = undefined;
				continue;
			}

			const path = target.replace(/^b\//, "");

			current = added.get(path) ?? new Set();
			added.set(path, current);

			continue;
		}

		const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
		if (!hunk || !current) continue;

		const start = Number(hunk[1]);
		const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
		for (let offset = 0; offset < count; offset++) current.add(start + offset);
	}

	return added;
}

function toRanges(lines: readonly number[]): LineRange[] {
	const ranges: LineRange[] = [];
	for (const line of [...lines].sort((a, b) => a - b)) {
		const last = ranges.at(-1);
		if (last && line === last.end + 1) last.end = line;
		else ranges.push({ end: line, start: line });
	}

	return ranges;
}

function formatRange(file: string, range: LineRange): string {
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

function tier(report: PackageReport): string {
	const { branches, lines, temper } = report;

	if (lines >= temper.lines && branches >= temper.branches) return "🔥";
	if (lines >= temper.lines - 10 && branches >= temper.branches - 10)
		return "🟠";

	return "🧊";
}

function freshSteel(
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

function render(
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

function pullRequestNumber(): number | undefined {
	const eventPath = process.env.GITHUB_EVENT_PATH;
	if (!eventPath) return undefined;

	const event = readJson(eventPath);
	if (
		isRecord(event) &&
		isRecord(event.pull_request) &&
		typeof event.pull_request.number === "number"
	)
		return event.pull_request.number;

	return undefined;
}

async function github(
	token: string,
	method: string,
	url: string,
	body?: unknown,
): Promise<unknown> {
	const response = await fetch(url, {
		body: body === undefined ? undefined : JSON.stringify(body),
		headers: {
			accept: "application/vnd.github+json",
			authorization: `Bearer ${token}`,
			"user-agent": "temper-report",
			"x-github-api-version": "2022-11-28",
		},
		method,
	});

	if (!response.ok)
		throw new GitHubRequestError(
			`GitHub Request Failed: ${response.status} from ${method} ${url}: ${await response.text()}`,
			response.status,
		);

	return response.json();
}

async function upsertComment(
	token: string,
	repository: string,
	pullRequest: number,
	body: string,
): Promise<void> {
	const api = process.env.GITHUB_API_URL || "https://api.github.com";
	const base = `${api}/repos/${repository}`;

	for (let page = 1; ; page++) {
		const comments = await github(
			token,
			"GET",
			`${base}/issues/${pullRequest}/comments?per_page=100&page=${page}`,
		);

		if (!Array.isArray(comments)) break;

		for (const comment of comments) {
			if (
				isRecord(comment) &&
				typeof comment.id === "number" &&
				typeof comment.body === "string" &&
				comment.body.includes(MARKER)
			) {
				await github(token, "PATCH", `${base}/issues/comments/${comment.id}`, {
					body,
				});

				return;
			}
		}

		if (comments.length < 100) break;
	}

	await github(token, "POST", `${base}/issues/${pullRequest}/comments`, {
		body,
	});
}

const root = git(["rev-parse", "--show-toplevel"]).trim();
const baseRef = `origin/${process.env.GITHUB_BASE_REF || "main"}`;

const sourceDirs = Object.values(PACKAGES).map((pkg) =>
	join(pkg.directory, "src"),
);

const added = addedLinesByFile(root, baseRef, sourceDirs);

const reports: PackageReport[] = [];
const brittleRefs: string[] = [];

let tempered = 0;
let brittle = 0;

for (const [name, pkg] of Object.entries(PACKAGES)) {
	const coverageDir = join(root, pkg.directory, "coverage");
	const summaryPath = join(coverageDir, "coverage-summary.json");
	const summary = readCoverageFile(summaryPath);

	reports.push({
		branches: metricPct(summary, "branches", summaryPath),
		lines: metricPct(summary, "lines", summaryPath),
		name,
		temper: pkg.temper,
	});

	const final = readCoverageFile(join(coverageDir, "coverage-final.json"));
	if (!isRecord(final)) continue;

	for (const [filePath, fileCoverage] of Object.entries(final)) {
		const marker = `/${pkg.directory}/`;
		const index = filePath.lastIndexOf(marker);
		const relPath =
			index === -1
				? relative(root, filePath)
				: join(pkg.directory, filePath.slice(index + marker.length));

		const addedLines = added.get(relPath);
		if (!addedLines) continue;

		const coverage = lineCoverage(fileCoverage);
		const brittleLines: number[] = [];
		for (const line of addedLines) {
			const count = coverage.get(line);
			if (count === undefined) continue;

			if (count > 0) tempered++;
			else brittleLines.push(line);
		}

		brittle += brittleLines.length;
		for (const range of toRanges(brittleLines))
			brittleRefs.push(formatRange(relPath, range));
	}
}

const body = render(reports, tempered, brittle, brittleRefs);

if (process.env.GITHUB_STEP_SUMMARY)
	appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${body}\n`);

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const pullRequest = pullRequestNumber();

if (!token || !repository || pullRequest === undefined) console.log(body);
else
	try {
		await upsertComment(token, repository, pullRequest, body);
	} catch (error) {
		if (error instanceof GitHubRequestError && error.status === 403)
			console.warn(`Comment Forbidden (likely a fork): ${error.message}`);
		else throw error;
	}
