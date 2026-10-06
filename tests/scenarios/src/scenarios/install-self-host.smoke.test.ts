import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "vitest";
import {
	createProject,
	expectInstallBuildAndTypecheck,
	withScenarioWorkspace,
} from "../utils/harness";
import {
	expectSelfHostedRpc,
	expectServerOnlyCodeOutOfClientBundle,
	injectOrpcContextProbe,
	writeOrpcCallerProbe,
} from "../utils/install-smoke";

describe.runIf(process.env.FORGE_SMOKE === "1")("install smoke", () => {
	it("installs, builds, and hydrates Next.js as an oRPC self host", async () => {
		await withScenarioWorkspace("smoke-orpc-self-nextjs", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				authMethods: ["email-password"],
				backend: "self",
				database: "sqlite",
				linter: "biome",
				orm: "drizzle",
				packageManager: "pnpm",
				rpc: "orpc",
				style: "tailwind",
				web: "nextjs",
			});

			const probeRoot = join(
				workspace.projectRoot,
				"apps/web/app/api/caller-probe",
			);

			await mkdir(probeRoot, { recursive: true });
			await writeFile(
				join(probeRoot, "route.ts"),
				`import { ORPCError } from "@orpc/server";
import { client } from "@/orpc/client";

export async function GET() {
  try {
    return Response.json({
      health: await client.health(),
      me: await client.me(),
    });
  } catch (error) {
    if (error instanceof ORPCError)
      return Response.json({ code: error.code }, { status: error.status });

    throw error;
  }
}
`,
			);

			const hydrationRoot = join(
				workspace.projectRoot,
				"apps/web/app/api/hydration-probe",
			);

			await mkdir(hydrationRoot, { recursive: true });
			await writeFile(
				join(hydrationRoot, "route.ts"),
				`import { dehydrate, QueryClient } from "@tanstack/react-query";
import { orpc } from "@/orpc/client";

export async function GET() {
  const queryClient = new QueryClient();

  await queryClient.fetchQuery(orpc.health.queryOptions());

  return Response.json(dehydrate(queryClient));
}
`,
			);

			await injectOrpcContextProbe(workspace.projectRoot);
			await expectInstallBuildAndTypecheck(workspace, "pnpm");
			await expectServerOnlyCodeOutOfClientBundle(
				{
					client: join(workspace.projectRoot, "apps/web/.next/static"),
					server: join(workspace.projectRoot, "apps/web/.next/server"),
				},
				[
					"AUTH_SECRET",
					"DATABASE_URL",
					"createRouterClient",
					"getSession",
					"@libsql",
				],
			);

			await expectSelfHostedRpc(workspace.projectRoot, {
				web: "nextjs",
				rpc: "orpc",
			});
		});
	}, 600_000);

	it.each([
		{ web: "tanstack-start", rpc: "orpc", orm: "drizzle", secondary: false },
		{ web: "react-router", rpc: "orpc", orm: "drizzle", secondary: false },
		{ web: "tanstack-start", rpc: "orpc", orm: "drizzle", secondary: true },
		{ web: "react-router", rpc: "orpc", orm: "drizzle", secondary: true },
		{
			web: "tanstack-start",
			rpc: "trpc",
			orm: "drizzle",
			secondary: false,
			injectPort: true,
		},
		{
			web: "react-router",
			rpc: "trpc",
			orm: "drizzle",
			secondary: false,
			injectPort: true,
		},
		{ web: "react-router", rpc: "orpc", orm: "prisma", secondary: false },
	] as const)(
		"installs, builds, and starts $web as a $rpc self host on $orm (secondary: $secondary)",
		async (cell) => {
			const { web, rpc, orm, secondary } = cell;
			await withScenarioWorkspace(
				`smoke-${rpc}-self-${web}-${orm}`,
				async (workspace) => {
					await createProject(workspace, {
						authentication: "better-auth",
						authMethods: ["email-password"],
						backend: "self",
						database: "sqlite",
						linter: "biome",
						orm,
						packageManager: "pnpm",
						rpc,
						style: "tailwind",
						web,
						...(secondary
							? {
									webApps: [
										{ name: "admin", framework: "nextjs", client: true },
									],
								}
							: {}),
					});

					if (rpc === "orpc") {
						await writeOrpcCallerProbe(workspace.projectRoot, web);
						await injectOrpcContextProbe(workspace.projectRoot);
					}

					await expectInstallBuildAndTypecheck(workspace, "pnpm");
					await expectSelfHostedRpc(workspace.projectRoot, {
						web,
						rpc,
						injectPort: "injectPort" in cell,
						...(secondary
							? {
									clientOrigin:
										web === "react-router"
											? "http://localhost:5174"
											: "http://localhost:3002",
								}
							: {}),
					});
				},
			);
		},
		600_000,
	);
});
