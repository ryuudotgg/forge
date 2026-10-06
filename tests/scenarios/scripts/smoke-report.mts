import { appendFileSync, readFileSync } from "node:fs";
import { Schema } from "effect";

const SmokeReport = Schema.Struct({
	startTime: Schema.Number,
	testResults: Schema.Array(
		Schema.Struct({
			endTime: Schema.Number,
			assertionResults: Schema.Array(
				Schema.Struct({
					fullName: Schema.String,
					status: Schema.String,
					duration: Schema.optional(Schema.NullOr(Schema.Number)),
				}),
			),
		}),
	),
});

const decodeReport = Schema.decodeUnknownSync(SmokeReport);

function renderReport(report: typeof SmokeReport.Type): string {
	const cases = report.testResults.flatMap((result) =>
		result.assertionResults.map((assertion) => ({
			name: assertion.fullName,
			status: assertion.status,
			durationMs: assertion.duration ?? 0,
		})),
	);

	const totalMs =
		Math.max(...report.testResults.map((result) => result.endTime)) -
		report.startTime;

	const sumMs = cases.reduce((sum, entry) => sum + entry.durationMs, 0);
	const seconds = (durationMs: number) => `${(durationMs / 1000).toFixed(1)}s`;
	const escapeName = (name: string) => name.replaceAll("|", "\\|");

	const slowest = [...cases]
		.sort((first, second) => second.durationMs - first.durationMs)
		.slice(0, 10);

	return [
		"## Install Smoke Timing",
		"",
		`- Cases: ${cases.length}`,
		`- Total duration: ${seconds(totalMs)}`,
		`- Sum of case durations: ${seconds(sumMs)}`,
		"",
		"### Ten slowest cases",
		"",
		"| Case | Duration |",
		"| --- | --- |",
		...slowest.map(
			(entry) => `| ${escapeName(entry.name)} | ${seconds(entry.durationMs)} |`,
		),
		"",
		`<details><summary>All ${cases.length} cases</summary>`,
		"",
		"| Case | Status | Duration |",
		"| --- | --- | --- |",
		...cases.map(
			(entry) =>
				`| ${escapeName(entry.name)} | ${entry.status} | ${seconds(entry.durationMs)} |`,
		),
		"",
		"</details>",
		"",
	].join("\n");
}

function readReport(path: string): string {
	try {
		return readFileSync(path, "utf-8");
	} catch {
		throw new Error(`Missing Smoke Report: ${path}`);
	}
}

const path = process.argv[2];
if (!path) throw new Error("Missing Smoke Report Path");

const report = decodeReport(JSON.parse(readReport(path)));
if (report.testResults.length === 0)
	throw new Error(`Empty Smoke Report: ${path}`);

const markdown = renderReport(report);
process.stdout.write(markdown);

if (process.env.GITHUB_STEP_SUMMARY)
	appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
