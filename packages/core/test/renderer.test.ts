import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
	type DiscoveredModule,
	projectTarget,
	Renderer,
	type SurfaceRenderContribution,
	selectedModuleTarget,
	surfaceDependencies,
	surfaceJson,
	surfaceScripts,
	surfaceText,
} from "../src/index";

describe("renderer", () => {
	it("combines package json surface contributions into a sorted artifact", async () => {
		const inputs = [
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
			{
				bucket: { kind: "project" },
				contribution: surfaceScripts(projectTarget(), "rootPackageJson", {
					test: "vitest",
				}),
				definitionId: "scripts",
				order: 2,
			},
		] satisfies ReadonlyArray<SurfaceRenderContribution>;

		const rendered = await Effect.runPromise(
			Renderer.render(inputs, []).pipe(Effect.provide(Renderer.Default)),
		);

		expect(rendered).toHaveLength(1);
		expect(rendered[0]?.path).toBe("package.json");
		expect(rendered[0]?.definitionIds).toEqual(["root", "deps", "scripts"]);
		expect(JSON.parse(rendered[0]?.content ?? "{}")).toEqual({
			name: "acme",
			private: true,
			scripts: {
				test: "vitest",
			},
			dependencies: {
				react: "^19.0.0",
			},
			devDependencies: {
				typescript: "catalog:dev",
			},
		});
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

		const rendered = await Effect.runPromise(
			Renderer.render(inputs, [], {
				useCatalog: false,
				useWorkspaceProtocol: false,
			}).pipe(Effect.provide(Renderer.Default)),
		);

		expect(JSON.parse(rendered[0]?.content ?? "{}")).toEqual({
			dependencies: {
				"@acme/ui": "*",
				react: "^19.0.0",
			},
		});
	});

	it("renders module surfaces through the module slot map", async () => {
		const modules = [
			{
				framework: "nextjs",
				id: "abcde",
				root: "apps/web",
				slots: { layout: "app/(site)/layout.tsx" },
				template: { id: "base", version: 1 },
				type: "app",
			},
		] satisfies ReadonlyArray<DiscoveredModule>;

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

		const rendered = await Effect.runPromise(
			Renderer.render(inputs, modules).pipe(Effect.provide(Renderer.Default)),
		);

		expect(rendered).toEqual([
			expect.objectContaining({
				content: "export default function Layout() {}\n",
				definitionIds: ["nextjs/base"],
				path: "apps/web/app/(site)/layout.tsx",
			}),
		]);
	});
});
