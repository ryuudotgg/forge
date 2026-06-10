import { isCancel, multiselect } from "@clack/prompts";
import {
	getCatalogEntry,
	type OptionalAddon,
	optionalAddons,
	recommendedAddons,
} from "@ryuujs/generators";
import { Either, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

const addonIds = optionalAddons.ids as [OptionalAddon, ...OptionalAddon[]];
export const addonsSchema = Schema.Array(Schema.Literal(...addonIds));

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

				const result = Schema.decodeUnknownEither(addonsSchema)(normalized);
				if (Either.isRight(result)) return result.right;
			}

			return SKIP;
		}

		const selectedAddons = await multiselect({
			message: "Which addons do you want to include?",
			required: false,
			initialValues: [...recommendedAddons],

			options: optionalAddons.ids.flatMap(addonOption),
		});

		if (isCancel(selectedAddons)) cancel();

		const result = Schema.decodeUnknownEither(addonsSchema)(selectedAddons);

		if (Either.isLeft(result)) return SKIP;

		return result.right;
	},
});

export default addonsStep;
