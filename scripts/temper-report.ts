import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { PACKAGES } from "./temper.ts";
import {
	formatRange,
	isRecord,
	lineCoverage,
	MARKER,
	metricPct,
	type PackageReport,
	parseAddedLines,
	render,
	toRanges,
} from "./tempering.ts";

class GitHubRequestError extends Error {
	readonly status: number;

	constructor(message: string, status: number) {
		super(message);
		this.status = status;
	}
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
			...(body !== undefined && { "content-type": "application/json" }),
			"user-agent": "temper-report",
			"x-github-api-version": "2026-03-10",
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

const diff = git(
	[
		"diff",
		"--unified=0",
		"--no-color",
		`${baseRef}...HEAD`,
		"--",
		...sourceDirs,
	],
	root,
);

const added = parseAddedLines(diff);

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
