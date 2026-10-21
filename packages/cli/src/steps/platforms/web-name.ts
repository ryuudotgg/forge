import { isCancel, text } from "@clack/prompts";
import { webAppNamesIssue } from "@ryuugg/generators";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";
import {
	firstPartyAddonIds,
	webAppNameIssue,
	webAppNameRuleIssue,
	webAppNameSchema,
} from "./web-apps";

export default defineStep<typeof webAppNameSchema.Type>({
	id: "webName",
	group: "platforms",
	configKey: "webName",
	schema: webAppNameSchema,
	dependencies: ["web"],
	shouldRun: (config) => config.web !== undefined,
	async execute(config, interactive) {
		if (!interactive) return SKIP;

		const addonIds = firstPartyAddonIds();
		const name = await text({
			message: "What is the name of your web app?",
			initialValue: "web",
			validate(value) {
				return (
					webAppNameRuleIssue(value ?? "") ??
					webAppNameIssue(value ?? "", addonIds) ??
					webAppNamesIssue({ ...config, webName: value ?? "" })
				);
			},
		});

		if (isCancel(name)) cancel();
		return name;
	},
});
