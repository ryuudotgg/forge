import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Contribution } from "@ryuugg/core";
import { Effect, Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EmailProvider, ForgeConfig } from "../src/config";
import email, { emailMetadata } from "../src/email";
import { emailPreviewPort } from "../src/origins";
import { readTemplate } from "../src/template";
import { versions } from "../src/versions";
import { plannedDefinitionIds, plannedProject } from "./planner-harness";

const providers: ReadonlyArray<{
	id: EmailProvider;
	dependency: "resend" | "postmark" | "nodemailer";
	key: string;
	call: string;
}> = [
	{
		id: "resend",
		dependency: "resend",
		key: "RESEND_API_KEY",
		call: "new Resend(env.RESEND_API_KEY).emails.send",
	},
	{
		id: "postmark",
		dependency: "postmark",
		key: "POSTMARK_SERVER_TOKEN",
		call: "new ServerClient(env.POSTMARK_SERVER_TOKEN).sendEmail",
	},
	{
		id: "smtp",
		dependency: "nodemailer",
		key: "SMTP_URL",
		call: "transport ??= createTransport(env.SMTP_URL)",
	},
];

function contributionsOf(config: ForgeConfig): ReadonlyArray<Contribution> {
	const result = email.contribute({
		commandVersions: {},
		config,
		frameworks: [],
	});

	if (Effect.isEffect(result) || result instanceof Promise)
		throw new Error("Unexpected Contribution Shape: email");

	return result;
}

function leafFile(contributions: ReadonlyArray<Contribution>, path: string) {
	const file = contributions.find(
		(contribution) =>
			contribution._tag === "LeafTextFileContribution" &&
			contribution.path === path,
	);

	if (file?._tag !== "LeafTextFileContribution")
		throw new Error(`Missing Leaf File: ${path}`);

	return file.content;
}

describe("email addon", () => {
	it.each(providers)(
		"contributes the $id package and environment",
		(provider) => {
			const contributions = contributionsOf({
				emailProvider: provider.id,
				slug: "acme",
			});

			expect(email.when({ emailProvider: provider.id })).toBe(true);
			expect(contributions).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						_tag: "EnsureModuleContribution",
						moduleKey: "email",
						root: "packages/email",
					}),
					expect.objectContaining({
						_tag: "ManagedJsonSurfaceContribution",
						surface: "packageJson",
						value: expect.objectContaining({
							name: "@acme/email",
							exports: { ".": "./src/index.ts", "./env": "./env.ts" },
						}),
					}),
					expect.objectContaining({
						_tag: "ManagedDependenciesSurfaceContribution",
						surface: "packageJson",
						target: { _tag: "EnsuredModuleTarget", moduleKey: "email" },
						dependencies: expect.arrayContaining([
							{
								name: provider.dependency,
								version: versions[provider.dependency].version,
								catalog: "",
								type: "dependencies",
							},
						]),
					}),
				]),
			);

			for (const surface of ["rootEnv", "rootEnvExample"])
				expect(contributions).toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							_tag: "ManagedLinesSurfaceContribution",
							surface,
							section: "Email",
							lines: ['EMAIL_FROM=""', `${provider.key}=""`],
						}),
					]),
				);

			const env = leafFile(contributions, "env.ts");
			expect(env).toContain("EMAIL_FROM: z.string().trim().min(1).optional()");
			expect(env).toContain(
				`${provider.key}: z.string().trim().min(1).optional()`,
			);

			expect(env).toContain(`${provider.key}: process.env.${provider.key}`);
			expect(env).not.toMatch(/__[A-Z_]+__/);

			const source = leafFile(contributions, "src/index.ts");
			expect(source).toContain(provider.call);
			expect(source).toContain(
				`Email isn't configured. Set EMAIL_FROM and ${provider.key}.`,
			);

			expect(source).toContain('env.NODE_ENV === "development" ||');
			expect(source).toContain("if (!canSendEmail())");
			expect(source).toContain("await renderMessage(message)");

			if (provider.id === "resend")
				expect(source).toContain("throw new Error(error.message)");

			if (provider.id === "smtp")
				expect(source).toContain("await transport.sendMail");
		},
	);

	it.each(providers)("plans the $id email module", async (provider) => {
		const plan = await plannedProject({
			emailProvider: provider.id,
			packageManager: "pnpm",
			slug: "acme",
		});

		const packageJson = plan.writes.find(
			(write) => write.path === "packages/email/package.json",
		);

		expect(packageJson?.content).toContain(
			`"${provider.dependency}": "catalog:"`,
		);

		expect(
			plan.writes.find((write) => write.path === ".env.example")?.content,
		).toContain(`${provider.key}=""`);
	});

	it("contributes nothing without a provider", async () => {
		expect(emailMetadata.hidden).toBe(true);
		expect(email.when({})).toBe(false);
		expect(contributionsOf({})).toEqual([]);
		expect(await plannedDefinitionIds({})).not.toContain("email");
		const plan = await plannedProject({});

		expect(
			plan.writes.some((write) => write.path.startsWith("packages/email/")),
		).toBe(false);
	});

	it("leaves a full auth project's env files free of email entries", async () => {
		const plan = await plannedProject({
			authentication: "better-auth",
			backend: "self",
			database: "postgresql",
			orm: "drizzle",
			packageManager: "pnpm",
			platforms: ["web"],
			slug: "acme",
			web: "nextjs",
		});

		for (const path of [".env", ".env.example"])
			expect(
				plan.writes.find((write) => write.path === path)?.content,
			).not.toContain("EMAIL_FROM");
	});
});

interface EmailMessage {
	to: string;
	template: string;
	props: Record<string, string>;
}

const message: EmailMessage = {
	to: "reader@example.com",
	template: "verificationCode",
	props: { code: "123456" },
};

const rendering = {
	to: "reader@example.com",
	subject: "Hello",
	html: "<p>Welcome</p>",
	text: "Welcome",
};

const directories: string[] = [];
const envPaths: string[] = [];

afterEach(async () => {
	vi.restoreAllMocks();
	vi.resetModules();
	for (const provider of providers) vi.doUnmock(provider.dependency);
	for (const path of envPaths.splice(0)) vi.doUnmock(path);
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

async function renderedEmail(
	provider: (typeof providers)[number],
	environment: Record<string, string | undefined>,
) {
	vi.resetModules();

	const directory = await mkdtemp(join(tmpdir(), "forge-email-"));
	directories.push(directory);
	const envPath = join(directory, "env.ts");
	envPaths.push(envPath);

	const sourcePath = join(directory, "src/index.ts");
	const messagesPath = join(directory, "src/messages.ts");
	envPaths.push(messagesPath);

	await mkdir(join(directory, "src"));
	await writeFile(envPath, "export const env = {};\n");
	await writeFile(messagesPath, "export {};\n");
	await writeFile(
		sourcePath,
		leafFile(contributionsOf({ emailProvider: provider.id }), "src/index.ts"),
	);

	const send = vi.fn(
		async (
			_payload: unknown,
		): Promise<{ error: { message: string } | null }> => ({ error: null }),
	);

	const construct = vi.fn((_key: string) => ({
		emails: { send },
		sendEmail: send,
		sendMail: send,
	}));

	class Client {
		readonly emails = { send };
		readonly sendEmail = send;

		constructor(key: string) {
			construct(key);
		}
	}

	vi.doMock(provider.dependency, () => ({
		Resend: Client,
		ServerClient: Client,
		createTransport: construct,
	}));

	vi.doMock(envPath, () => ({ env: environment }));
	vi.doMock(messagesPath, () => ({
		renderMessage: async () => rendering,
	}));

	const rendered: {
		canSendEmail: () => boolean;
		sendEmail: (message: EmailMessage) => Promise<void>;
	} = await import(sourcePath);

	return { ...rendered, construct, send };
}

describe.each(providers)("generated $id sendEmail", (provider) => {
	it("logs an unconfigured development email without constructing a client", async () => {
		const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
		const rendered = await renderedEmail(provider, { NODE_ENV: "development" });

		await expect(rendered.sendEmail(message)).resolves.toBeUndefined();
		expect(info).toHaveBeenCalledWith(
			"Email to reader@example.com: Hello\n\nWelcome",
		);

		expect(rendered.construct).not.toHaveBeenCalled();
		expect(rendered.send).not.toHaveBeenCalled();
	});

	it.each(["production", "test", undefined])(
		"rejects an unconfigured email under NODE_ENV %s without logging it",
		async (nodeEnv) => {
			const info = vi
				.spyOn(console, "info")
				.mockImplementation(() => undefined);

			const rendered = await renderedEmail(provider, { NODE_ENV: nodeEnv });

			await expect(rendered.sendEmail(message)).rejects.toThrow(
				`Email isn't configured. Set EMAIL_FROM and ${provider.key}.`,
			);

			expect(info).not.toHaveBeenCalled();
			expect(rendered.construct).not.toHaveBeenCalled();
		},
	);

	it.each(["EMAIL_FROM", "key"])(
		"rejects when %s is missing",
		async (missing) => {
			const rendered = await renderedEmail(provider, {
				NODE_ENV: "production",
				EMAIL_FROM: missing === "EMAIL_FROM" ? undefined : "sender@example.com",
				[provider.key]: missing === "key" ? undefined : "configured-key",
			});

			await expect(rendered.sendEmail(message)).rejects.toThrow(
				"Email isn't configured.",
			);

			expect(rendered.construct).not.toHaveBeenCalled();
		},
	);

	it.each([
		{ environment: { NODE_ENV: "development" }, expected: true },
		{ environment: { NODE_ENV: "production" }, expected: false },
		{ environment: { NODE_ENV: undefined }, expected: false },
		{
			environment: { NODE_ENV: "production", EMAIL_FROM: "sender@example.com" },
			expected: false,
		},
		{
			environment: {
				NODE_ENV: "production",
				EMAIL_FROM: "sender@example.com",
				[provider.key]: "configured-key",
			},
			expected: true,
		},
	])(
		"answers whether email can be sent under $environment",
		async ({ environment, expected }) => {
			const rendered = await renderedEmail(provider, environment);
			expect(rendered.canSendEmail()).toBe(expected);
		},
	);

	it("sends configured messages and reuses the SMTP transport", async () => {
		const rendered = await renderedEmail(provider, {
			NODE_ENV: "production",
			EMAIL_FROM: "sender@example.com",
			[provider.key]: "configured-key",
		});

		expect(rendered.construct).not.toHaveBeenCalled();
		await rendered.sendEmail(message);
		expect(rendered.construct).toHaveBeenCalledWith("configured-key");
		expect(rendered.send).toHaveBeenCalledWith(
			provider.id === "postmark"
				? {
						From: "sender@example.com",
						To: rendering.to,
						Subject: rendering.subject,
						TextBody: rendering.text,
						HtmlBody: rendering.html,
					}
				: { from: "sender@example.com", ...rendering },
		);

		await rendered.sendEmail(message);
		expect(rendered.construct).toHaveBeenCalledTimes(
			provider.id === "smtp" ? 1 : 2,
		);
	});
});

it("uses the provider templates verbatim", () => {
	for (const provider of providers)
		expect(
			leafFile(contributionsOf({ emailProvider: provider.id }), "src/index.ts"),
		).toBe(readTemplate(`email/packages/email/src/index.${provider.id}.ts`));
});

it("rejects when Resend reports an error", async () => {
	const resend = providers.find((provider) => provider.id === "resend");
	if (resend === undefined) throw new Error("Missing Provider: resend");

	const rendered = await renderedEmail(resend, {
		NODE_ENV: "production",
		EMAIL_FROM: "sender@example.com",
		RESEND_API_KEY: "configured-key",
	});

	rendered.send.mockResolvedValueOnce({
		error: { message: "Domain not verified" },
	});

	await expect(rendered.sendEmail(message)).rejects.toThrow(
		"Domain not verified",
	);
});

interface RenderedMessages {
	renderMessage: (
		message: EmailMessage,
	) => Promise<{ subject: string; html: string; text: string }>;
}

async function writeRenderSources(config: ForgeConfig) {
	const directory = await mkdtemp(join(import.meta.dirname, ".rendered-"));
	directories.push(directory);

	const sources = contributionsOf(config).flatMap((contribution) =>
		contribution._tag === "LeafTextFileContribution" &&
		typeof contribution.path === "string" &&
		/^src\/(messages\.ts|custom\.ts|layout\.tsx|templates\/)/.test(
			contribution.path,
		)
			? [{ path: contribution.path, content: contribution.content }]
			: [],
	);

	await mkdir(join(directory, "src/templates"), { recursive: true });

	for (const source of sources)
		await writeFile(join(directory, source.path), source.content);

	return directory;
}

const allMessages: ForgeConfig = {
	authentication: "better-auth",
	authMethods: ["email-otp", "magic-link"],
	authPlugins: ["organization"],
	emailProvider: "resend",
	slug: "acme",
};

function templatePaths(config: ForgeConfig) {
	return contributionsOf(config)
		.flatMap((contribution) =>
			contribution._tag === "LeafTextFileContribution" &&
			typeof contribution.path === "string"
				? [contribution.path]
				: [],
		)
		.filter((path) => path.startsWith("src/templates/"));
}

describe("email templates", () => {
	it.each(providers)(
		"plans React Email runtime imports for $id",
		async (provider) => {
			const config: ForgeConfig = {
				...allMessages,
				emailProvider: provider.id,
				backend: "self",
				database: "postgresql",
				orm: "drizzle",
				packageManager: "pnpm",
				platforms: ["web"],
				web: "nextjs",
			};

			const plan = await plannedProject(config);
			for (const write of plan.writes)
				expect(write.content, write.path).not.toContain(
					"@react-email/components",
				);

			const sourcePaths = [
				"packages/email/src/messages.ts",
				"packages/email/src/layout.tsx",
				...templatePaths(config).map((path) => `packages/email/${path}`),
			];

			for (const path of sourcePaths)
				expect(
					plan.writes.find((write) => write.path === path)?.content,
					path,
				).toContain('from "react-email"');

			const packageFile = plan.writes.find(
				(write) => write.path === "packages/email/package.json",
			);

			if (packageFile === undefined)
				throw new Error("Missing Planned File: packages/email/package.json");

			const packageJson = Schema.decodeSync(
				Schema.fromJsonString(
					Schema.Struct({
						dependencies: Schema.Record(Schema.String, Schema.String),
					}),
				),
			)(packageFile.content);

			expect(packageJson.dependencies["react-email"]).toBe("catalog:");

			const contributions = contributionsOf(config);
			expect(contributions).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						dependencies: expect.arrayContaining([
							expect.objectContaining({
								name: "react-email",
								version: versions.reactEmail.version,
								type: "dependencies",
							}),
						]),
					}),
				]),
			);

			for (const path of [
				"src/layout.tsx",
				...templatePaths(config),
				"src/custom.ts",
			]) {
				const file = contributions.find(
					(contribution) =>
						contribution._tag === "LeafTextFileContribution" &&
						contribution.path === path,
				);

				if (file?._tag !== "LeafTextFileContribution")
					throw new Error(`Missing Leaf File: ${path}`);

				expect(file.preserveExisting, path).toBe(
					path === "src/custom.ts" ? true : undefined,
				);

				expect(file.generated, path).toBeUndefined();
			}
		},
	);

	it.each([{ addons: [] }, { addons: ["vitest"] }] satisfies ReadonlyArray<
		Pick<ForgeConfig, "addons">
	>)(
		"plans preview tooling independently of addons $addons",
		async ({ addons }) => {
			const plan = await plannedProject({
				...allMessages,
				addons,
				backend: "self",
				database: "postgresql",
				orm: "drizzle",
				packageManager: "pnpm",
				platforms: ["web"],
				web: "nextjs",
			});

			const packageFile = plan.writes.find(
				(write) => write.path === "packages/email/package.json",
			);

			if (packageFile === undefined)
				throw new Error("Missing Planned File: packages/email/package.json");

			const packageJson = Schema.decodeSync(
				Schema.fromJsonString(
					Schema.Struct({
						scripts: Schema.Struct({ dev: Schema.String }),
						devDependencies: Schema.Record(Schema.String, Schema.String),
						dependencies: Schema.Record(Schema.String, Schema.String),
					}),
				),
			)(packageFile.content);

			expect(packageJson.scripts.dev).toBe(
				`email dev --dir src/templates --port ${emailPreviewPort}`,
			);

			for (const { dependency, type, absentType } of [
				{
					dependency: versions.reactEmail,
					type: "dependencies",
					absentType: "devDependencies",
				},
				{
					dependency: versions.reactEmailUi,
					type: "devDependencies",
					absentType: "dependencies",
				},
			] satisfies ReadonlyArray<{
				dependency: { name: string; version: string };
				type: "dependencies" | "devDependencies";
				absentType: "dependencies" | "devDependencies";
			}>) {
				expect(packageJson[type][dependency.name]).toBe("catalog:");
				expect(packageJson[absentType]).not.toHaveProperty(dependency.name);
				expect(contributionsOf({ ...allMessages, addons })).toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							dependencies: expect.arrayContaining([
								{
									name: dependency.name,
									version: dependency.version,
									catalog: "",
									type,
								},
							]),
						}),
					]),
				);
			}
		},
	);

	it("omits preview tooling without email auth templates", () => {
		const contributions = contributionsOf({
			emailProvider: "resend",
			authentication: "better-auth",
			authMethods: ["email-password"],
		});

		expect(
			contributions.filter(
				(contribution) =>
					contribution._tag === "ManagedScriptsSurfaceContribution",
			),
		).toEqual([]);

		expect(contributions).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					dependencies: expect.arrayContaining([
						expect.objectContaining({ name: "@react-email/ui" }),
					]),
				}),
			]),
		);
	});

	it.each([
		{ config: { emailProvider: "postmark" }, templates: [] },
		{
			config: {
				authentication: "better-auth",
				authMethods: ["email-password", "email-otp"],
				emailProvider: "smtp",
			},
			templates: ["src/templates/verification-code.tsx"],
		},
		{
			config: allMessages,
			templates: [
				"src/templates/invitation.tsx",
				"src/templates/magic-link.tsx",
				"src/templates/verification-code.tsx",
			],
		},
	] satisfies ReadonlyArray<{ config: ForgeConfig; templates: string[] }>)(
		"contributes one template per enabled message",
		({ config, templates }) => {
			expect(templatePaths(config)).toEqual(templates);
			expect(leafFile(contributionsOf(config), "src/messages.ts")).not.toMatch(
				/__[A-Z_]+__/,
			);
		},
	);

	it("keeps every email body inside the email package", async () => {
		const plan = await plannedProject({
			...allMessages,
			backend: "self",
			database: "postgresql",
			orm: "drizzle",
			packageManager: "pnpm",
			platforms: ["web"],
			web: "nextjs",
		});

		expect(
			plan.writes
				.map((write) => write.path)
				.filter((path) => path.startsWith("packages/email/src/templates/")),
		).toEqual([
			"packages/email/src/templates/invitation.tsx",
			"packages/email/src/templates/magic-link.tsx",
			"packages/email/src/templates/verification-code.tsx",
		]);

		for (const write of plan.writes.filter((write) =>
			write.path.startsWith("packages/email/src/templates/"),
		))
			expect(write.content, write.path).toContain(".PreviewProps =");

		const auth = plan.writes.find(
			(write) => write.path === "packages/auth/src/index.ts",
		)?.content;

		expect(auth).toContain('template: "invitation"');
		expect(auth).toContain('template: "magicLink"');
		expect(auth).toContain('template: "verificationCode"');

		for (const write of plan.writes)
			if (!write.path.startsWith("packages/email/"))
				expect(write.content, write.path).not.toMatch(/\b(subject|text):\s/);
	});

	it("renders every template to inlined html and plain text", async () => {
		const directory = await writeRenderSources(allMessages);
		const messages: RenderedMessages = await import(
			join(directory, "src/messages.ts")
		);

		const cases: ReadonlyArray<{
			message: EmailMessage;
			subject: string;
			expected: string;
		}> = [
			{
				message: {
					to: "reader@example.com",
					template: "verificationCode",
					props: { code: "123456", type: "forget-password" },
				},
				subject: "Your password reset code",
				expected: "123456",
			},
			{
				message: {
					to: "reader@example.com",
					template: "magicLink",
					props: { url: "https://app.example.com/verify?token=abc" },
				},
				subject: "Your sign in link",
				expected: "https://app.example.com/verify?token=abc",
			},
			{
				message: {
					to: "invitee@example.com",
					template: "invitation",
					props: {
						email: "invitee@example.com",
						inviterName: "Ada Inviter",
						inviterEmail: "ada@example.com",
						organizationName: "Lumen Works",
						invitationId: "inv_123",
					},
				},
				subject: "Ada Inviter invited you to Lumen Works",
				expected: "inv_123",
			},
		];

		for (const { message, subject, expected } of cases) {
			const rendered = await messages.renderMessage(message);

			expect(rendered.subject).toBe(subject);
			expect(rendered.html).toContain("font-weight:600");
			expect(rendered.html).not.toContain("class=");
			expect(rendered.html).not.toMatch(/<link|<img|@import/);
			expect(rendered.text).toContain(expected);
		}
	}, 30_000);

	it("sends a project's own template registered outside the managed files", async () => {
		const directory = await writeRenderSources({ emailProvider: "resend" });
		await writeFile(
			join(directory, "src/templates/welcome.tsx"),
			[
				"/** @jsxRuntime automatic */",
				'import { Text } from "react-email";',
				'import { Layout } from "../layout";',
				"",
				'export const subject = () => "Welcome";',
				"",
				"export default function Welcome({ name }: { name: string }) {",
				'  return <Layout preview="Welcome"><Text className="font-semibold">Hi {name}</Text></Layout>;',
				"}",
				"",
			].join("\n"),
		);

		await writeFile(
			join(directory, "src/custom.ts"),
			'import * as welcome from "./templates/welcome";\nexport const customTemplates = { welcome };\n',
		);

		const messages: RenderedMessages = await import(
			join(directory, "src/messages.ts")
		);

		const rendered = await messages.renderMessage({
			to: "reader@example.com",
			template: "welcome",
			props: { name: "Ada" },
		});

		expect(rendered.subject).toBe("Welcome");
		expect(rendered.text).toContain("Hi Ada");
		expect(rendered.html).not.toContain("class=");
	}, 30_000);

	it("tests each template against the mocked provider with Vitest", () => {
		const withVitest: ForgeConfig = {
			...allMessages,
			addons: ["vitest"],
			web: "nextjs",
		};

		const source = leafFile(contributionsOf(withVitest), "src/index.test.ts");

		expect(source).toContain('vi.mock("resend"');
		expect(source).toContain('RESEND_API_KEY: "test-key"');

		for (const template of ["invitation", "magicLink", "verificationCode"])
			expect(source).toContain(`template: "${template}"`);

		expect(source).not.toMatch(/__[A-Z_]+__/);
		expect(templatePaths(allMessages)).toHaveLength(3);
		expect(() =>
			leafFile(contributionsOf(allMessages), "src/index.test.ts"),
		).toThrow("Missing Leaf File");
	});
});
