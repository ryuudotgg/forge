import { isCancel, log, select } from "@clack/prompts";
import {
	type ApplyConflict,
	type ApplyError,
	type ApplyOptions,
	type ApplyResolution,
	type ConflictResolution,
	describeConflictValue,
} from "@ryuujs/core";
import color from "picocolors";
import { cancel } from "../utils/cancel";
import { listAnd } from "../utils/list";

interface ConflictDecision {
	readonly label: string;
	readonly request: ApplyResolution;
}

interface ConflictCell {
	readonly expected?: { readonly forge: unknown; readonly user: unknown };
	readonly header: string;
	readonly label: string;
	readonly message: string;
}

type ResolutionChoice = ConflictResolution | "forge-all" | "user-all";

export interface InteractiveResolution {
	readonly options: ApplyOptions;
	readonly summary: string;
}

function conflictPath(label: string): string {
	const separator = label.indexOf(" -> ");
	return separator === -1 ? label : label.slice(0, separator);
}

function conflictId(label: string, path: string): string {
	return label.slice(path.length + " -> ".length);
}

function conflictMessage(conflict: ApplyConflict, path: string): string {
	const rows: ReadonlyArray<readonly [string, string]> = [
		["Base:", describeConflictValue(conflict.base)],
		["Yours:", describeConflictValue(conflict.user)],
		["Forge:", describeConflictValue(conflict.forge)],
	];

	const width = Math.max(...rows.map(([label]) => label.length));

	return [
		color.dim(conflictId(conflict.label, path)),
		...rows.map(
			([label, value]) => `${color.dim(label.padEnd(width))}  ${value}`,
		),
	].join("\n");
}

function withProgress(message: string, step: number, total: number): string {
	if (total < 2) return message;
	const progress = color.dim(`(${step} of ${total})`);
	const newline = message.indexOf("\n");
	return newline === -1
		? `${message} ${progress}`
		: `${message.slice(0, newline)} ${progress}${message.slice(newline)}`;
}

async function selectResolution(
	message: string,
	step: number,
	total: number,
): Promise<ResolutionChoice> {
	const options: Array<{ label: string; value: ResolutionChoice }> = [
		{ label: "Keep my value", value: "user" },
		{ label: "Take Forge's", value: "forge" },
	];
	if (step < total)
		options.push(
			{ label: "Keep my value for all remaining", value: "user-all" },
			{ label: "Take Forge's for all remaining", value: "forge-all" },
		);

	const resolution = await select({
		message: withProgress(message, step, total),
		options,
	});

	if (isCancel(resolution)) cancel();
	return resolution;
}

export function isInteractiveLifecycleSession(): boolean {
	return (
		process.stdin.isTTY === true &&
		process.stdout.isTTY === true &&
		!process.env.CI
	);
}

export function canResolveInteractively(
	error: ApplyError,
	options: ApplyOptions,
): boolean {
	const preflight = error.preflight;
	if (
		preflight === undefined ||
		options.resolutionPolicy !== undefined ||
		options.conflictResolutions !== undefined ||
		preflight.hasUnmanagedRefusals ||
		preflight.hasManagedRemovals
	)
		return false;

	const conflicts = preflight.conflicts ?? [];
	if ((preflight.refusals ?? []).some((refusal) => !refusal.resolvable))
		return false;

	const managedWrites = (preflight.refusals ?? []).filter(
		(refusal) =>
			refusal.reason === "managed-file-modified" &&
			refusal.operation === "write" &&
			refusal.resolvable,
	);

	return conflicts.length > 0 || managedWrites.length > 0;
}

export async function promptForConflictResolutions(
	error: ApplyError,
): Promise<InteractiveResolution> {
	const preflight = error.preflight;
	if (preflight === undefined)
		throw new Error(
			"Interactive Resolution Missing: preflight details are required.",
		);

	const cells: ConflictCell[] = (preflight.refusals ?? [])
		.filter(
			(refusal) =>
				refusal.reason === "managed-file-modified" &&
				refusal.operation === "write" &&
				refusal.resolvable,
		)
		.map((refusal) => ({
			header: refusal.path,
			label: refusal.path,
			message: color.dim("This managed file was modified."),
		}));

	const grouped = new Map<string, ReadonlyArray<ApplyConflict>>();
	for (const conflict of preflight.conflicts ?? []) {
		const path = conflictPath(conflict.label);
		const group = grouped.get(path) ?? [];
		grouped.set(path, [...group, conflict]);
	}

	for (const [path, conflicts] of grouped)
		for (const conflict of conflicts)
			cells.push({
				expected: { forge: conflict.forge, user: conflict.user },
				header: path,
				label: conflict.label,
				message: conflictMessage(conflict, path),
			});

	const decisions: ConflictDecision[] = [];
	let bulk: ConflictResolution | undefined;
	let header: string | undefined;

	for (const [index, cell] of cells.entries()) {
		let resolution = bulk;
		if (resolution === undefined) {
			if (cell.header !== header) {
				log.info(color.bold(cell.header));
				header = cell.header;
			}
			const choice = await selectResolution(
				cell.message,
				index + 1,
				cells.length,
			);
			if (choice === "user-all" || choice === "forge-all") {
				bulk = choice === "user-all" ? "user" : "forge";
				resolution = bulk;
			} else resolution = choice;
		}
		decisions.push({
			label: cell.label,
			request:
				cell.expected === undefined
					? { resolution }
					: { expected: cell.expected, resolution },
		});
	}

	const conflictResolutions = Object.fromEntries(
		decisions.map((decision) => [decision.label, decision.request]),
	) satisfies Record<string, ApplyResolution>;

	const resolved = decisions.map(
		(decision) =>
			`${decision.label} with ${
				decision.request.resolution === "user" ? "your value" : "Forge's value"
			}`,
	);

	return {
		options: { conflictResolutions },
		summary: `We resolved ${listAnd.format(resolved)}.`,
	};
}
