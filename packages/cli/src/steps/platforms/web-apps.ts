import { reservedWebAppNames } from "@ryuugg/generators";
import { Schema } from "effect";
import { defineStep, SKIP } from "../types";
import { webSchema } from "./web";

const reservedNames = new Set<string>(reservedWebAppNames);

const webAppNameSchema = Schema.String.check(
	Schema.makeFilter((name) => {
		if (!/^[a-z][a-z0-9-]*$/.test(name))
			return `${name} isn't a valid web app name. Start with a lowercase letter and use only lowercase letters, numbers and hyphens.`;

		if (reservedNames.has(name))
			return `${name} is reserved. Pick another name for this web app.`;
	}),
);

export const webAppsSchema = Schema.Array(
	Schema.Struct({ name: webAppNameSchema, framework: webSchema }),
).check(
	Schema.makeFilter((apps) => {
		const names = new Set<string>();
		for (const app of apps) {
			if (names.has(app.name))
				return `${app.name} is used by more than one web app.`;

			names.add(app.name);
		}
	}),
);

export default defineStep<typeof webAppsSchema.Type>({
	id: "webApps",
	group: "platforms",
	configKey: "webApps",
	schema: webAppsSchema,
	dependencies: ["web"],
	shouldRun: (config) => !!config.platforms?.includes("web"),
	async execute() {
		return SKIP;
	},
});
