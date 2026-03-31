import { confirm, isCancel } from "@clack/prompts";
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
		config.authentication === "WorkOS" || config.authentication === "Clerk",

	async execute(config, interactive) {
		if (!interactive) {
			if (config.authenticationCustomUI !== undefined)
				return config.authenticationCustomUI;

			return SKIP;
		}

		const authenticationCustomUI = await confirm({
			message: `Do you want a custom UI for ${config.authentication}?`,
			active: "Yes",
			inactive: "No",
		});

		if (isCancel(authenticationCustomUI)) cancel();

		return authenticationCustomUI;
	},
});

export default authenticationCustomUIStep;
