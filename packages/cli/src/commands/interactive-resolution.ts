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

async function selectResolution(message: string): Promise<ConflictResolution> {
	const resolution = await select({
		message,
		options: [
			{ label: "Keep my value", value: "user" },
			{ label: "Take Forge's", value: "forge" },
		],
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
			refusal.message === "Managed File Modified" &&
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

	const decisions: ConflictDecision[] = [];
	const managedWrites = (preflight.refusals ?? []).filter(
		(refusal) =>
			refusal.message === "Managed File Modified" &&
			refusal.operation === "write" &&
			refusal.resolvable,
	);

	for (const refusal of managedWrites) {
		log.info(color.bold(refusal.path));
		decisions.push({
			label: refusal.path,
			request: {
				resolution: await selectResolution(
					color.dim("This managed file was modified."),
				),
			},
		});
	}

	const grouped = new Map<string, ReadonlyArray<ApplyConflict>>();
	for (const conflict of preflight.conflicts ?? []) {
		const path = conflictPath(conflict.label);
		const group = grouped.get(path) ?? [];
		grouped.set(path, [...group, conflict]);
	}

	for (const [path, conflicts] of grouped) {
		log.info(color.bold(path));
		for (const conflict of conflicts)
			decisions.push({
				label: conflict.label,
				request: {
					expected: { forge: conflict.forge, user: conflict.user },
					resolution: await selectResolution(conflictMessage(conflict, path)),
				},
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
