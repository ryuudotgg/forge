import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ForgeConfig } from "../src";
import { plannedProject } from "./planner-harness";

const { templateReads, templateEdits } = vi.hoisted(() => ({
	templateReads: [] as string[],
	templateEdits: new Map<string, (template: string) => string>(),
}));

vi.mock("../src/template", async (importOriginal) => {
	const original = await importOriginal<typeof import("../src/template")>();
	return {
		...original,
		readTemplate: (path: string) => {
			templateReads.push(path);
			const template = original.readTemplate(path);
			return templateEdits.get(path)?.(template) ?? template;
		},
	};
});

afterEach(() => {
	templateReads.splice(0);
	templateEdits.clear();
});

const orpcConfig: ForgeConfig = {
	slug: "acme",
	rpc: "orpc",
	packageManager: "pnpm",
};

describe("guarded template patches", () => {
	it.each([
		{
			name: "Express CORS header",
			config: { backend: "express", web: "tanstack-router" },
			template: "frameworks/express/src/app.ts",
			anchor: '"x-trpc-source"',
		},
		{
			name: "Fastify CORS header",
			config: { backend: "fastify", web: "tanstack-router" },
			template: "frameworks/fastify/src/app.ts",
			anchor: '"x-trpc-source"',
		},
		{
			name: "Next.js proxy matcher",
			config: {
				backend: "self",
				web: "nextjs",
				webApps: [{ name: "admin", framework: "nextjs", client: true }],
			},
			template: "frameworks/nextjs/proxy.ts",
			anchor: '"/api/trpc/:path*"',
		},
	] satisfies ReadonlyArray<{
		name: string;
		config: ForgeConfig;
		template: string;
		anchor: string;
	}>)("fails the $name patch without exactly one anchor", async (cell) => {
		for (const edit of [
			(template: string) => template.replaceAll(cell.anchor, '"moved"'),
			(template: string) => `${template}\n// ${cell.anchor} ${cell.anchor}\n`,
		]) {
			templateEdits.set(cell.template, edit);

			await expect(
				plannedProject({ ...orpcConfig, ...cell.config }),
			).rejects.toThrow(`Template Anchor Not Unique: ${cell.anchor}`);
		}
	});
});

describe("oRPC request host templates", () => {
	it.each(["react-router", "tanstack-start"] satisfies ReadonlyArray<
		ForgeConfig["web"]
	>)("reads no standalone client template for %s", async (web) => {
		await plannedProject({ ...orpcConfig, backend: "self", web });
		expect(templateReads).toContain("api/orpc/web/react.tsx");
		expect(templateReads).not.toContain("api/orpc/web/client.ts");
	});
});

async function sourceFiles(directory: string): Promise<Array<string>> {
	const entries = await readdir(directory, { withFileTypes: true });
	const nested = await Promise.all(
		entries.map((entry) =>
			entry.isDirectory()
				? sourceFiles(join(directory, entry.name))
				: [join(directory, entry.name)],
		),
	);

	return nested.flat();
}

describe("generator source", () => {
	it("defines headersFromRequest once", async () => {
		const files = [
			...(await sourceFiles(join(import.meta.dirname, "../src"))),
			...(await sourceFiles(join(import.meta.dirname, "../templates"))),
		];

		const definitions = await Promise.all(
			files.map(async (file) => {
				const content = await readFile(file, "utf8");
				return content.includes("function headersFromRequest") ? [file] : [];
			}),
		);

		expect(definitions.flat()).toHaveLength(1);
	});
});
