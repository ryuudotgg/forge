import { confirm, isCancel } from "@clack/prompts";
import { z } from "zod";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

export const authenticationCustomUISchema = z.boolean();

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
			const existing = config.authenticationCustomUI;
			if (typeof existing === "boolean") return existing;

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
