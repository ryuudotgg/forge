import { confirm, isCancel } from "@clack/prompts";
import { authenticationProviders } from "@ryuujs/generators";
import { Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

export const authenticationCustomUISchema = Schema.Boolean;

const authenticationCustomUIStep = defineStep<boolean>({
	id: "authenticationCustomUI",
	group: "auth",
	schema: authenticationCustomUISchema,
	configKey: "authenticationCustomUI",

	dependencies: ["authentication"],

	shouldRun: (config) =>
		config.authentication === "workos" || config.authentication === "clerk",

	async execute(config, interactive) {
		if (!interactive) {
			if (config.authenticationCustomUI !== undefined)
				return config.authenticationCustomUI;

			return SKIP;
		}

		const authenticationCustomUI = await confirm({
			message: `Do you want a custom UI for ${config.authentication ? authenticationProviders.label(config.authentication) : "this provider"}?`,
			active: "Yes",
			inactive: "No",
		});

		if (isCancel(authenticationCustomUI)) cancel();

		return authenticationCustomUI;
	},
});

export default authenticationCustomUIStep;
