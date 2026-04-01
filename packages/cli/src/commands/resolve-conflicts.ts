import { confirm, isCancel, log, note, select } from "@clack/prompts";
import type {
	ConflictResolution,
	PlanItem,
	ResolvedConflict,
} from "@ryuujs/core";
import color from "picocolors";
import { cancel } from "../utils/cancel";
import { listAnd, plural } from "./shared";

export async function resolveConflicts(
	items: ReadonlyArray<PlanItem>,
	acceptIncoming: boolean,
): Promise<ReadonlyArray<ResolvedConflict>> {
	const conflicts = items.filter(
		(
			i,
		): i is Extract<
			PlanItem,
			{ _tag: "MergeConflict" | "OfflineConflict" | "UserDeleted" }
		> =>
			i._tag === "MergeConflict" ||
			i._tag === "OfflineConflict" ||
			i._tag === "UserDeleted",
	);

	if (conflicts.length === 0) return [];

	if (acceptIncoming) {
		return conflicts.map((item) => ({
			path: item.path,
			resolution:
				item._tag === "OfflineConflict"
					? ({ _tag: "Overwrite" } satisfies ConflictResolution)
					: ({ _tag: "AcceptIncoming" } satisfies ConflictResolution),
		}));
	}

	note(
		`${String(conflicts.length)} ${plural(conflicts.length, "conflict")} need resolution.`,
		"Conflicts",
	);

	const resolutions: ResolvedConflict[] = [];

	for (const item of conflicts) {
		switch (item._tag) {
			case "MergeConflict": {
				const result = await select({
					message: `${color.yellow("Merge conflict")} in ${color.cyan(item.path)}\n  Paths: ${listAnd.format(item.conflictPaths)}`,
					options: [
						{
							value: "merge" as const,
							label: "Accept auto-merged",
							hint: "uses three-way merge result",
						},
						{
							value: "incoming" as const,
							label: "Accept incoming",
							hint: "new generator output",
						},
						{
							value: "current" as const,
							label: "Keep current",
							hint: "your version",
						},
					],
				});

				if (isCancel(result)) cancel();

				const resolution: ConflictResolution =
					result === "merge"
						? { _tag: "Merge", content: item.merged }
						: result === "incoming"
							? { _tag: "AcceptIncoming" }
							: { _tag: "KeepCurrent" };

				resolutions.push({ path: item.path, resolution });

				break;
			}

			case "OfflineConflict": {
				log.warn(
					`We can't three-way merge ${color.cyan(item.path)} because the old generators aren't available.`,
				);

				const result = await select({
					message: `What should we do with ${color.cyan(item.path)}?`,
					options: [
						{
							value: "overwrite" as const,
							label: "Overwrite",
							hint: "backs up current file as .old",
						},
						{
							value: "skip" as const,
							label: "Skip",
							hint: "keep your current file",
						},
					],
				});

				if (isCancel(result)) cancel();

				resolutions.push({
					path: item.path,
					resolution:
						result === "overwrite" ? { _tag: "Overwrite" } : { _tag: "Skip" },
				});

				break;
			}

			case "UserDeleted": {
				const result = await confirm({
					message: `You deleted ${color.cyan(item.path)} but the generator wants to recreate it. Should we recreate it?`,
				});

				if (isCancel(result)) cancel();

				resolutions.push({
					path: item.path,
					resolution: result ? { _tag: "AcceptIncoming" } : { _tag: "Skip" },
				});

				break;
			}
		}
	}

	return resolutions;
}
