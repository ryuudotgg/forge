import type { ReconcilePlan } from "@ryuujs/core";
import type { ForgeConfig } from "@ryuujs/generators";
import { Schema } from "effect";

export const listOr = new Intl.ListFormat("en", { type: "disjunction" });
export const listAnd = new Intl.ListFormat("en", { type: "conjunction" });

export const plural = (count: number, singular: string, pluralForm?: string) =>
	count === 1 ? singular : (pluralForm ?? `${singular}s`);

export const configSchema: Schema.Schema<ForgeConfig> = Schema.Record({
	key: Schema.String,
	value: Schema.Unknown,
});

export function summarizePlan(plan: ReconcilePlan) {
	let writes = 0;
	let deletes = 0;
	let conflicts = 0;

	for (const item of plan.items) {
		switch (item._tag) {
			case "Write":
				writes++;
				break;

			case "Delete":
				deletes++;
				break;

			default:
				conflicts++;
				break;
		}
	}

	return {
		writes,
		deletes,
		conflicts,
		message: `We found ${String(writes)} ${plural(writes, "write")}, ${String(deletes)} ${plural(deletes, "delete")}, ${String(conflicts)} ${plural(conflicts, "conflict")}.`,
	};
}
