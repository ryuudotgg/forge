import { isCancel, select } from "@clack/prompts";
import { z } from "zod";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP, type Skip } from "../types";

const backendOptions = [
	"Next.js",
	"Convex",
	"Hono",
	"Elysia",
	"µWebSockets",
	"Fastify",
	"Express",
	"None",
] as const;

export const backendSchema = z.enum(backendOptions.filter((b) => b !== "None"));

type Backend = z.infer<typeof backendSchema>;

export default defineStep<Backend>({
	id: "backend",
	group: "backend",
	schema: backendSchema,

	shouldRun: () => true,

	async execute(config, interactive): Promise<Backend | Skip> {
		if (!interactive) return SKIP;

		const web = typeof config.web === "string" ? config.web : undefined;

		const backend = await select({
			message: "What is your preferred backend framework?",
			options: backendOptions.map((b) => ({
				label: web === b ? `${b} (Recommended)` : b,
				value: b,
			})),
		});

		if (isCancel(backend)) cancel();
		if (backend === "None") return SKIP;

		return backend;
	},
});
