import { describe, expect, it, vi } from "vitest";
import { options } from "../src/cli";
import { printHelp } from "../src/utils/help";

const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

function stripAnsi(text: string): string {
	return text.replace(ansiPattern, "");
}

function captureHelp(): string[] {
	let output = "";
	const writeSpy = vi
		.spyOn(process.stdout, "write")
		.mockImplementation((chunk) => {
			output += String(chunk);
			return true;
		});

	try {
		printHelp();

		return stripAnsi(output).split("\n").slice(0, -1);
	} finally {
		writeSpy.mockRestore();
	}
}

describe("printHelp", () => {
	it("renders the exact non-TTY help layout", () => {
		expect(captureHelp().join("\n")).toBe(
			[
				"",
				"  Usage: forge [command] [options]",
				"",
				"  Commands",
				"    forge [create]                       Forge a new project from a framework, template, and addons.",
				"    forge update                         Reconcile your installed addons and templates.",
				"    forge list [query]                   Browse the Forge catalog.",
				"    forge info <id>                      Show details for a catalog entry.",
				"    forge add [addon-id]                 Add an addon to your project.",
				"    forge remove [addon-id]              Remove an addon from your project.",
				"",
				"  Global options",
				"    -h, --help                           You're looking at it!",
				"    -v, --version                        Returns the current version of Forge.",
				"",
				"  forge [create] options",
				"    -c, --config <value>                 Use a JSON Config File.",
				"    -p, --preset <value>                 Start from a named preset configuration.",
				"        --no-install                     Do not install dependencies.",
				"        --no-git                         Do not initialize a Git repository.",
				"        --name <value>                   A name for the project.",
				"        --path <value>                   Where you want the project to be created.",
				"        --runtime <value>                Node.js · Bun · Deno",
				"        --package-manager <value>        pnpm · npm · Yarn · Bun",
				"        --catalogs <value>               Flat · Scoped",
				"        --linter <value>                 Biome · Oxc (soon) · ESLint + Prettier (soon)",
				"        --web <value>                    Next.js · React Router (soon) · TanStack Router (soon) · TanStack Start",
				"        --desktop <value> (soon)         Electron · Tauri",
				"        --mobile <value> (soon)          Expo · React Native",
				"        --backend <value>                Next.js · Convex (soon) · Hono (soon) · Elysia (soon) · µWebSockets (soon) · Fastify (soon) · Express (soon)",
				"        --rpc <value>                    tRPC",
				"        --database <value>               MySQL · PostgreSQL · SQLite",
				"        --orm <value>                    Drizzle ORM · Prisma",
				"        --auth <value>                   Better Auth · Auth.js (soon) · WorkOS (soon) · Clerk (soon)",
				"        --database-provider <value>      PlanetScale · Neon · Nile · Supabase · Prisma Postgres · Turso",
				"        --style <value>                  Tailwind CSS · UnoCSS (soon)",
				"        --native-style <value> (soon)    NativeWind · Tamagui · Unistyles",
				"",
				"  forge list/info options",
				"        --kind <value>                   Filter the catalog by addon, framework, or template.",
				"        --json                           Print stable version 1 JSON; fields are added only.",
				"",
				"  forge add/remove/update options",
				"        --keep-user                      Keep your values when resolving conflicts.",
				"        --accept-forge                   Take Forge's values when resolving conflicts.",
				"",
				"  Examples",
				"    forge list auth",
				"    forge info drizzle",
				"    forge add trpc",
				"",
			]
				.map((line) => (line.length === 0 ? "│" : `│  ${line}`))
				.join("\n"),
		);
	});

	it("documents every option as a long flag", () => {
		const output = captureHelp().join("\n");

		for (const key of Object.keys(options))
			expect(output).toContain(`--${key}`);
	});

	it("aligns the description column across commands and flags", () => {
		const lines = captureHelp();

		const descriptions = [
			"Add an addon to your project.",
			"Reconcile your installed addons and templates.",
			"Use a JSON Config File.",
			"Do not initialize a Git repository.",
			"pnpm · npm · Yarn · Bun",
			"PlanetScale · Neon · Nile · Supabase · Prisma Postgres · Turso",
			"NativeWind · Tamagui · Unistyles",
		];

		const columns = descriptions.map((description) => {
			const line = lines.find((entry) => entry.includes(description));

			expect(line).toBeDefined();
			return line?.indexOf(description);
		});

		expect(new Set(columns).size).toBe(1);
	});

	it("derives choice hints with availability markers", () => {
		const output = captureHelp().join("\n");

		expect(output).toContain("Node.js · Bun · Deno");
		expect(output).toContain("Next.js · Convex (soon) · Hono (soon)");
		expect(output).toContain("PlanetScale · Neon · Nile · Supabase");
	});
});
