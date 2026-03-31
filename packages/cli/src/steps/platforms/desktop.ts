import { isCancel, select } from "@clack/prompts";
import { z } from "zod";
import { cancel } from "../../utils/cancel";
import { defineStep } from "../types";

const desktopOptions = ["Tauri", "Electron"] as const;
export const desktopSchema = z.enum(desktopOptions);

const desktopStep = defineStep<z.infer<typeof desktopSchema>>({
	id: "desktop",
	group: "platforms",
	schema: desktopSchema,
	configKey: "desktop",

	dependencies: ["platforms"],

	shouldRun: (config) =>
		Array.isArray(config.platforms) && config.platforms.includes("Desktop"),

	async execute(config, interactive) {
		if (!interactive) {
			const existing =
				typeof config.desktop === "string" ? config.desktop : undefined;

			if (existing) {
				const result = desktopSchema.safeParse(existing);
				if (result.success) return result.data;
			}

			return "Tauri";
		}

		const desktop = await select({
			message: "What is your preferred desktop framework?",
			options: desktopOptions.map((option, index) => ({
				label: index === 0 ? `${option} (Recommended)` : option,
				value: option,
			})),
		});

		if (isCancel(desktop)) cancel();

		return desktop;
	},
});

export default desktopStep;
