import { isCancel, log, multiselect } from "@clack/prompts";
import {
	type AuthPlugin,
	authMethods,
	authPluginRequirement,
	authPlugins,
	unmetAuthPluginRequirements,
} from "@ryuugg/generators";
import { Result, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { choiceOptions, unsupportedMessage } from "../../utils/choices";
import { listAnd } from "../../utils/list";
import { defineStep, SKIP } from "../types";

export const authPluginsSchema = Schema.Array(
	Schema.Literals(authPlugins.ids),
).pipe(
	Schema.check(
		Schema.makeFilter((values) => {
			const unavailable = values.filter(
				(value) => !authPlugins.available(value),
			);

			return unavailable.length === 0
				? undefined
				: unsupportedMessage(authPlugins, unavailable);
		}),
	),
);

export function authPluginRequirementMessage(
	plugins: ReadonlyArray<AuthPlugin>,
) {
	const labels = listAnd.format(
		plugins.map((plugin) => authPlugins.label(plugin)),
	);

	const methods = new Set(
		plugins.flatMap((plugin) => {
			const required = authPluginRequirement(plugin);
			return required === undefined ? [] : [authMethods.label(required)];
		}),
	);

	return `${labels} ${plugins.length === 1 ? "needs" : "need"} ${methods.size === 1 ? "this sign-in method" : "these sign-in methods"}: ${listAnd.format(methods)}.`;
}

const authPluginsStep = defineStep<typeof authPluginsSchema.Type>({
	id: "authPlugins",
	group: "auth",
	schema: authPluginsSchema,
	configKey: "authPlugins",
	dependencies: ["authentication", "authMethods"],
	shouldRun: (config) => config.authentication === "better-auth",

	async execute(config, interactive) {
		if (!interactive) return SKIP;

		let initialValues: AuthPlugin[] = [];
		for (;;) {
			const selection = await multiselect({
				message: "Which Better Auth plugins do you want?",
				required: false,
				options: choiceOptions(authPlugins),
				initialValues,
			});

			if (isCancel(selection)) cancel();
			if (selection.length === 0) return SKIP;

			const decoded = Schema.decodeUnknownResult(authPluginsSchema)(selection);
			if (Result.isFailure(decoded)) {
				log.warn("Choose only the plugins we support today.");
				initialValues = selection.filter((plugin) =>
					authPlugins.available(plugin),
				);

				continue;
			}

			const missing = unmetAuthPluginRequirements({
				...config,
				authPlugins: selection,
			});

			if (missing.length === 0) return selection;

			log.warn(authPluginRequirementMessage(missing));
			initialValues = selection.filter((plugin) => !missing.includes(plugin));
		}
	},
});

export default authPluginsStep;
