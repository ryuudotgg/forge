import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Contribution } from "@ryuujs/core";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EmailProvider, ForgeConfig } from "../src/config";
import email, { emailMetadata } from "../src/email";
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
			expect(source).toContain('env.NODE_ENV === "production"');
			expect(source).toContain("html?: string");
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
	subject: string;
	text: string;
	html?: string;
}

const message: EmailMessage = {
	to: "reader@example.com",
	subject: "Hello",
	text: "Welcome",
	html: "<p>Welcome</p>",
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
	await mkdir(join(directory, "src"));
	await writeFile(envPath, "export const env = {};\n");
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
	const rendered: { sendEmail: (message: EmailMessage) => Promise<void> } =
		await import(sourcePath);

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

	it("rejects an unconfigured production email without constructing a client", async () => {
		const rendered = await renderedEmail(provider, { NODE_ENV: "production" });

		await expect(rendered.sendEmail(message)).rejects.toThrow(
			`Email isn't configured. Set EMAIL_FROM and ${provider.key}.`,
		);
		expect(rendered.construct).not.toHaveBeenCalled();
	});

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
						To: message.to,
						Subject: message.subject,
						TextBody: message.text,
						HtmlBody: message.html,
					}
				: { from: "sender@example.com", ...message },
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
