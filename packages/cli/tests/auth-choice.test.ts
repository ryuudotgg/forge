import { defineAddon } from "@ryuugg/core";
import { type ForgeConfig, loadDefinitionRegistry } from "@ryuugg/generators";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAdd } from "../src/commands/add";
import { runRemove } from "../src/commands/remove";
import { managedProject } from "./lifecycle-fixtures";

const promptMocks = vi.hoisted(() => ({
	confirm: vi.fn(),
	intro: vi.fn(),
	logError: vi.fn(),
	logInfo: vi.fn(),
	logSuccess: vi.fn(),
	select: vi.fn(),
}));

const lifecycleMocks = vi.hoisted(() => ({
	applyInstalledPlan: vi.fn(),
	configuredPackageManager: vi.fn(),
	generatedRemovalPaths: vi.fn(),
	hasProjectDevDependency: vi.fn(),
	loadManagedProject: vi.fn(),
	loadProjectRegistry: vi.fn(),
	runPackageManagerOperation: vi.fn(),
}));

const interactive = vi.hoisted(() => vi.fn());

vi.mock("@clack/prompts", () => ({
	confirm: promptMocks.confirm,
	intro: promptMocks.intro,
	isCancel: () => false,
	log: {
		error: promptMocks.logError,
		info: promptMocks.logInfo,
		success: promptMocks.logSuccess,
		warn: vi.fn(),
	},
	multiselect: vi.fn(),
	select: promptMocks.select,
	spinner: vi.fn(),
	text: vi.fn(),
}));

vi.mock("../src/commands/lifecycle", () => lifecycleMocks);
vi.mock("../src/commands/interactive-resolution", () => ({
	isInteractiveLifecycleSession: interactive,
}));

const base: ForgeConfig = {
	authentication: "better-auth",
	authMethods: ["email-password"],
	database: "postgresql",
	orm: "drizzle",
	packageManager: "pnpm",
	slug: "acme",
	web: "nextjs",
};

beforeEach(() => {
	vi.resetAllMocks();
	vi.spyOn(process, "exit").mockImplementation((code) => {
		throw new Error(`exit:${code ?? 0}`);
	});

	interactive.mockReturnValue(false);
	lifecycleMocks.loadManagedProject.mockResolvedValue(
		managedProject({ config: base }),
	);

	lifecycleMocks.loadProjectRegistry.mockResolvedValue(
		loadDefinitionRegistry(),
	);

	lifecycleMocks.configuredPackageManager.mockImplementation(
		(config: ForgeConfig) => config.packageManager ?? "pnpm",
	);

	lifecycleMocks.applyInstalledPlan.mockResolvedValue({
		dependenciesChanged: false,
		dropped: [],
		retained: [],
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

interface RefusalCase {
	readonly direction: "add" | "remove";
	readonly id: string;
	readonly config: ForgeConfig;
	readonly message: string;
}

const refusals: ReadonlyArray<RefusalCase> = [
	{
		direction: "add",
		id: "two-factor",
		config: {
			...base,
			authMethods: ["email-password", "magic-link"],
			emailProvider: "resend",
		},
		message:
			"Two-factor doesn't work with Magic link, because that sign-in skips the second factor.",
	},
	{
		direction: "remove",
		id: "email-password",
		config: {
			...base,
			authMethods: ["email-password", "google"],
			authPlugins: ["two-factor"],
		},
		message: "Two-factor needs this sign-in method: Email and password.",
	},
	{
		direction: "remove",
		id: "email-password",
		config: base,
		message:
			"We can't remove Email and password because it's your only sign-in method.",
	},
	{
		direction: "remove",
		id: "google",
		config: { ...base, authMethods: ["google", "google"] },
		message: "We can't remove Google because it's your only sign-in method.",
	},
	{
		direction: "remove",
		id: "admin",
		config: base,
		message: "We couldn't find Admin in this project.",
	},
	{
		direction: "remove",
		id: "google",
		config: { slug: "acme", web: "nextjs" },
		message: "We couldn't find Google in this project.",
	},
	{
		direction: "add",
		id: "google",
		config: { slug: "acme", web: "nextjs" },
		message: "Authentication methods need Better Auth.",
	},
	{
		direction: "add",
		id: "admin",
		config: { slug: "acme", web: "nextjs" },
		message: "Authentication plugins need Better Auth.",
	},
	{
		direction: "add",
		id: "email-otp",
		config: base,
		message: "Email OTP and magic link need an email provider.",
	},
	{
		direction: "add",
		id: "google",
		config: { authentication: "better-auth", authMethods: ["email-password"] },
		message: "You need to add an ORM before you can use Better Auth.",
	},
	{
		direction: "remove",
		id: "google",
		config: { ...base, authMethods: ["google", "passkey"] },
		message: "Passkeys need another sign-in method to create accounts.",
	},
];

describe("auth choice lifecycle", () => {
	it.each(refusals)(
		"refuses $direction $id: $message",
		async ({ direction, id, config, message }) => {
			lifecycleMocks.loadManagedProject.mockResolvedValue(
				managedProject({ config }),
			);

			await expect(
				direction === "add" ? runAdd(id, {}) : runRemove(id, {}),
			).rejects.toThrow("exit:1");

			expect(promptMocks.logError).toHaveBeenCalledExactlyOnceWith(message);
			expect(process.exit).toHaveBeenCalledWith(1);
			expect(lifecycleMocks.applyInstalledPlan).not.toHaveBeenCalled();
		},
	);

	it.each(["add", "remove"])(
		"checks malformed current lists before %s resolves them",
		async (direction) => {
			lifecycleMocks.loadManagedProject.mockResolvedValue(
				managedProject({ config: { ...base, authMethods: [] } }),
			);

			await expect(
				direction === "add"
					? runAdd("google", {})
					: runRemove("email-password", {}),
			).rejects.toThrow("exit:1");

			expect(promptMocks.logError).toHaveBeenCalledWith(
				expect.stringContaining("Invalid Configuration:"),
			);

			expect(lifecycleMocks.applyInstalledPlan).not.toHaveBeenCalled();
		},
	);

	it.each(["google", "admin"])(
		"does not reapply an already configured choice: %s",
		async (id) => {
			lifecycleMocks.loadManagedProject.mockResolvedValue(
				managedProject({
					config: {
						...base,
						authMethods: ["google", "apple"],
						authPlugins: ["admin"],
					},
				}),
			);

			await runAdd(id, {});

			expect(promptMocks.logInfo).toHaveBeenCalledExactlyOnceWith(
				`${id === "google" ? "Google" : "Admin"} is already set up.`,
			);

			expect(lifecycleMocks.applyInstalledPlan).not.toHaveBeenCalled();
		},
	);

	it("adds a labelled method with unchanged installs, registries and resolution flags", async () => {
		const project = managedProject({
			config: base,
			registries: ["@acme/addons"],
			installs: [
				{ definitionId: "better-auth", targets: [{ kind: "project" }] },
			],
		});

		lifecycleMocks.loadManagedProject.mockResolvedValue(project);

		await runAdd("Google", { "keep-user": true });

		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledExactlyOnceWith(
			project.projectRoot,
			{ ...base, authMethods: ["email-password", "google"] },
			project.manifest.installs,
			undefined,
			project.manifest.registries,
			{ resolutionPolicy: "keep-user" },
		);

		expect(promptMocks.logSuccess).toHaveBeenCalledWith("We added Google.");
		expect(promptMocks.intro).not.toHaveBeenCalled();
	});

	it("removes a method and reports dependency changes and retained files", async () => {
		const project = managedProject({
			config: {
				...base,
				authMethods: ["email-password", "email-otp"],
				emailProvider: "resend",
			},
		});

		lifecycleMocks.loadManagedProject.mockResolvedValue(project);
		lifecycleMocks.applyInstalledPlan.mockResolvedValue({
			dependenciesChanged: true,
			dropped: [],
			retained: ["packages/email/src/templates/verification-code.tsx"],
		});

		await runRemove("Email OTP", { "accept-forge": true });

		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledExactlyOnceWith(
			project.projectRoot,
			{ ...base, emailProvider: "resend" },
			project.manifest.installs,
			undefined,
			project.manifest.registries,
			{ resolutionPolicy: "accept-forge" },
		);

		expect(promptMocks.logSuccess).toHaveBeenCalledWith(
			'We removed Email OTP. Run "pnpm install" to update your dependencies.',
		);

		expect(promptMocks.logInfo).toHaveBeenCalledExactlyOnceWith(
			"We kept your edited file at packages/email/src/templates/verification-code.tsx.",
		);
	});

	it("removes a plugin without writing an empty list", async () => {
		const project = managedProject({
			config: { ...base, authPlugins: ["admin"] },
		});

		lifecycleMocks.loadManagedProject.mockResolvedValue(project);

		await runRemove("admin", {});

		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledExactlyOnceWith(
			project.projectRoot,
			base,
			project.manifest.installs,
			undefined,
			project.manifest.registries,
		);

		expect(promptMocks.logSuccess).toHaveBeenCalledWith("We removed Admin.");
	});

	it("can remove the incompatible choice from a semantically invalid config", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({
				config: {
					...base,
					authMethods: ["email-password", "magic-link"],
					authPlugins: ["two-factor"],
					emailProvider: "resend",
				},
			}),
		);

		await runRemove("magic-link", {});

		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ ...base, authPlugins: ["two-factor"], emailProvider: "resend" },
			[],
			undefined,
			undefined,
		);
	});

	it.each([
		{
			orm: "drizzle",
			packageManager: "pnpm",
			command: '"pnpm --filter @acme/db run push" to update your database.',
		},
		{
			orm: "prisma",
			packageManager: "pnpm",
			command:
				'"pnpm --filter @acme/db run push" and then "pnpm --filter @acme/db run generate" to update your database and client.',
		},
		{
			orm: "prisma",
			packageManager: "npm",
			command:
				'"npm run push --prefix packages/db" and then "npm run generate --prefix packages/db" to update your database and client.',
		},
		{
			orm: "prisma",
			packageManager: "pnpm",
			database: "sqlite",
			databaseProvider: "turso",
			command:
				'"pnpm --filter @acme/db run migrate" to create a migration, apply it to Turso with "turso db shell <database-name> < packages/db/prisma/migrations/<migration>/migration.sql", and then run "pnpm --filter @acme/db run generate".',
		},
		{
			orm: "drizzle",
			packageManager: "pnpm",
			database: "sqlite",
			databaseProvider: "turso",
			command: '"pnpm --filter @acme/db run push" to update your database.',
		},
		{
			orm: "drizzle",
			packageManager: "Yarn",
			command: '"yarn workspace @acme/db push" to update your database.',
		},
		{
			orm: "drizzle",
			packageManager: "Bun",
			command: '"bun --filter @acme/db push" to update your database.',
		},
	] satisfies ReadonlyArray<{
		readonly orm: ForgeConfig["orm"];
		readonly packageManager: ForgeConfig["packageManager"];
		readonly database?: ForgeConfig["database"];
		readonly databaseProvider?: ForgeConfig["databaseProvider"];
		readonly command: string;
	}>)(
		"names the schema scripts for $orm $databaseProvider and $packageManager",
		async ({ command, ...choices }) => {
			const config: ForgeConfig = { ...base, ...choices };
			lifecycleMocks.loadManagedProject.mockResolvedValue(
				managedProject({ config }),
			);

			await runAdd("two-factor", {});

			expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
				".",
				{ ...config, authPlugins: ["two-factor"] },
				[],
				undefined,
				undefined,
			);

			expect(promptMocks.logInfo).toHaveBeenCalledExactlyOnceWith(
				`Two-factor changes your auth schema, so run ${command}`,
			);
		},
	);

	it("uses the ORM package name fallback when the slug is unset", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({
				config: {
					authentication: "better-auth",
					authMethods: ["email-password"],
					orm: "drizzle",
					web: "nextjs",
				},
			}),
		);

		await runAdd("two-factor", {});

		expect(promptMocks.logInfo).toHaveBeenCalledExactlyOnceWith(
			'Two-factor changes your auth schema, so run "pnpm --filter @my-app/db run push" to update your database.',
		);
	});

	it("keeps a colliding third party addon ahead of the auth plugin", async () => {
		const loaded = loadDefinitionRegistry();
		const addon = defineAddon<ForgeConfig>({
			id: "admin",
			name: "Third Party Admin",
			version: "1.0.0",
			category: "tooling",
			exclusive: false,
			targetMode: "single",
			when: () => false,
			contribute: () => [],
		});

		lifecycleMocks.loadProjectRegistry.mockResolvedValue({
			...loaded,
			registry: {
				...loaded.registry,
				addons: [...loaded.registry.addons, addon],
			},
		});

		const project = managedProject({
			config: { ...base, authPlugins: ["admin"] },
		});

		lifecycleMocks.loadManagedProject.mockResolvedValue(project);

		await runAdd("admin", {});

		expect(promptMocks.intro).toHaveBeenCalledWith('We\'re adding "admin"...');
		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			project.config,
			[{ definitionId: "admin", targets: [{ kind: "project" }] }],
			undefined,
			undefined,
		);

		lifecycleMocks.applyInstalledPlan.mockClear();
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({
				config: project.config,
				installs: [{ definitionId: "admin", targets: [{ kind: "project" }] }],
			}),
		);

		await runRemove("admin", {});

		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			project.config,
			[],
			undefined,
			undefined,
		);

		expect(promptMocks.logSuccess).toHaveBeenCalledWith(
			"We removed Third Party Admin.",
		);
	});

	it("keeps a colliding third party addon ahead of the auth plugin label", async () => {
		const loaded = loadDefinitionRegistry();
		const addon = defineAddon<ForgeConfig>({
			id: "admin",
			name: "Third Party Admin",
			version: "1.0.0",
			category: "tooling",
			exclusive: false,
			targetMode: "single",
			when: () => false,
			contribute: () => [],
		});

		lifecycleMocks.loadProjectRegistry.mockResolvedValue({
			...loaded,
			registry: {
				...loaded.registry,
				addons: [...loaded.registry.addons, addon],
			},
		});

		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({ config: base }),
		);

		const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
			throw new Error(`exit:${code ?? 0}`);
		});

		try {
			await expect(runAdd("Admin", {})).rejects.toThrow("exit:1");
			expect(promptMocks.intro).toHaveBeenCalledWith(
				'We\'re adding "Admin"...',
			);

			expect(lifecycleMocks.applyInstalledPlan).not.toHaveBeenCalled();
		} finally {
			exit.mockRestore();
		}
	});

	describe("a web app named after an active auth choice", () => {
		const config: ForgeConfig = {
			...base,
			authPlugins: ["admin"],
			webApps: [{ name: "admin", framework: "nextjs" }],
		};

		it("offers both and removes the Admin plugin when selected", async () => {
			interactive.mockReturnValue(true);
			promptMocks.select.mockResolvedValue("addon");
			const project = managedProject({ config, modules: [] });
			lifecycleMocks.loadManagedProject.mockResolvedValue(project);

			await runRemove("admin", {});

			expect(promptMocks.select).toHaveBeenCalledExactlyOnceWith({
				message: "Do you want to remove the admin web app or the Admin plugin?",
				initialValue: "app",
				options: [
					{ label: "The admin web app", value: "app" },
					{ label: "The Admin plugin", value: "addon" },
				],
			});

			expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledExactlyOnceWith(
				".",
				{ ...base, webApps: config.webApps },
				project.manifest.installs,
				undefined,
				undefined,
			);
		});

		it.each([{ yes: true }, {}])(
			"keeps the Admin plugin when removing the web app noninteractively: %j",
			async (values) => {
				const project = managedProject({ config, modules: [] });
				lifecycleMocks.loadManagedProject.mockResolvedValue(project);

				await runRemove("admin", values);

				expect(promptMocks.select).not.toHaveBeenCalled();
				expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
					".",
					{ ...base, authPlugins: ["admin"], webApps: [] },
					project.manifest.installs,
					undefined,
					undefined,
					{},
					{ modules: [], records: {}, removedRoots: [] },
				);

				expect(promptMocks.logInfo).toHaveBeenCalledWith(
					"The Admin plugin is still set up. Run forge remove admin again to remove it.",
				);
			},
		);

		it("labels a colliding sign-in method", async () => {
			interactive.mockReturnValue(true);
			promptMocks.select.mockResolvedValue("addon");
			lifecycleMocks.loadManagedProject.mockResolvedValue(
				managedProject({
					config: {
						...base,
						authMethods: ["email-password", "google"],
						webApps: [{ name: "google", framework: "nextjs" }],
					},
					modules: [],
				}),
			);

			await runRemove("google", {});

			expect(promptMocks.select).toHaveBeenCalledWith(
				expect.objectContaining({
					options: [
						{ label: "The google web app", value: "app" },
						{ label: "The Google sign-in method", value: "addon" },
					],
				}),
			);

			expect(promptMocks.logSuccess).toHaveBeenCalledWith("We removed Google.");
		});
	});
});
