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

const CommandTiming = Schema.Struct({
	args: Schema.Array(Schema.String),
	case: Schema.String,
	command: Schema.String,
	durationMs: Schema.Number,
});

const decodeReport = Schema.decodeUnknownSync(SmokeReport);
const decodeTiming = Schema.decodeUnknownSync(CommandTiming);

type Timing = typeof CommandTiming.Type;

const seconds = (durationMs: number) => `${(durationMs / 1000).toFixed(1)}s`;
const escapeName = (name: string) => name.replaceAll("|", "\\|");

function caseNameOf(timing: Timing): string {
	return timing.case.replaceAll(" > ", " ");
}

function phaseOf(timing: Timing): string {
	if (timing.command === "node" && timing.args[0]?.endsWith("index.mjs"))
		return `forge ${timing.args[1] ?? ""}`.trim();

	const script = timing.args[0] === "run" ? timing.args[1] : timing.args[0];
	return `${timing.command} ${script ?? ""}`.trim();
}

function renderPhases(
	timings: ReadonlyArray<Timing>,
	cases: ReadonlyArray<{ readonly name: string; readonly durationMs: number }>,
): string {
	const phases = new Map<string, { calls: number; durationMs: number }>();
	for (const timing of timings) {
		const phase = phases.get(phaseOf(timing)) ?? { calls: 0, durationMs: 0 };
		phases.set(phaseOf(timing), {
			calls: phase.calls + 1,
			durationMs: phase.durationMs + timing.durationMs,
		});
	}

	const sumMs = cases.reduce((sum, entry) => sum + entry.durationMs, 0);
	const caseNames = new Set(cases.map((entry) => entry.name));
	const timedMs = timings
		.filter((timing) => caseNames.has(caseNameOf(timing)))
		.reduce((sum, timing) => sum + timing.durationMs, 0);
	const share = (durationMs: number) =>
		`${((durationMs / sumMs) * 100).toFixed(1)}%`;

	const rows = [...phases.entries()]
		.sort(([, first], [, second]) => second.durationMs - first.durationMs)
		.map(
			([phase, entry]) =>
				`| ${escapeName(phase)} | ${entry.calls} | ${seconds(entry.durationMs)} | ${share(entry.durationMs)} |`,
		);

	const columns = [
		"pnpm install",
		"pnpm build",
		"pnpm typecheck",
		"forge create",
	];
	const caseRows = cases.map((entry) => {
		const own = timings.filter((timing) => caseNameOf(timing) === entry.name);
		const spent = (phase: string) =>
			own
				.filter((timing) => phaseOf(timing) === phase)
				.reduce((sum, timing) => sum + timing.durationMs, 0);

		const cells = columns.map((phase) => seconds(spent(phase)));
		return `| ${escapeName(entry.name)} | ${seconds(entry.durationMs)} | ${cells.join(" | ")} |`;
	});

	return [
		"### Time by command",
		"",
		"| Command | Calls | Duration | Share of case sum |",
		"| --- | --- | --- | --- |",
		...rows,
		`| servers, probes and waits | | ${seconds(sumMs - timedMs)} | ${share(sumMs - timedMs)} |`,
		"",
		"<details><summary>Commands per case</summary>",
		"",
		`| Case | Duration | ${columns.join(" | ")} |`,
		`| --- | --- | ${columns.map(() => "---").join(" | ")} |`,
		...caseRows,
		"",
		"</details>",
		"",
	].join("\n");
}

function renderReport(
	report: typeof SmokeReport.Type,
	timings: ReadonlyArray<Timing>,
): string {
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
		...(timings.length > 0 ? [renderPhases(timings, cases)] : []),
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

const timingsPath = process.argv[3];
const timings = timingsPath
	? readReport(timingsPath)
			.split("\n")
			.filter((line) => line.length > 0)
			.map((line) => decodeTiming(JSON.parse(line)))
	: [];

const markdown = renderReport(report, timings);
process.stdout.write(markdown);

if (process.env.GITHUB_STEP_SUMMARY)
	appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
