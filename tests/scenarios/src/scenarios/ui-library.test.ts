import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createProject,
	readJson,
	withScenarioWorkspace,
} from "../utils/harness";

const baseConfig = {
	linter: "biome",
	packageManager: "pnpm",
	style: "tailwind",
	web: "nextjs",
};

interface ComponentsJson {
	readonly style?: string;
}

interface PackageJson {
	readonly dependencies?: Record<string, string>;
}

describe("ui-library", () => {
	it("defaults to base ui and writes the base ui shadcn style", async () => {
		await withScenarioWorkspace("ui-library-base", async (workspace) => {
			await createProject(workspace, baseConfig);

			const uiComponents = await readJson<ComponentsJson>(
				join(workspace.projectRoot, "packages/ui/components.json"),
			);
			const appComponents = await readJson<ComponentsJson>(
				join(workspace.projectRoot, "apps/web/components.json"),
			);
			const ui = await readJson<PackageJson>(
				join(workspace.projectRoot, "packages/ui/package.json"),
			);

			expect(uiComponents.style).toBe("base-vega");
			expect(appComponents.style).toBe("base-vega");
			expect(ui.dependencies?.["@base-ui/react"]).toBeDefined();
		});
	}, 240_000);

	it("writes the radix shadcn style without the base ui dependency when selected", async () => {
		await withScenarioWorkspace("ui-library-radix", async (workspace) => {
			await createProject(workspace, {
				...baseConfig,
				uiLibrary: "radix",
			});

			const uiComponents = await readJson<ComponentsJson>(
				join(workspace.projectRoot, "packages/ui/components.json"),
			);
			const appComponents = await readJson<ComponentsJson>(
				join(workspace.projectRoot, "apps/web/components.json"),
			);
			const ui = await readJson<PackageJson>(
				join(workspace.projectRoot, "packages/ui/package.json"),
			);

			expect(uiComponents.style).toBe("radix-vega");
			expect(appComponents.style).toBe("radix-vega");
			expect(ui.dependencies?.["@base-ui/react"]).toBeUndefined();
		});
	}, 240_000);
});
