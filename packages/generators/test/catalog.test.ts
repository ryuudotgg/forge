import { describe, expect, it } from "vitest";
import {
	getCatalogEntry,
	listCatalogEntries,
	listVisibleAddons,
} from "../src/index";

describe("catalog", () => {
	it("lists visible reviewed addons only", () => {
		const addons = listVisibleAddons();

		expect(addons.some((entry) => entry.id === "tailwind")).toBe(true);
		expect(addons.some((entry) => entry.id === "root")).toBe(false);
		expect(addons.every((entry) => entry.kind === "addon")).toBe(true);
	});

	it("resolves catalog entries by kind and id", () => {
		expect(listCatalogEntries("framework").map((entry) => entry.id)).toContain(
			"nextjs",
		);

		expect(getCatalogEntry("nextjs/base")).toMatchObject({
			id: "nextjs/base",
			kind: "template",
			name: "Base",
		});

		expect(getCatalogEntry("tailwind")).toMatchObject({
			id: "tailwind",
			kind: "addon",
			name: "Tailwind CSS",
			targetMode: "single",
		});
	});
});
