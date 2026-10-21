import { passkey } from "@better-auth/passkey";
import { checkout, polar, portal, webhooks } from "@polar-sh/better-auth";
import { createPolarCore } from "@polar-sh/sdk/2026-10";
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { type DBFieldAttribute, getAuthTables } from "better-auth/db";
import {
	admin,
	emailOTP,
	magicLink,
	organization,
	twoFactor,
	username,
} from "better-auth/plugins";
import { describe, expect, it } from "vitest";
import { resolveAuthMethods } from "../src/auth/methods";
import { resolveAuthPlugins } from "../src/auth/plugins";
import {
	type AuthMethod,
	type AuthPlugin,
	authMethods,
	authPlugins,
	type ForgeConfig,
} from "../src/config";
import { plannedProject } from "./planner-harness";

interface ColumnShape {
	readonly type: string;
	readonly required: boolean;
	readonly unique: boolean;
}

type TableShapes = Record<string, Record<string, ColumnShape>>;

type PlannedProject = Awaited<ReturnType<typeof plannedProject>>;

const upstreamPlugins = {
	"email-password": [],
	google: [],
	apple: [],
	passkey: [passkey()],
	"email-otp": [emailOTP({ async sendVerificationOTP() {} })],
	"magic-link": [magicLink({ async sendMagicLink() {} })],
	"two-factor": [twoFactor()],
	username: [username()],
	admin: [admin()],
	organization: [organization()],
	polar: [
		polar({
			client: createPolarCore({ accessToken: "" }),
			createCustomerOnSignUp: false,
			use: [
				checkout({ authenticatedUsersOnly: true }),
				portal(),
				webhooks({ secret: "" }),
			],
		}),
	],
} satisfies Record<AuthMethod | AuthPlugin, ReadonlyArray<BetterAuthPlugin>>;

const primaryKey: ColumnShape = {
	type: "string",
	required: true,
	unique: true,
};

function upstreamColumn(field: DBFieldAttribute): ColumnShape {
	return {
		type: typeof field.type === "string" ? field.type : "string",
		required: field.required !== false,
		unique: field.unique === true,
	};
}

function expectedTables(config: ForgeConfig): TableShapes {
	const methods = resolveAuthMethods(config);
	const options: BetterAuthOptions = {
		emailAndPassword: { enabled: methods.includes("email-password") },
		plugins: [...methods, ...resolveAuthPlugins(config)].flatMap(
			(id): ReadonlyArray<BetterAuthPlugin> => upstreamPlugins[id],
		),
	};

	return Object.fromEntries(
		Object.values(getAuthTables(options))
			.filter((table) => table.disableMigrations !== true)
			.map((table) => [
				table.modelName,
				{
					id: primaryKey,
					...Object.fromEntries(
						Object.entries(table.fields).map(([key, field]) => [
							field.fieldName ?? key,
							upstreamColumn(field),
						]),
					),
				},
			]),
	);
}

function splitTopLevel(source: string): ReadonlyArray<string> {
	const entries: Array<string> = [];

	let depth = 0;
	let quote: string | undefined;
	let current = "";
	for (const character of source) {
		if (quote !== undefined) {
			if (character === quote) quote = undefined;
		} else if (character === '"' || character === "'" || character === "`")
			quote = character;
		else if ("([{".includes(character)) depth += 1;
		else if (")]}".includes(character)) depth -= 1;
		else if (character === "," && depth === 0) {
			entries.push(current.trim());
			current = "";
			continue;
		}

		current += character;
	}

	entries.push(current.trim());
	return entries.filter((entry) => entry.length > 0);
}

function balancedBody(source: string, open: number): string {
	let depth = 0;
	for (let index = open; index < source.length; index += 1) {
		if (source[index] === "{") depth += 1;
		if (source[index] === "}") depth -= 1;
		if (depth === 0) return source.slice(open + 1, index);
	}

	throw new Error(`Unbalanced Braces: ${source.slice(open, open + 80)}`);
}

const drizzleTypes: ReadonlyArray<readonly [RegExp, string]> = [
	[/^integer\(\{ mode: "boolean" \}\)/, "boolean"],
	[/^integer\(\{ mode: "timestamp_ms" \}\)/, "date"],
	[/^(text|varchar)\(/, "string"],
	[/^boolean\(/, "boolean"],
	[/^timestamp\(/, "date"],
	[/^(integer|int)\(/, "number"],
];

function drizzleColumn(definition: string): ColumnShape {
	const type = drizzleTypes.find(([pattern]) => pattern.test(definition))?.[1];
	if (type === undefined)
		throw new Error(`Unknown Drizzle Column: ${definition}`);

	const primary = definition.includes(".primaryKey()");
	return {
		type,
		required: primary || definition.includes(".notNull()"),
		unique: primary || definition.includes(".unique()"),
	};
}

function drizzleTables(plan: PlannedProject): TableShapes {
	const exports = new Map<string, Record<string, ColumnShape>>();
	const schemaFiles = plan.writes.filter(({ path }) =>
		path.startsWith("packages/db/src/schema/"),
	);

	for (const { content } of schemaFiles) {
		const source = content
			.split("\n")
			.filter((line) => !line.trim().startsWith("//"))
			.join("\n");

		for (const match of source.matchAll(
			/export const (\w+) = snakeCase\.table\(/g,
		)) {
			const body = balancedBody(source, source.indexOf("{", match.index));
			exports.set(
				match[1] ?? "",
				Object.fromEntries(
					splitTopLevel(body).map((entry) => {
						const separator = entry.indexOf(":");
						return [
							entry.slice(0, separator).trim(),
							drizzleColumn(entry.slice(separator + 1).trim()),
						];
					}),
				),
			);
		}
	}

	const server = plan.writes.find(
		({ path }) => path === "packages/auth/src/index.ts",
	);

	const adapter = /schema: \{([^}]*)\}/.exec(server?.content ?? "")?.[1];
	if (adapter === undefined) throw new Error("Missing Drizzle Adapter Schema");

	return Object.fromEntries(
		[...adapter.matchAll(/(\w+): (\w+),/g)].map(([, model, table]) => {
			const columns = exports.get(table ?? "");
			if (columns === undefined)
				throw new Error(`Missing Drizzle Table: ${table}`);

			return [model, columns];
		}),
	);
}

const prismaTypes: Readonly<Record<string, string>> = {
	String: "string",
	Boolean: "boolean",
	DateTime: "date",
	Int: "number",
};

function prismaTables(plan: PlannedProject): TableShapes {
	const schema = plan.writes.find(
		({ path }) => path === "packages/db/prisma/schema.prisma",
	);

	if (schema === undefined) throw new Error("Missing Prisma Schema");

	const models = [...schema.content.matchAll(/^model (\w+) \{([^}]*)\}/gm)];
	const modelNames = new Set(models.map(([, model]) => model));

	return Object.fromEntries(
		models.map(([, model = "", body = ""]) => {
			const columns = body.split("\n").flatMap((line) => {
				const field = /^\s+(\w+)\s+(\w+)(\?|\[\])?(.*)$/.exec(line);
				if (field === null || modelNames.has(field[2])) return [];

				const type = prismaTypes[field[2] ?? ""];
				if (type === undefined)
					throw new Error(`Unknown Prisma Field: ${line.trim()}`);

				const primary = field[4]?.includes("@id") === true;
				return [
					[
						field[1],
						{
							type,
							required: field[3] !== "?",
							unique: primary || field[4]?.includes("@unique") === true,
						},
					],
				];
			});

			return [
				`${model.charAt(0).toLowerCase()}${model.slice(1)}`,
				Object.fromEntries(columns),
			];
		}),
	);
}

const baseConfig: ForgeConfig = {
	authentication: "better-auth",
	backend: "self",
	name: "Acme",
	packageManager: "pnpm",
	platforms: ["web"],
	runtime: "Node.js",
	slug: "acme",
	web: "nextjs",
};

const stores: ReadonlyArray<{
	readonly name: string;
	readonly config: ForgeConfig;
}> = [
	{
		name: "Drizzle PostgreSQL",
		config: { orm: "drizzle", database: "postgresql" },
	},
	{ name: "Drizzle MySQL", config: { orm: "drizzle", database: "mysql" } },
	{
		name: "Drizzle PlanetScale",
		config: {
			orm: "drizzle",
			database: "mysql",
			databaseProvider: "planetscale",
		},
	},
	{ name: "Drizzle SQLite", config: { orm: "drizzle", database: "sqlite" } },
	{
		name: "Prisma PostgreSQL",
		config: { orm: "prisma", database: "postgresql" },
	},
	{ name: "Prisma MySQL", config: { orm: "prisma", database: "mysql" } },
	{
		name: "Prisma PlanetScale",
		config: {
			orm: "prisma",
			database: "mysql",
			databaseProvider: "planetscale",
		},
	},
	{ name: "Prisma SQLite", config: { orm: "prisma", database: "sqlite" } },
];

const emailSignIns: ReadonlyArray<AuthMethod> = ["email-otp", "magic-link"];

const selections: ReadonlyArray<{
	readonly name: string;
	readonly config: ForgeConfig;
}> = [
	{ name: "the default methods", config: {} },
	{
		name: "every plugin",
		config: {
			authMethods: authMethods.ids.filter(
				(method) => !emailSignIns.includes(method),
			),
			authPlugins: authPlugins.ids,
		},
	},
	{
		name: "every method",
		config: {
			authMethods: authMethods.ids,
			authPlugins: authPlugins.ids.filter((plugin) => plugin !== "two-factor"),
			emailProvider: "resend",
		},
	},
];

describe("generated auth schema", () => {
	it("defaults a self hosted Next.js project to Google and Apple", () => {
		expect(resolveAuthMethods(baseConfig)).toEqual(["google", "apple"]);
	});

	describe.each(stores)("$name", (store) => {
		it.each(selections)(
			"has every table and column Better Auth declares for $name",
			async (selection) => {
				const config = { ...baseConfig, ...store.config, ...selection.config };
				const plan = await plannedProject(config);
				const generated =
					config.orm === "drizzle" ? drizzleTables(plan) : prismaTables(plan);

				expect(generated).toEqual(expectedTables(config));
			},
		);
	});

	it.each(stores.filter(({ config }) => config.database === "mysql"))(
		"fits a 1023 byte passkey credential id on $name",
		async (store) => {
			const plan = await plannedProject({
				...baseConfig,
				...store.config,
				authMethods: ["passkey"],
			});

			const drizzle = plan.writes.find(
				({ path }) => path === "packages/db/src/schema/auth.ts",
			)?.content;

			const prisma = plan.writes.find(
				({ path }) => path === "packages/db/prisma/schema.prisma",
			)?.content;

			const storage =
				drizzle === undefined
					? {
							type: /credentialID String @map\("credential_id"\) @db\.(\w+)/
								.exec(prisma ?? "")?.[1]
								?.toLowerCase(),
							prefix: /@@index\(\[credentialID\(length: (\d+)\)\]\)/.exec(
								prisma ?? "",
							)?.[1],
						}
					: {
							type: /credentialID: (\w+)\(/.exec(drizzle)?.[1],
							prefix: /\.on\(sql`\$\{table\.credentialID\}\((\d+)\)`\)/.exec(
								drizzle,
							)?.[1],
						};

			expect(storage).toEqual({ type: "text", prefix: "191" });
		},
	);
});
