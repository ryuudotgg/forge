import { Cause, Effect, Exit, Option } from "effect";
import { describe, expect, it } from "vitest";
import {
	type DependencyFormat,
	type DiscoveredModule,
	projectTarget,
	Renderer,
	type SurfaceRenderContribution,
	selectedModuleTarget,
	surfaceDependencies,
	surfaceJson,
	surfaceLines,
	surfaceScripts,
	surfaceText,
} from "../src/index";

function appModule(
	framework: string,
	slots: Record<string, string> = {},
): DiscoveredModule {
	return {
		framework,
		id: "abcde",
		root: "apps/web",
		slots,
		template: { id: "base", version: 1 },
		type: "app",
	};
}

function packageModule(slots: Record<string, string>): DiscoveredModule {
	return {
		capabilities: [],
		id: "fghij",
		packageType: "db",
		root: "packages/x",
		slots,
		template: { id: "base", version: 1 },
		type: "package",
	};
}

function render(
	inputs: ReadonlyArray<SurfaceRenderContribution>,
	modules: ReadonlyArray<DiscoveredModule>,
	format?: DependencyFormat,
) {
	return Effect.runPromise(
		Renderer.render(inputs, modules, format).pipe(
			Effect.provide(Renderer.Default),
		),
	);
}

async function renderFailure(
	inputs: ReadonlyArray<SurfaceRenderContribution>,
	modules: ReadonlyArray<DiscoveredModule>,
) {
	const exit = await Effect.runPromiseExit(
		Renderer.render(inputs, modules).pipe(Effect.provide(Renderer.Default)),
	);

	if (!Exit.isFailure(exit)) throw new Error("Expected Render Failure");

	const failure = Cause.failureOption(exit.cause);
	if (Option.isNone(failure)) throw new Error("Expected Render Failure");

	return failure.value;
}

describe("renderer", () => {
	it("combines package json surface contributions into a sorted artifact", async () => {
		const inputs = [
			{
				bucket: { kind: "project" },
				contribution: surfaceScripts(projectTarget(), "rootPackageJson", {
					test: "vitest",
				}),
				definitionId: "scripts",
				order: 2,
			},
			{
				bucket: { kind: "project" },
				contribution: surfaceJson(projectTarget(), "rootPackageJson", {
					name: "acme",
					private: true,
				}),
				definitionId: "root",
				order: 0,
			},
			{
				bucket: { kind: "project" },
				contribution: surfaceJson(projectTarget(), "rootPackageJson", {
					scripts: { test: "vitest run" },
				}),
				definitionId: "override",
				order: 3,
			},
			{
				bucket: { kind: "project" },
				contribution: surfaceDependencies(projectTarget(), "rootPackageJson", [
					{
						name: "react",
						type: "dependencies",
						version: "^19.0.0",
					},
					{
						catalog: "dev",
						name: "typescript",
						type: "devDependencies",
						version: "^5.0.0",
					},
				]),
				definitionId: "deps",
				order: 1,
			},
		] satisfies ReadonlyArray<SurfaceRenderContribution>;

		const rendered = await render(inputs, []);

		expect(rendered).toHaveLength(1);
		expect(rendered[0]?.bucket).toEqual({ kind: "project" });
		expect(rendered[0]?.key).toBe("rootPackageJson");
		expect(rendered[0]?.kind).toBe("surface");
		expect(rendered[0]?.path).toBe("package.json");
		expect(rendered[0]?.definitionIds).toEqual([
			"scripts",
			"root",
			"override",
			"deps",
		]);
		expect(rendered[0]?.content).toBe(
			`${[
				"{",
				'  "name": "acme",',
				'  "private": true,',
				'  "scripts": {',
				'    "test": "vitest run"',
				"  },",
				'  "dependencies": {',
				'    "react": "^19.0.0"',
				"  },",
				'  "devDependencies": {',
				'    "typescript": "catalog:dev"',
				"  }",
				"}",
			].join("\n")}\n`,
		);
	});

	it("renders explicit versions when the dependency format disables the catalog", async () => {
		const inputs = [
			{
				bucket: { kind: "project" },
				contribution: surfaceDependencies(projectTarget(), "rootPackageJson", [
					{
						catalog: "",
						name: "react",
						type: "dependencies",
						version: "^19.0.0",
					},
					{
						name: "@acme/ui",
						type: "dependencies",
						version: "workspace:*",
					},
				]),
				definitionId: "deps",
				order: 0,
			},
		] satisfies ReadonlyArray<SurfaceRenderContribution>;

		const rendered = await render(inputs, [], {
			useCatalog: false,
			useWorkspaceProtocol: false,
		});

		expect(rendered).toHaveLength(1);
		expect(rendered[0]?.path).toBe("package.json");
		expect(JSON.parse(rendered[0]?.content ?? "{}")).toEqual({
			dependencies: {
				"@acme/ui": "*",
				react: "^19.0.0",
			},
		});
	});

	it("renders module surfaces through the module slot map", async () => {
		const inputs = [
			{
				bucket: { kind: "module", moduleId: "abcde" },
				contribution: surfaceText(
					selectedModuleTarget(),
					"layout",
					"export default function Layout() {}\n",
				),
				definitionId: "nextjs/base",
				order: 0,
			},
		] satisfies ReadonlyArray<SurfaceRenderContribution>;

		const rendered = await render(inputs, [
			appModule("nextjs", { layout: "app/(site)/layout.tsx" }),
		]);

		expect(rendered).toEqual([
			{
				bucket: { kind: "module", moduleId: "abcde" },
				content: "export default function Layout() {}\n",
				definitionIds: ["nextjs/base"],
				key: "layout",
				kind: "surface",
				path: "apps/web/app/(site)/layout.tsx",
			},
		]);
	});

	it("renders line surfaces with deduped lines and appended sections", async () => {
		const inputs = [
			{
				bucket: { kind: "project" },
				contribution: surfaceLines(projectTarget(), "gitignore", [
					"node_modules",
					"dist",
				]),
				definitionId: "base",
				order: 0,
			},
			{
				bucket: { kind: "project" },
				contribution: surfaceLines(projectTarget(), "gitignore", [
					"dist",
					".turbo",
				]),
				definitionId: "turbo",
				order: 1,
			},
			{
				bucket: { kind: "project" },
				contribution: surfaceLines(projectTarget(), "gitignore", [".next"], {
					section: "Next",
				}),
				definitionId: "nextjs",
				order: 2,
			},
		] satisfies ReadonlyArray<SurfaceRenderContribution>;

		const rendered = await render(inputs, []);

		expect(rendered).toEqual([
			{
				bucket: { kind: "project" },
				content: "node_modules\ndist\n.turbo\n\n# Next\n.next\n",
				definitionIds: ["base", "turbo", "nextjs"],
				key: "gitignore",
				kind: "surface",
				path: ".gitignore",
			},
		]);
	});

	it("prefers the highest priority text contribution", async () => {
		const inputs = [
			{
				bucket: { kind: "module", moduleId: "abcde" },
				contribution: surfaceText(
					selectedModuleTarget(),
					"layout",
					"override layout\n",
					{ priority: 1 },
				),
				definitionId: "override",
				order: 0,
			},
			{
				bucket: { kind: "module", moduleId: "abcde" },
				contribution: surfaceText(
					selectedModuleTarget(),
					"layout",
					"base layout\n",
					{ priority: 0 },
				),
				definitionId: "base",
				order: 1,
			},
		] satisfies ReadonlyArray<SurfaceRenderContribution>;

		const rendered = await render(inputs, [
			appModule("nextjs", { layout: "app/layout.tsx" }),
		]);

		expect(rendered).toHaveLength(1);
		expect(rendered[0]?.content).toBe("override layout\n");
	});

	it("fails when text contributions tie at the top priority", async () => {
		const error = await renderFailure(
			[
				{
					bucket: { kind: "module", moduleId: "abcde" },
					contribution: surfaceText(selectedModuleTarget(), "layout", "left\n"),
					definitionId: "left",
					order: 0,
				},
				{
					bucket: { kind: "module", moduleId: "abcde" },
					contribution: surfaceText(
						selectedModuleTarget(),
						"layout",
						"right\n",
					),
					definitionId: "right",
					order: 1,
				},
			],
			[appModule("nextjs", { layout: "app/layout.tsx" })],
		);

		expect(error._tag).toBe("RendererError");
		expect(error.message).toBe(
			"Render Failed: Error: Managed Surface Conflict",
		);
	});

	it("resolves the framework config surface for nextjs apps", async () => {
		const inputs = [
			{
				bucket: { kind: "module", moduleId: "abcde" },
				contribution: surfaceText(
					selectedModuleTarget(),
					"frameworkConfig",
					"export default {};\n",
				),
				definitionId: "nextjs/config",
				order: 0,
			},
		] satisfies ReadonlyArray<SurfaceRenderContribution>;

		const rendered = await render(inputs, [appModule("nextjs")]);

		expect(rendered).toHaveLength(1);
		expect(rendered[0]?.path).toBe("apps/web/next.config.ts");
	});

	it("fails the framework config surface for unsupported frameworks", async () => {
		const error = await renderFailure(
			[
				{
					bucket: { kind: "module", moduleId: "abcde" },
					contribution: surfaceText(
						selectedModuleTarget(),
						"frameworkConfig",
						"export default {};\n",
					),
					definitionId: "remix/config",
					order: 0,
				},
			],
			[appModule("remix")],
		);

		expect(error._tag).toBe("RendererError");
		expect(error.message).toBe(
			"Render Failed: Error: Unsupported Framework Config Surface",
		);
	});

	it("fails when a module slot is missing", async () => {
		const error = await renderFailure(
			[
				{
					bucket: { kind: "module", moduleId: "abcde" },
					contribution: surfaceText(
						selectedModuleTarget(),
						"db",
						"export {};\n",
					),
					definitionId: "drizzle/base",
					order: 0,
				},
			],
			[appModule("nextjs", { layout: "app/layout.tsx" })],
		);

		expect(error._tag).toBe("RendererError");
		expect(error.message).toBe("Render Failed: Error: Module Slot Missing");
	});

	it("renders package module slot surfaces", async () => {
		const inputs = [
			{
				bucket: { kind: "module", moduleId: "fghij" },
				contribution: surfaceText(
					selectedModuleTarget(),
					"client",
					'export const client = "db";\n',
				),
				definitionId: "db/base",
				order: 0,
			},
		] satisfies ReadonlyArray<SurfaceRenderContribution>;

		const rendered = await render(inputs, [
			packageModule({ client: "src/client.ts" }),
		]);

		expect(rendered).toHaveLength(1);
		expect(rendered[0]?.path).toBe("packages/x/src/client.ts");
	});

	it("fails when a project bucket targets a module surface", async () => {
		const error = await renderFailure(
			[
				{
					bucket: { kind: "project" },
					contribution: surfaceText(projectTarget(), "layout", "export {};\n"),
					definitionId: "broken",
					order: 0,
				},
			],
			[],
		);

		expect(error._tag).toBe("RendererError");
		expect(error.message).toBe(
			"Render Failed: Error: Project Surface Mismatch",
		);
	});

	it("fails when the target module is not discovered", async () => {
		const error = await renderFailure(
			[
				{
					bucket: { kind: "module", moduleId: "zzzzz" },
					contribution: surfaceText(
						selectedModuleTarget(),
						"layout",
						"export {};\n",
					),
					definitionId: "orphan",
					order: 0,
				},
			],
			[],
		);

		expect(error._tag).toBe("RendererError");
		expect(error.message).toBe("Render Failed: Error: Target Module Missing");
	});
});
