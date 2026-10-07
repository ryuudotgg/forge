import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Manifest, ManifestSchema } from "@ryuugg/core";
import * as generators from "@ryuugg/generators";
import { Effect, Schema } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runUpdate, UpdateCommand } from "../src/commands/update";
import generateStep from "../src/steps/generate";
import type { PartialConfig } from "../src/steps/types";
import { withTempDir } from "./lifecycle-fixtures";

const promptMocks = vi.hoisted(() => ({
	intro: vi.fn(),
	logError: vi.fn(),
	logInfo: vi.fn(),
	logWarn: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
	intro: promptMocks.intro,
	log: {
		error: promptMocks.logError,
		info: promptMocks.logInfo,
		warn: promptMocks.logWarn,
	},
}));

const defaultConfig: PartialConfig = {
	name: "Acme",
	slug: "acme",
	web: "nextjs",
	packageManager: "pnpm",
	runtime: "Node.js",
};

const authConfig: PartialConfig = {
	...defaultConfig,
	authentication: "better-auth",
	orm: "drizzle",
	database: "postgresql",
};

const validCases: { readonly name: string; readonly config: PartialConfig }[] =
	[
		{ name: "default", config: defaultConfig },
		{
			name: "Better Auth with passkey and plugins",
			config: {
				...authConfig,
				authMethods: ["email-password", "passkey"],
				authPlugins: ["two-factor", "username", "admin", "organization"],
			},
		},
	];

interface RefusalCase {
	readonly name: string;
	readonly config: Manifest["config"];
	readonly sentence: string;
}

const refusalCases: RefusalCase[] = [
	{
		name: "email OTP without an email provider",
		config: { authMethods: ["email-otp"] },
		sentence: "Email OTP and magic link need an email provider.",
	},
	{
		name: "magic link without an email provider",
		config: { authMethods: ["magic-link"] },
		sentence: "Email OTP and magic link need an email provider.",
	},
	{
		name: "two-factor without email and password",
		config: { authMethods: ["google"], authPlugins: ["two-factor"] },
		sentence: "Two-factor needs this sign-in method: Email and password.",
	},
	{
		name: "two-factor with magic link",
		config: {
			authMethods: ["email-password", "magic-link"],
			authPlugins: ["two-factor"],
			emailProvider: "resend",
		},
		sentence:
			"Two-factor doesn't work with Magic link, because that sign-in skips the second factor.",
	},
	{
		name: "passkey alone",
		config: { authMethods: ["passkey"] },
		sentence: "Passkeys need another sign-in method to create accounts.",
	},
	{
		name: "passkey without a web app",
		config: { authMethods: ["email-password", "passkey"], web: undefined },
		sentence: "Passkeys need a web app.",
	},
	{
		name: "secondary app on the API port",
		config: {
			backend: "hono",
			webApps: [{ name: "admin", framework: "nextjs", port: 3001 }],
		},
		sentence: "admin can't use port 3001, which the API server uses.",
	},
	{
		name: "secondary app on the primary web port",
		config: {
			webApps: [{ name: "admin", framework: "nextjs", port: 3000 }],
		},
		sentence: "web and admin both use port 3000.",
	},
	{
		name: "Better Auth without an ORM",
		config: { orm: undefined },
		sentence: "You need to add an ORM before you can use Better Auth.",
	},
	{
		name: "auth methods without Better Auth",
		config: { authentication: undefined, authMethods: ["email-password"] },
		sentence: "Authentication methods need Better Auth.",
	},
	{
		name: "secondary apps without a web framework",
		config: {
			web: undefined,
			webApps: [{ name: "admin", framework: "nextjs", port: 3002 }],
		},
		sentence: "Secondary web apps need a web framework.",
	},
];

async function snapshotProject(directory: string, relative = "") {
	const files: Record<string, string> = {};
	const entries = await readdir(join(directory, relative), {
		withFileTypes: true,
	});

	for (const entry of entries) {
		if (entry.name === "node_modules") continue;

		const path = join(relative, entry.name);
		if (entry.isDirectory())
			Object.assign(files, await snapshotProject(directory, path));
		else files[path] = await readFile(join(directory, path), "utf-8");
	}

	return files;
}

async function withGeneratedProject(
	config: PartialConfig,
	run: (directory: string) => Promise<void>,
) {
	await withTempDir("update-config", async (directory) => {
		await generateStep.execute({ ...config, path: directory }, false);

		const previousDirectory = process.cwd();
		try {
			process.chdir(directory);
			await run(directory);
		} finally {
			process.chdir(previousDirectory);
		}
	});
}

describe("update manifest config checks", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(generators, "probeWorkspaceCommandVersions").mockReturnValue(
			Effect.succeed({ node: "22.11.0", npm: "11.0.0", pnpm: "10.12.1" }),
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it.each(validCases)(
		"leaves a fresh $name project byte identical",
		async ({ config }) => {
			await withGeneratedProject(config, async (directory) => {
				const before = await snapshotProject(directory);
				const exit = vi.spyOn(process, "exit").mockImplementation(() => {
					throw new Error("Unexpected update refusal");
				});

				await runUpdate({}, UpdateCommand.Default);

				expect(exit).not.toHaveBeenCalled();
				expect(promptMocks.logError).not.toHaveBeenCalled();
				expect(await snapshotProject(directory)).toEqual(before);
			});
		},
		120_000,
	);

	it.each(refusalCases)(
		"refuses $name without writes",
		async (testCase) => {
			await withGeneratedProject(authConfig, async (directory) => {
				const manifestPath = join(directory, ".forge/manifest.json");
				const manifest = Schema.decodeUnknownSync(ManifestSchema)(
					JSON.parse(await readFile(manifestPath, "utf-8")),
				);

				await writeFile(
					manifestPath,
					`${JSON.stringify({ ...manifest, config: { ...manifest.config, ...testCase.config } }, null, "\t")}\n`,
				);

				const before = await snapshotProject(directory);
				const exit = vi.spyOn(process, "exit").mockImplementation(() => {
					throw new Error("Update refused");
				});

				await expect(runUpdate({}, UpdateCommand.Default)).rejects.toThrow(
					"Update refused",
				);

				expect(promptMocks.logError.mock.calls).toEqual([[testCase.sentence]]);
				expect(exit.mock.calls).toEqual([[1]]);
				expect(await snapshotProject(directory)).toEqual(before);
			});
		},
		120_000,
	);
});
