import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createProject,
	expectInstallBuildAndTypecheck,
	pathExists,
	withScenarioWorkspace,
} from "../utils/harness";
import {
	addExpoOrpcProbeRoute,
	expectBundledNativeWindStyles,
	expectNativeOrpcClientBundle,
} from "../utils/install-smoke";

describe.runIf(process.env.FORGE_SMOKE === "1")("install smoke", () => {
	// Each framework addition gets one pnpm-only acceptance case; the
	// package-manager matrix remains Next.js-only to keep smoke cost bounded.
	it.each(["trpc", "orpc"] satisfies ReadonlyArray<"trpc" | "orpc">)(
		"installs, builds, and typechecks an Expo project with %s",
		async (rpc) => {
			await withScenarioWorkspace(`smoke-expo-${rpc}`, async (workspace) => {
				await createProject(workspace, {
					authentication: "better-auth",
					authPlugins: ["polar"],
					backend: "hono",
					database: "sqlite",
					linter: "biome",
					mobile: "expo",
					nativeStyleFramework: "nativewind",
					orm: "drizzle",
					packageManager: "pnpm",
					platforms: ["web", "mobile"],
					rpc,
					style: "tailwind",
					web: "nextjs",
				});

				await expectInstallBuildAndTypecheck(workspace, "pnpm");
				expect(
					await pathExists(
						join(workspace.projectRoot, "apps/mobile/forge.json"),
					),
				).toBe(true);

				if (rpc === "orpc") await addExpoOrpcProbeRoute(workspace.projectRoot);

				const bundle = await expectBundledNativeWindStyles(workspace);
				if (rpc === "orpc") expectNativeOrpcClientBundle(bundle);
			});
		},
		600_000,
	);
});
