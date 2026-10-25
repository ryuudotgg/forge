import { describe, expect, it } from "vitest";
import { plannedProject } from "./planner-harness";

const base = {
	catalogs: "flat",
	name: "Acme",
	packageManager: "pnpm",
	runtime: "Node.js",
	slug: "acme",
} as const;

function writeContent(
	plan: Awaited<ReturnType<typeof plannedProject>>,
	path: string,
) {
	const write = plan.writes.find((entry) => entry.path === path);
	if (write === undefined) throw new Error(`Missing Write: ${path}`);
	return write.content;
}

describe("server builds", () => {
	it.each(["hono", "express", "fastify"] as const)(
		"skips declaration output in the %s server",
		async (backend) => {
			const plan = await plannedProject({
				...base,
				backend,
				platforms: ["web"],
				web: "tanstack-router",
			});

			expect(writeContent(plan, "apps/server/tsdown.config.ts")).toContain(
				"dts: false",
			);
		},
	);

	it("skips declaration output in the worker", async () => {
		const plan = await plannedProject({
			...base,
			addons: ["worker"],
			platforms: ["web"],
			web: "nextjs",
		});

		expect(writeContent(plan, "apps/worker/tsdown.config.ts")).toContain(
			"dts: false",
		);
	});
});
