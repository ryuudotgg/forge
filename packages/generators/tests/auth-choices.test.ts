import { describe, expect, it } from "vitest";
import {
	type AuthChoice,
	authChoice,
	authChoiceChangesSchema,
	authChoiceLabel,
	authMethods,
	authPlugins,
	configWithAuthChoice,
	type ForgeConfig,
	hasAuthChoice,
} from "../src";
import { plannedProject } from "./planner-harness";

const google: AuthChoice = { kind: "method", id: "google" };
const password: AuthChoice = { kind: "method", id: "email-password" };
const admin: AuthChoice = { kind: "plugin", id: "admin" };
const base: ForgeConfig = { authentication: "better-auth", web: "nextjs" };

describe("auth choices", () => {
	it.each(authMethods.ids)("resolves method %s by id and label", (id) => {
		const choice: AuthChoice = { kind: "method", id };
		expect(authChoice(id)).toEqual(choice);
		expect(authChoice(authMethods.label(id))).toEqual(choice);
		expect(authChoiceLabel(choice)).toBe(authMethods.label(id));
	});

	it.each(authPlugins.ids)("resolves plugin %s by id and label", (id) => {
		const choice: AuthChoice = { kind: "plugin", id };
		expect(authChoice(id)).toEqual(choice);
		expect(authChoice(authPlugins.label(id))).toEqual(choice);
		expect(authChoiceLabel(choice)).toBe(authPlugins.label(id));
	});

	it("ignores unknown ids", () => {
		expect(authChoice("email")).toBeUndefined();
	});

	it("reads method defaults and defaults plugins to none", () => {
		expect(hasAuthChoice(base, google)).toBe(true);
		expect(hasAuthChoice(base, password)).toBe(false);
		expect(hasAuthChoice({ ...base, mobile: "expo" }, password)).toBe(true);
		expect(hasAuthChoice(base, admin)).toBe(false);
	});

	it("ignores auth choices without Better Auth", () => {
		const config: ForgeConfig = {
			authMethods: ["google"],
			authPlugins: ["admin"],
		};

		expect(hasAuthChoice(config, google)).toBe(false);
		expect(hasAuthChoice(config, admin)).toBe(false);
	});

	it.each<{
		readonly invalid: Readonly<Record<string, unknown>>;
		readonly present: boolean;
	}>([
		{
			invalid: { authMethods: [], authPlugins: ["two-factor"] },
			present: false,
		},
		{
			invalid: {
				authMethods: ["invalid", "google"],
				authPlugins: ["invalid", "admin"],
			},
			present: true,
		},
		{ invalid: { authMethods: null, authPlugins: null }, present: false },
		{
			invalid: { authMethods: "google", authPlugins: "admin" },
			present: false,
		},
	])(
		"reads invalid lists without resolving or throwing: $invalid",
		({ invalid, present }) => {
			const config = { ...base, ...invalid };
			expect(hasAuthChoice(config, google)).toBe(present);
			expect(hasAuthChoice(config, admin)).toBe(present);
		},
	);

	it("reads raw lists even when plugin requirements are unmet", () => {
		const config: ForgeConfig = {
			...base,
			authMethods: ["magic-link"],
			authPlugins: ["two-factor"],
		};

		expect(hasAuthChoice(config, { kind: "method", id: "magic-link" })).toBe(
			true,
		);

		expect(hasAuthChoice(config, { kind: "plugin", id: "two-factor" })).toBe(
			true,
		);
	});

	it("materialises method defaults and changes only the method list", () => {
		const config: ForgeConfig = {
			...base,
			slug: "acme",
			authPlugins: ["admin"],
		};

		expect(configWithAuthChoice(config, password, true)).toEqual({
			...config,
			authMethods: ["email-password", "google", "apple"],
		});

		expect(configWithAuthChoice(config, google, false)).toEqual({
			...config,
			authMethods: ["apple"],
		});

		expect(config).not.toHaveProperty("authMethods");
	});

	it("writes canonical method order without duplicates", () => {
		const config: ForgeConfig = { ...base, authMethods: ["apple", "google"] };
		expect(configWithAuthChoice(config, password, true).authMethods).toEqual([
			"email-password",
			"google",
			"apple",
		]);

		expect(configWithAuthChoice(config, google, true).authMethods).toEqual([
			"google",
			"apple",
		]);
	});

	it("writes canonical plugin order without materialising methods", () => {
		const config: ForgeConfig = { ...base, authPlugins: ["polar", "admin"] };
		expect(
			configWithAuthChoice(config, { kind: "plugin", id: "username" }, true),
		).toEqual({
			...config,
			authPlugins: ["username", "admin", "polar"],
		});
	});

	it("drops empty plugins instead of writing an empty list", () => {
		expect(
			configWithAuthChoice({ ...base, authPlugins: ["admin"] }, admin, false),
		).toEqual(base);
	});

	it.each(authMethods.ids)(
		"knows whether method %s changes the schema",
		(id) => {
			expect(authChoiceChangesSchema({ kind: "method", id })).toBe(
				id === "passkey",
			);
		},
	);

	it.each(authPlugins.ids)(
		"knows whether plugin %s changes the schema",
		(id) => {
			expect(authChoiceChangesSchema({ kind: "plugin", id })).toBe(
				id !== "polar",
			);
		},
	);

	it.each(["drizzle", "prisma"] satisfies ReadonlyArray<ForgeConfig["orm"]>)(
		"generates a push script for %s",
		async (orm) => {
			const plan = await plannedProject({
				...base,
				slug: "acme",
				database: "postgresql",
				orm,
			});

			const write = plan.writes.find(
				(entry) => entry.path === "packages/db/package.json",
			);

			expect(write).toBeDefined();
			expect(write?.content).toContain('"push":');
			expect(write?.content).toContain('"generate":');
		},
	);
});
