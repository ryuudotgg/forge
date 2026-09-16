import type { PackageManager } from "@ryuujs/core";
import { describe, expect, it, vi } from "vitest";
import { catalogEntries, catalogRef, versions } from "../src/versions";
import { plannedProject } from "./planner-harness";

const sdkModules = vi.hoisted(() => ({
	"expo-constants": "~58.0.1",
	"expo-linking": "~58.0.2",
	"expo-router": "~58.0.3",
	"expo-secure-store": "~58.0.4",
	react: "20.0.0",
	"react-dom": "20.0.0",
	"react-native": "0.88.0",
	"react-native-reanimated": "5.0.0",
	"react-native-safe-area-context": "~6.0.0",
	"react-native-screens": "~5.0.0",
	"react-native-worklets": "0.15.0",
}));

vi.mock(import("expo/package.json"), async (importOriginal) => {
	const original = await importOriginal();

	return {
		...original,
		default: { ...original.default, version: "58.0.0" },
	};
});

vi.mock(import("expo/bundledNativeModules.json"), async (importOriginal) => {
	const original = await importOriginal();

	return {
		...original,
		default: { ...original.default, ...sdkModules },
	};
});

describe("SDK catalog updates", () => {
	it("uses every updated Expo version in the mobile catalog", () => {
		const entries = catalogEntries({ mobile: "expo" }).flatMap(
			(group) => group.entries,
		);

		const catalog = Object.fromEntries(
			entries.map(({ name, version }) => [name, version]),
		);

		expect(catalog).toMatchObject({ expo: "58.0.0", ...sdkModules });

		for (const { name, version } of entries)
			expect(version, name).toMatch(/\S/);
	});

	it("preserves independently updated React versions for web-only projects", () => {
		const catalog = Object.fromEntries(
			catalogEntries({ web: "nextjs" }).flatMap((group) =>
				group.entries.map(({ name, version }) => [name, version]),
			),
		);

		expect(catalog.react).toBe(versions.react.version);
		expect(catalog["react-dom"]).toBe(versions.reactDom.version);
		expect(catalogRef("react").version).toBe(versions.react.version);
		expect(catalogRef("reactDom").version).toBe(versions.reactDom.version);
	});

	it.each<PackageManager>(["pnpm", "npm"])(
		"keeps mobile, web, and shared React dependencies aligned with %s",
		async (packageManager) => {
			const plan = await plannedProject({
				backend: "hono",
				mobile: "expo",
				name: "Acme",
				packageManager,
				platforms: ["web", "mobile"],
				runtime: "Node.js",
				slug: "acme",
				web: "nextjs",
			});

			const specifier = packageManager === "pnpm" ? "catalog:" : "20.0.0";

			for (const path of [
				"apps/mobile/package.json",
				"apps/web/package.json",
				"packages/ui/package.json",
			]) {
				const write = plan.writes.find((entry) => entry.path === path);
				if (write === undefined)
					throw new Error(`Missing Package Write: ${path}`);

				const packageJson: unknown = JSON.parse(write.content);
				expect(packageJson).toMatchObject({
					dependencies: { react: specifier },
				});

				if (path !== "apps/mobile/package.json")
					expect(packageJson).toMatchObject({
						dependencies: { "react-dom": specifier },
					});
			}

			if (packageManager === "pnpm") {
				const workspace = plan.writes.find(
					(entry) => entry.path === "pnpm-workspace.yaml",
				);

				expect(workspace?.content).toContain("  react: 20.0.0\n");
				expect(workspace?.content).toContain("  react-dom: 20.0.0\n");
			}
		},
	);
});
