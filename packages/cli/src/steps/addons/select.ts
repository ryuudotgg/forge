import { isCancel, multiselect } from "@clack/prompts";
import {
	getCatalogEntry,
	type OptionalAddon,
	optionalAddons,
	recommendedAddons,
} from "@ryuujs/generators";
import { Result, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

export const addonsSchema = Schema.Array(Schema.Literals(optionalAddons.ids));

function addonOption(addon: OptionalAddon) {
	const entry = getCatalogEntry(addon);
	if (entry === undefined || entry.hidden) return [];

	return [
		{
			hint: entry.summary,
			label: entry.name,
			value: addon,
		},
	];
}

const addonsStep = defineStep<typeof addonsSchema.Type>({
	id: "addons",
	group: "addons",
	schema: addonsSchema,
	configKey: "addons",

	shouldRun: () => true,

	async execute(config, interactive) {
		if (!interactive) {
			if (Array.isArray(config.addons)) {
				const normalized = config.addons
					.map((addon) => optionalAddons.normalize(addon))
					.filter((addon): addon is OptionalAddon => addon !== undefined);

				const result = Schema.decodeUnknownResult(addonsSchema)(normalized);
				if (Result.isSuccess(result)) return result.success;
			}

			return SKIP;
		}

		const options = optionalAddons.ids.flatMap(addonOption);
		if (options.length === 0) return SKIP;

		const visible = new Set(options.map((option) => option.value));
		const selectedAddons = await multiselect({
			message: "Which addons do you want to include?",
			required: false,
			initialValues: recommendedAddons.filter((addon) => visible.has(addon)),

			options,
		});

		if (isCancel(selectedAddons)) cancel();

		const result = Schema.decodeUnknownResult(addonsSchema)(selectedAddons);
		if (Result.isFailure(result)) return SKIP;

		return result.success;
	},
});

export default addonsStep;
