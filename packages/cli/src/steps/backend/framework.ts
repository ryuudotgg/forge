import { isCancel, select } from "@clack/prompts";
import { Schema } from "effect";
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

type ValidBackend = Exclude<(typeof backendOptions)[number], "None">;

const filteredBackendOptions = backendOptions.filter(
	(b): b is ValidBackend => b !== "None",
);

export const backendSchema = Schema.Literal(...filteredBackendOptions);

type Backend = typeof backendSchema.Type;

export default defineStep<Backend>({
	id: "backend",
	group: "backend",
	schema: backendSchema,

	shouldRun: () => true,

	async execute(config, interactive): Promise<Backend | Skip> {
		if (!interactive) return SKIP;

		const web = config.web;

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
