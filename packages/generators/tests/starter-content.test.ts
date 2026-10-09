import { expect, it } from "vitest";
import { type ForgeConfig, webFrameworks } from "../src";
import { plannedProject } from "./planner-harness";

const config: ForgeConfig = {
	name: "acme",
	slug: "acme",
	platforms: ["web"],
	web: "tanstack-router",
	backend: "hono",
	rpc: "orpc",
	orm: "drizzle",
	database: "postgresql",
	authentication: "better-auth",
	authMethods: ["passkey", "email-otp", "magic-link"],
	authPlugins: ["organization"],
	emailProvider: "resend",
	addons: ["vitest"],
	webApps: [{ name: "site", framework: "nextjs" }],
};

it("marks only starter content and preserves the write-once paths", async () => {
	const plan = await plannedProject(config);
	const components = plan.writes.filter((write) =>
		write.path.startsWith("packages/ui/src/components/"),
	);
	if (components.length === 0) throw new Error("Missing UI Package");

	expect(
		plan.writes
			.filter((write) => write.update === "write-once")
			.map((write) => write.path)
			.sort(),
	).toEqual(["apps/web/src/routeTree.gen.ts", "packages/email/src/custom.ts"]);

	const starterPaths = [
		"apps/site/app/page.tsx",
		"apps/web/public/favicon.svg",
		"apps/site/app/icon.svg",
		...components.map((write) => write.path),
		"packages/ui/src/styles/globals.css",
	].sort();

	expect(
		plan.writes
			.filter((write) => write.update === "starter")
			.map((write) => write.path)
			.sort(),
	).toEqual(starterPaths);
	expect(
		Object.values(plan.lockfile.artifacts)
			.filter((artifact) => artifact.update === "starter")
			.map((artifact) => artifact.path)
			.sort(),
	).toEqual(starterPaths);
	expect(
		plan.writes.find((write) => write.path === "apps/web/src/routes/index.tsx"),
	).toMatchObject({ kind: "surface" });
	expect(
		plan.writes.find((write) => write.path === "apps/web/src/routes/index.tsx"),
	).not.toHaveProperty("update");

	for (const write of plan.writes) {
		if (starterPaths.includes(write.path) || write.update === "write-once")
			continue;

		expect(write.update, write.path).toBeUndefined();
	}
});

it.each(webFrameworks.ids)(
	"marks the %s icon without releasing route wiring",
	async (web) => {
		const plan = await plannedProject({ slug: "acme", web });
		const icon =
			web === "nextjs"
				? "apps/web/app/icon.svg"
				: "apps/web/public/favicon.svg";
		const page =
			web === "nextjs"
				? "apps/web/app/page.tsx"
				: web === "react-router"
					? "apps/web/app/routes/home.tsx"
					: "apps/web/src/routes/index.tsx";

		expect(plan.writes.find((write) => write.path === icon)?.update).toBe(
			"starter",
		);
		expect(plan.writes.find((write) => write.path === page)).toBeDefined();
		expect(plan.writes.find((write) => write.path === page)?.update).toBe(
			web === "nextjs" ? "starter" : undefined,
		);
		expect(
			plan.writes.find((write) => write.path === "packages/ui/src/lib/utils.ts")
				?.update,
		).toBeUndefined();
	},
);
