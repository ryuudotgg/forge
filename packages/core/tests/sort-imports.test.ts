import { describe, expect, it } from "vitest";
import { sortScopedImports } from "../src/sort/imports";

const lines = (...entries: ReadonlyArray<string>) => `${entries.join("\n")}\n`;

describe("sort scoped imports", () => {
	it("moves a workspace scope after a third party scope it sorts behind", () => {
		const source = lines(
			'import { auth } from "@meisai/auth";',
			'import { withClientAddress } from "@meisai/auth/client-address";',
			'import { getConnInfo } from "@hono/node-server/conninfo";',
			'import { Hono } from "hono";',
			'import { webOrigins } from "../../env.js";',
		);

		expect(sortScopedImports("src/routes/auth.ts", source, "scope")).toBe(
			lines(
				'import { getConnInfo } from "@hono/node-server/conninfo";',
				'import { auth } from "@meisai/auth";',
				'import { withClientAddress } from "@meisai/auth/client-address";',
				'import { Hono } from "hono";',
				'import { webOrigins } from "../../env.js";',
			),
		);
	});

	it.each([
		{ order: "scope", first: "@expo/a/b", second: "@expo/a-b" },
		{ order: "text", first: "@expo/a-b", second: "@expo/a/b" },
		{ order: "text", first: "@expo/a", second: "@expo/a-b" },
		{ order: "scope", first: "@hono/node-server", second: "@hono-api/auth" },
		{ order: "text", first: "@hono-api/auth", second: "@hono/node-server" },
	] as const)(
		"orders $first before $second by the $order rule",
		({ order, first, second }) => {
			const source = lines(
				`import { a } from "${second}";`,
				`import { b } from "${first}";`,
			);

			const sorted = sortScopedImports("index.ts", source, order);
			expect(sorted.indexOf(first)).toBeLessThan(sorted.indexOf(second));
		},
	);

	it("orders packages that share a scope", () => {
		const source = lines(
			'import { appRouter } from "@trpc/trpc";',
			'import { createCaller } from "@trpc/trpc/caller";',
			'import { createHydrationHelpers } from "@trpc/react-query/rsc";',
		);

		expect(sortScopedImports("server.ts", source, "scope")).toBe(
			lines(
				'import { createHydrationHelpers } from "@trpc/react-query/rsc";',
				'import { appRouter } from "@trpc/trpc";',
				'import { createCaller } from "@trpc/trpc/caller";',
			),
		);
	});

	it("compares digit runs by value and keeps hyphens before digits", () => {
		const source = lines(
			'import { a } from "@a10/x";',
			'import { b } from "@ab/x";',
			'import { c } from "@a9/x";',
			'import { d } from "@a-0/x";',
		);

		expect(sortScopedImports("index.ts", source, "scope")).toBe(
			lines(
				'import { d } from "@a-0/x";',
				'import { c } from "@a9/x";',
				'import { a } from "@a10/x";',
				'import { b } from "@ab/x";',
			),
		);
	});

	it.each([
		{
			order: "scope",
			sorted: ["@a0", "@a1", "@a4", "@a9", "@a00", "@a01", "@a05", "@a10"],
		},
		{
			order: "text",
			sorted: ["@a0", "@a00", "@a01", "@a05", "@a1", "@a4", "@a9", "@a10"],
		},
	] as const)(
		"orders leading zero digit runs by the $order rule",
		({ order, sorted }) => {
			const source = lines(
				...[...sorted]
					.reverse()
					.map((scope, index) => `import { v${index} } from "${scope}/x";`),
			);

			const scopes = sortScopedImports("index.ts", source, order).match(
				/@a\d+(?=\/)/g,
			);

			expect(scopes).toEqual(sorted);
		},
	);

	it("leaves an import with a trailing comment and the code after it in place", () => {
		const source = lines(
			'import { first } from "@zeta/a"; // keeps the client warm',
			"const second = first + 1;",
			'import { third } from "@hono/b";',
			'import { fourth } from "@acme/c"; // also commented',
			"export const all = [second, third, fourth];",
		);

		expect(sortScopedImports("index.ts", source, "scope")).toBe(source);
	});

	it("moves multi line statements whole", () => {
		const source = lines(
			"import {",
			"  accounts,",
			"  sessions,",
			'} from "@zeta/db/schema";',
			'import { expo } from "@better-auth/expo";',
		);

		expect(sortScopedImports("index.ts", source, "text")).toBe(
			lines(
				'import { expo } from "@better-auth/expo";',
				"import {",
				"  accounts,",
				"  sessions,",
				'} from "@zeta/db/schema";',
			),
		);
	});

	it("never sorts across a side effect import, a comment or a statement", () => {
		const source = lines(
			'import "@zeta/env";',
			'import { a } from "@zeta/a";',
			"// Loads the route types.",
			'import { b } from "@tanstack/react-router";',
			"const c = 1;",
			'import { d } from "@zeta/d";',
		);

		expect(sortScopedImports("index.ts", source, "scope")).toBe(source);
	});

	it.each(["scope", "text"] as const)(
		"steps past equal digit runs to the next character by the %s rule",
		(order) => {
			const source = lines(
				'import { b } from "@a1y/x";',
				'import { a } from "@a1x/x";',
			);

			expect(sortScopedImports("index.ts", source, order)).toBe(
				lines('import { a } from "@a1x/x";', 'import { b } from "@a1y/x";'),
			);
		},
	);

	it("leaves an unclosed import at the end of the file in place", () => {
		const source = [
			'import { b } from "@zeta/b";',
			'import { a } from "@hono/a";',
			"import {",
			"  c,",
		].join("\n");

		expect(sortScopedImports("index.ts", source, "scope")).toBe(
			[
				'import { a } from "@hono/a";',
				'import { b } from "@zeta/b";',
				"import {",
				"  c,",
			].join("\n"),
		);
	});

	it("leaves files that are not scripts alone", () => {
		const source = lines(
			'import { a } from "@zeta/a";',
			'import { b } from "@hono/b";',
		);

		expect(sortScopedImports("README.mdx", source, "scope")).toBe(source);
	});
});
