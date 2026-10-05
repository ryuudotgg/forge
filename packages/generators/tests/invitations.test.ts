import { Script } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import type { ForgeConfig, WebFramework } from "../src/config";
import { plannedProject } from "./planner-harness";

type Plan = Awaited<ReturnType<typeof plannedProject>>;

function writeContent(plan: Plan, path: string): string {
	const write = plan.writes.find((entry) => entry.path === path);
	if (write === undefined) throw new Error(`Missing Write: ${path}`);
	return write.content;
}

function callSource(content: string, callee: string): string {
	const start = content.indexOf(`${callee}(`);
	if (start === -1) throw new Error(`Missing Call: ${callee}`);

	let depth = 0;
	for (let index = start + callee.length; index < content.length; index += 1) {
		if (content[index] === "(") depth += 1;
		if (content[index] === ")") depth -= 1;
		if (depth === 0) return content.slice(start, index + 1);
	}

	throw new Error(`Unbalanced Call: ${callee}`);
}

const baseConfig: ForgeConfig = {
	authentication: "better-auth",
	authMethods: ["email-password"],
	authPlugins: ["two-factor", "organization"],
	database: "sqlite",
	name: "Acme Works",
	orm: "drizzle",
	packageManager: "pnpm",
	platforms: ["web"],
	slug: "acme",
};

interface InvitationOptions {
	readonly organizationLimit: unknown;
	readonly invitationLimit: unknown;
	readonly organizationHooks?: unknown;
	readonly sendInvitationEmail: (data: unknown) => Promise<void>;
}

function isInvitationOptions(value: unknown): value is InvitationOptions {
	return (
		typeof value === "object" &&
		value !== null &&
		"sendInvitationEmail" in value &&
		typeof value.sendInvitationEmail === "function"
	);
}

class APIError extends Error {
	readonly status: string;

	constructor(status: string, body: { readonly message: string }) {
		super(body.message);
		this.status = status;
	}
}

function beforeCreateInvitation(
	options: InvitationOptions,
): (data: unknown) => Promise<unknown> {
	const hooks = options.organizationHooks;
	const hook: unknown =
		typeof hooks === "object" &&
		hooks !== null &&
		"beforeCreateInvitation" in hooks
			? hooks.beforeCreateInvitation
			: undefined;

	if (typeof hook !== "function")
		throw new Error("Missing Invitation Hook: generated server");

	return async (data) => hook(data);
}

function organizationOptions(
	server: string,
	env: Readonly<Record<string, string | undefined>>,
) {
	const sendEmail = vi.fn(async (_message: unknown) => undefined);
	const log = { info: vi.fn(), log: vi.fn(), warn: vi.fn() };
	const options: unknown = new Script(
		callSource(server, "organization"),
	).runInNewContext({
		APIError,
		URL,
		console: log,
		env,
		organization: (value: unknown) => value,
		sendEmail,
	});

	if (!isInvitationOptions(options))
		throw new Error("Invalid Organization Options: generated server");

	return { log, options, sendEmail };
}

const invitation = {
	id: "inv_123",
	email: "invitee@example.com",
	role: "member",
	organization: { name: "Lumen Works" },
	inviter: { user: { name: "Ada Inviter", email: "ada@example.com" } },
};

describe("generated invitations", () => {
	it.each([
		{ backend: "hono", web: "nextjs", base: "env.WEB_URL" },
		{ backend: "express", web: "tanstack-router", base: "env.WEB_URL" },
		{ backend: "self", web: "nextjs", base: "env.APP_ORIGIN" },
	] as const)(
		"names the inviter and links $backend invitations to the web app",
		async ({ backend, web, base }) => {
			const plan = await plannedProject({
				...baseConfig,
				backend,
				web,
				emailProvider: "resend",
			});

			const server = writeContent(plan, "packages/auth/src/index.ts");

			expect(server).toContain(
				"async sendInvitationEmail({ id, email, organization, inviter })",
			);

			expect(server).toContain(
				`new URL(\`/accept-invitation/\${id}\`, ${base})`,
			);

			const origin = "https://app.example.com/";
			const { options, sendEmail } = organizationOptions(server, {
				NODE_ENV: "production",
				WEB_URL: origin,
				APP_ORIGIN: origin,
			});

			expect(options.organizationLimit).toBe(5);
			expect(options.invitationLimit).toBe(20);

			await options.sendInvitationEmail(invitation);
			expect(sendEmail).toHaveBeenCalledTimes(1);

			const message = sendEmail.mock.calls[0]?.[0];
			expect(message).toMatchObject({ to: "invitee@example.com" });
			expect(JSON.stringify(message)).toContain(
				"Ada Inviter (ada@example.com)",
			);

			expect(JSON.stringify(message)).toContain("Lumen Works");
			expect(message).toMatchObject({
				text: expect.stringMatching(
					/open the link below to accept the invitation\.\n\nhttps:\/\/app\.example\.com\/accept-invitation\/inv_123$/,
				),
			});
		},
	);

	it.each(["production", "test", undefined])(
		"logs no invitee details without a provider under NODE_ENV %s",
		async (nodeEnv) => {
			const plan = await plannedProject({
				...baseConfig,
				backend: "self",
				web: "nextjs",
			});

			const { log, options } = organizationOptions(
				writeContent(plan, "packages/auth/src/index.ts"),
				{ NODE_ENV: nodeEnv, APP_ORIGIN: "https://app.example.com" },
			);

			await options.sendInvitationEmail(invitation);

			expect(log.info).not.toHaveBeenCalled();
			expect(log.log).not.toHaveBeenCalled();
			expect(log.warn).toHaveBeenCalledTimes(1);

			const warning = JSON.stringify(log.warn.mock.calls);
			for (const detail of ["invitee@example.com", "inv_123", "Lumen Works"])
				expect(warning).not.toContain(detail);
		},
	);

	it.each(["production", "test", undefined])(
		"refuses invitations without a provider under NODE_ENV %s",
		async (nodeEnv) => {
			const plan = await plannedProject({
				...baseConfig,
				backend: "self",
				web: "nextjs",
			});

			const server = writeContent(plan, "packages/auth/src/index.ts");
			expect(server).toContain('import { APIError } from "better-auth/api";');
			expect(server).toContain('if (env.NODE_ENV === "development") return;');

			const { options } = organizationOptions(server, {
				NODE_ENV: nodeEnv,
				APP_ORIGIN: "https://app.example.com",
			});

			const refusal = beforeCreateInvitation(options)({
				invitation: { email: "invitee@example.com", role: "member" },
			});

			await expect(refusal).rejects.toBeInstanceOf(APIError);
			await expect(refusal).rejects.toMatchObject({
				status: "BAD_REQUEST",
				message:
					"Invitations need an email provider, so this project can't send them yet.",
			});
		},
	);

	it("creates invitations without a provider in development", async () => {
		const plan = await plannedProject({
			...baseConfig,
			backend: "self",
			web: "nextjs",
		});

		const { options } = organizationOptions(
			writeContent(plan, "packages/auth/src/index.ts"),
			{ NODE_ENV: "development", APP_ORIGIN: "http://localhost:3000" },
		);

		await expect(
			beforeCreateInvitation(options)({
				invitation: { email: "invitee@example.com", role: "member" },
			}),
		).resolves.toBeUndefined();
	});

	it("leaves invitations alone when an email provider delivers them", async () => {
		const plan = await plannedProject({
			...baseConfig,
			backend: "self",
			web: "nextjs",
			emailProvider: "resend",
		});

		const server = writeContent(plan, "packages/auth/src/index.ts");
		expect(server).not.toContain("organizationHooks");
		expect(server).not.toContain("better-auth/api");

		const { options } = organizationOptions(server, {
			NODE_ENV: "production",
			APP_ORIGIN: "https://app.example.com",
		});

		expect(options.organizationHooks).toBeUndefined();
	});

	it("logs the accept link without a provider in development", async () => {
		const plan = await plannedProject({
			...baseConfig,
			backend: "self",
			web: "nextjs",
		});

		const { log, options } = organizationOptions(
			writeContent(plan, "packages/auth/src/index.ts"),
			{ NODE_ENV: "development", APP_ORIGIN: "http://localhost:3000" },
		);

		await options.sendInvitationEmail(invitation);

		expect(log.warn).not.toHaveBeenCalled();
		expect(JSON.stringify(log.info.mock.calls)).toContain(
			"http://localhost:3000/accept-invitation/inv_123",
		);
	});

	it("keeps the invitation id when no web app hosts the accept page", async () => {
		const plan = await plannedProject({
			...baseConfig,
			backend: "hono",
			emailProvider: "postmark",
		});

		const { options, sendEmail } = organizationOptions(
			writeContent(plan, "packages/auth/src/index.ts"),
			{ NODE_ENV: "production" },
		);

		await options.sendInvitationEmail(invitation);
		expect(JSON.stringify(sendEmail.mock.calls[0]?.[0])).toContain("inv_123");
		expect(JSON.stringify(sendEmail.mock.calls[0]?.[0])).toContain(
			"Ada Inviter (ada@example.com)",
		);
	});

	it.each(["hono", "express", "fastify", "self"] as const)(
		"names the project in authenticator entries on %s",
		async (backend) => {
			const plan = await plannedProject({
				...baseConfig,
				backend,
				web: "nextjs",
			});

			expect(writeContent(plan, "packages/auth/src/index.ts")).toContain(
				'appName: "Acme Works",',
			);
		},
	);
});

const pages: ReadonlyArray<{
	readonly web: WebFramework;
	readonly backend: "self" | "hono";
	readonly path: string;
}> = [
	{
		web: "nextjs",
		backend: "self",
		path: "apps/web/app/accept-invitation/[id]/page.tsx",
	},
	{
		web: "nextjs",
		backend: "hono",
		path: "apps/web/app/accept-invitation/[id]/page.tsx",
	},
	{
		web: "react-router",
		backend: "self",
		path: "apps/web/app/routes/accept-invitation.tsx",
	},
	{
		web: "tanstack-start",
		backend: "self",
		path: "apps/web/src/routes/accept-invitation.$id.tsx",
	},
	{
		web: "tanstack-router",
		backend: "hono",
		path: "apps/web/src/routes/accept-invitation.$id.tsx",
	},
];

describe("accept invitation page", () => {
	it.each(pages)(
		"serves $path for a $web primary on $backend",
		async ({ web, backend, path }) => {
			const plan = await plannedProject({ ...baseConfig, backend, web });
			const page = writeContent(plan, path);

			expect(page).toContain('import { authClient } from "@acme/auth/client";');
			expect(page).toContain("authClient.organization.acceptInvitation({");
			expect(page).toContain("authClient.getSession().then(");
			expect(page).toContain(
				"Sign in with the invited email address, then open this link again.",
			);

			expect(page).toContain("We couldn't check your session.");
			expect(page).not.toContain("useSession");
			expect(page).not.toMatch(/__[A-Z_]+__/);

			expect(writeContent(plan, "apps/web/package.json")).toContain(
				'"@acme/auth": "workspace:*"',
			);

			if (web === "react-router") {
				const routes = writeContent(plan, "apps/web/app/routes.ts");
				expect(routes).toContain(
					'route("accept-invitation/:id", "routes/accept-invitation.tsx")',
				);

				expect(routes).toContain("index, type RouteConfig, route }");
			}
		},
	);

	it("adds the page and route only with the organization plugin", async () => {
		const plan = await plannedProject({
			...baseConfig,
			authPlugins: ["two-factor"],
			backend: "self",
			web: "react-router",
		});

		expect(
			plan.writes.some((write) => write.path.includes("accept-invitation")),
		).toBe(false);

		expect(writeContent(plan, "apps/web/app/routes.ts")).not.toContain(
			"accept-invitation",
		);
	});

	it("leaves a standalone primary without the auth package when no page needs it", async () => {
		const plan = await plannedProject({
			...baseConfig,
			authPlugins: ["two-factor"],
			backend: "hono",
			web: "tanstack-router",
		});

		expect(writeContent(plan, "apps/web/package.json")).not.toContain(
			'"@acme/auth"',
		);
	});
});
