import { authPlugins } from "@ryuugg/generators";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { orchestrate } from "../src/orchestrator";
import { defaultPreset } from "../src/presets/default";
import authenticationCustomUIStep from "../src/steps/auth/custom-ui";
import authMethodsStep, {
	createAuthMethodsStep,
} from "../src/steps/auth/methods";
import authPluginsStep from "../src/steps/auth/plugins";
import authenticationStep from "../src/steps/auth/provider";
import { type PartialConfig, SKIP, type Step } from "../src/steps/types";

const promptMocks = vi.hoisted(() => ({
	cancel: vi.fn(),
	confirm: vi.fn(),
	isCancel: vi.fn(),
	logWarn: vi.fn(),
	multiselect: vi.fn(),
	select: vi.fn(),
}));

const cancelMocks = vi.hoisted(() => ({
	cancel: vi.fn((): never => {
		throw new Error("Cancelled");
	}),
}));

vi.mock("@clack/prompts", () => ({
	cancel: promptMocks.cancel,
	confirm: promptMocks.confirm,
	isCancel: promptMocks.isCancel,
	log: { warn: promptMocks.logWarn },
	multiselect: promptMocks.multiselect,
	select: promptMocks.select,
}));

vi.mock("../src/utils/cancel", () => ({ cancel: cancelMocks.cancel }));

function rawConfig(values: { [key: string]: unknown }): PartialConfig {
	const config: PartialConfig = {};
	return Object.assign(config, values);
}

describe("auth methods step", () => {
	beforeEach(() => {
		promptMocks.multiselect.mockReset();
		promptMocks.isCancel.mockReset();
		promptMocks.logWarn.mockReset();
		cancelMocks.cancel.mockClear();
		promptMocks.isCancel.mockReturnValue(false);
	});

	it("runs only for Better Auth", () => {
		expect(authMethodsStep.shouldRun({ authentication: "better-auth" })).toBe(
			true,
		);

		for (const authentication of ["authjs", "workos", "clerk", undefined])
			expect(authMethodsStep.shouldRun(rawConfig({ authentication }))).toBe(
				false,
			);

		expect(authMethodsStep).toMatchObject({
			id: "authMethods",
			configKey: "authMethods",
			group: "auth",
			dependencies: ["authentication"],
		});
	});

	it("omits email methods during adoption", async () => {
		promptMocks.multiselect.mockResolvedValue(["google"]);

		await expect(
			createAuthMethodsStep({ email: false }).execute({}, true),
		).resolves.toEqual(["google"]);

		expect(promptMocks.multiselect).toHaveBeenCalledWith(
			expect.objectContaining({
				options: [
					{ label: "Email and password", value: "email-password" },
					{ label: "Google", value: "google" },
					{ label: "Apple", value: "apple" },
					{ label: "Passkey", value: "passkey" },
				],
			}),
		);
	});

	it.each(["email-otp", "magic-link"])(
		"rejects %s in adoption config",
		async (method) => {
			await expect(
				orchestrate([createAuthMethodsStep({ email: false })], {
					interactive: false,
					initialConfig: rawConfig({
						authentication: "better-auth",
						authMethods: [method],
						emailProvider: "resend",
					}),
				}),
			).rejects.toThrow("aren't supported when adopting a project");
		},
	);

	it("returns the selection and requires at least one method", async () => {
		promptMocks.multiselect.mockResolvedValue(["email-password", "google"]);

		await expect(authMethodsStep.execute({}, true)).resolves.toEqual([
			"email-password",
			"google",
		]);

		expect(promptMocks.multiselect).toHaveBeenCalledWith({
			message: "How should people sign in?",
			required: true,
			initialValues: ["google", "apple"],
			options: [
				{ label: "Email and password", value: "email-password" },
				{ label: "Google", value: "google" },
				{ label: "Apple", value: "apple" },
				{ label: "Passkey", value: "passkey" },
				{ label: "Email OTP", value: "email-otp" },
				{ label: "Magic link", value: "magic-link" },
			],
		});
	});

	it.each([
		{ backend: "hono" },
		{ backend: "self", web: "nextjs", mobile: "expo" },
	])(
		"defaults to passwords for standalone and Expo configs %j",
		async (config) => {
			promptMocks.multiselect.mockResolvedValue(["google"]);

			await authMethodsStep.execute(rawConfig(config), true);

			expect(promptMocks.multiselect).toHaveBeenCalledWith(
				expect.objectContaining({
					initialValues: ["email-password", "google", "apple"],
				}),
			);
		},
	);

	it("defaults to social methods for a self-hosted web app", async () => {
		promptMocks.multiselect.mockResolvedValue(["apple"]);

		await authMethodsStep.execute({ backend: "self", web: "nextjs" }, true);

		expect(promptMocks.multiselect).toHaveBeenCalledWith(
			expect.objectContaining({
				initialValues: ["google", "apple"],
			}),
		);
	});

	it.each([[], ["unknown"]].map((selection) => ({ selection })))(
		"warns and retries an invalid selection $selection",
		async ({ selection }) => {
			promptMocks.multiselect
				.mockResolvedValueOnce(selection)
				.mockResolvedValueOnce(["apple"]);

			await expect(authMethodsStep.execute({}, true)).resolves.toEqual([
				"apple",
			]);

			expect(promptMocks.logWarn).toHaveBeenCalledWith(
				"Choose at least one supported sign-in method.",
			);

			expect(promptMocks.multiselect).toHaveBeenCalledTimes(2);
		},
	);

	it("cancels when interrupted", async () => {
		promptMocks.multiselect.mockResolvedValue(Symbol("cancel"));
		promptMocks.isCancel.mockReturnValueOnce(true);

		await expect(authMethodsStep.execute({}, true)).rejects.toThrow(
			"Cancelled",
		);

		expect(cancelMocks.cancel).toHaveBeenCalledTimes(1);
	});

	it("skips non-interactively without a value", async () => {
		await expect(authMethodsStep.execute({}, false)).resolves.toBe(SKIP);
		expect(promptMocks.multiselect).not.toHaveBeenCalled();
	});

	it("leaves the default preset on the legacy methods non-interactively", async () => {
		const result = await orchestrate([authenticationStep, authMethodsStep], {
			initialConfig: defaultPreset,
			interactive: false,
		});

		expect(result.authMethods).toBeUndefined();
		expect(promptMocks.multiselect).not.toHaveBeenCalled();
	});

	it("rejects a preconfigured empty list at config decoding", async () => {
		await expect(
			orchestrate([authenticationStep, authMethodsStep], {
				initialConfig: rawConfig({ ...defaultPreset, authMethods: [] }),
				interactive: false,
			}),
		).rejects.toThrow("Invalid Configuration:");

		expect(promptMocks.multiselect).not.toHaveBeenCalled();
	});
});

describe("auth plugins step", () => {
	beforeEach(() => {
		promptMocks.multiselect.mockReset();
		promptMocks.isCancel.mockReset();
		promptMocks.logWarn.mockReset();
		cancelMocks.cancel.mockClear();
		promptMocks.isCancel.mockReturnValue(false);
	});

	it("runs only for Better Auth", () => {
		expect(authPluginsStep.shouldRun({ authentication: "better-auth" })).toBe(
			true,
		);

		for (const authentication of ["authjs", "workos", "clerk", undefined])
			expect(authPluginsStep.shouldRun(rawConfig({ authentication }))).toBe(
				false,
			);

		expect(authPluginsStep).toMatchObject({
			id: "authPlugins",
			configKey: "authPlugins",
			group: "auth",
			dependencies: ["authentication", "authMethods"],
		});
	});

	it("returns the optional selection", async () => {
		promptMocks.multiselect.mockResolvedValue(["username", "admin"]);

		await expect(
			authPluginsStep.execute(
				{
					authentication: "better-auth",
					authMethods: ["email-password"],
				},
				true,
			),
		).resolves.toEqual(["username", "admin"]);

		expect(promptMocks.multiselect).toHaveBeenCalledWith({
			message: "Which Better Auth plugins do you want?",
			required: false,
			initialValues: [],
			options: [
				{ label: "Two-factor", value: "two-factor" },
				{ label: "Username", value: "username" },
				{ label: "Admin", value: "admin" },
				{ label: "Organization", value: "organization" },
				{ label: "Polar", value: "polar" },
			],
		});
	});

	it("accepts both new plugins with passwords", async () => {
		promptMocks.multiselect.mockResolvedValue(["two-factor", "organization"]);

		await expect(
			authPluginsStep.execute(
				{ authentication: "better-auth", authMethods: ["email-password"] },
				true,
			),
		).resolves.toEqual(["two-factor", "organization"]);

		expect(promptMocks.logWarn).not.toHaveBeenCalled();
	});

	it("removes two-factor without passwords and retains organization", async () => {
		promptMocks.multiselect
			.mockResolvedValueOnce(["two-factor", "organization"])
			.mockResolvedValueOnce(["organization"]);

		await expect(
			authPluginsStep.execute(
				{ authentication: "better-auth", authMethods: ["google"] },
				true,
			),
		).resolves.toEqual(["organization"]);

		expect(promptMocks.logWarn).toHaveBeenCalledWith(
			"Two-factor needs this sign-in method: Email and password.",
		);

		expect(promptMocks.multiselect).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ initialValues: ["organization"] }),
		);
	});

	it("cancels after rejecting two-factor without passwords", async () => {
		promptMocks.multiselect
			.mockResolvedValueOnce(["two-factor"])
			.mockResolvedValueOnce(Symbol("cancel"));

		promptMocks.isCancel.mockReturnValueOnce(false).mockReturnValueOnce(true);

		await expect(
			authPluginsStep.execute(
				{ authentication: "better-auth", authMethods: ["google"] },
				true,
			),
		).rejects.toThrow("Cancelled");

		expect(cancelMocks.cancel).toHaveBeenCalledTimes(1);
	});

	it("accepts Polar without a sign-in method", async () => {
		promptMocks.multiselect.mockResolvedValue(["polar"]);

		await expect(
			authPluginsStep.execute({ authentication: "better-auth" }, true),
		).resolves.toEqual(["polar"]);

		expect(promptMocks.logWarn).not.toHaveBeenCalled();
	});

	it("skips an empty selection", async () => {
		promptMocks.multiselect.mockResolvedValue([]);
		await expect(authPluginsStep.execute({}, true)).resolves.toBe(SKIP);
		expect(promptMocks.logWarn).not.toHaveBeenCalled();
	});

	it("skips non-interactively", async () => {
		await expect(authPluginsStep.execute({}, false)).resolves.toBe(SKIP);
		expect(promptMocks.multiselect).not.toHaveBeenCalled();
	});

	it("cancels when interrupted", async () => {
		promptMocks.multiselect.mockResolvedValue(Symbol("cancel"));
		promptMocks.isCancel.mockReturnValueOnce(true);

		await expect(authPluginsStep.execute({}, true)).rejects.toThrow(
			"Cancelled",
		);

		expect(cancelMocks.cancel).toHaveBeenCalledTimes(1);
	});

	it("warns and removes plugins with unmet requirements before retrying", async () => {
		promptMocks.multiselect
			.mockResolvedValueOnce(["username", "admin"])
			.mockResolvedValueOnce(["admin"]);

		await expect(
			authPluginsStep.execute(
				{
					authentication: "better-auth",
					authMethods: ["google", "apple"],
				},
				true,
			),
		).resolves.toEqual(["admin"]);

		expect(promptMocks.logWarn).toHaveBeenCalledWith(
			"Username needs this sign-in method: Email and password.",
		);

		expect(promptMocks.multiselect).toHaveBeenCalledTimes(2);
		expect(promptMocks.multiselect).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ initialValues: ["admin"] }),
		);
	});

	it("warns and drops unsupported plugins before retrying", async () => {
		const available = vi
			.spyOn(authPlugins, "available")
			.mockImplementation((plugin) => plugin !== "admin");

		promptMocks.multiselect
			.mockResolvedValueOnce(["username", "admin"])
			.mockResolvedValueOnce(["username"]);

		try {
			await expect(
				authPluginsStep.execute(
					{
						authentication: "better-auth",
						authMethods: ["email-password"],
					},
					true,
				),
			).resolves.toEqual(["username"]);

			expect(promptMocks.logWarn).toHaveBeenCalledWith(
				"Choose only the plugins we support today.",
			);

			expect(promptMocks.multiselect).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining({ initialValues: ["username"] }),
			);
		} finally {
			available.mockRestore();
		}
	});
});

describe("authentication step", () => {
	beforeEach(() => {
		promptMocks.cancel.mockReset();
		promptMocks.confirm.mockReset();
		promptMocks.isCancel.mockReset();
		promptMocks.logWarn.mockReset();
		promptMocks.select.mockReset();

		promptMocks.isCancel.mockReturnValue(false);
	});

	it("only runs when an orm and API host are selected", () => {
		expect(authenticationStep.shouldRun({})).toBe(false);
		expect(authenticationStep.shouldRun({ orm: "drizzle" })).toBe(false);
		expect(
			authenticationStep.shouldRun({
				backend: "self",
				orm: "drizzle",
				web: "nextjs",
			}),
		).toBe(true);
	});

	it("requires a backend for web frameworks without self-host support", () => {
		expect(
			authenticationStep.shouldRun({ orm: "drizzle", web: "tanstack-router" }),
		).toBe(false);

		expect(
			authenticationStep.shouldRun({
				backend: "self",
				orm: "drizzle",
				web: "tanstack-router",
			}),
		).toBe(false);

		expect(
			authenticationStep.shouldRun({
				backend: "hono",
				orm: "drizzle",
				web: "tanstack-router",
			}),
		).toBe(true);
	});

	it("still runs when a self-hosting web framework has no backend", () => {
		for (const web of ["nextjs", "react-router", "tanstack-start"] as const)
			expect(authenticationStep.shouldRun({ orm: "drizzle", web })).toBe(true);
	});

	it("validates pre-supplied auth before generation", async () => {
		const generate = vi.fn(async () => undefined);
		const generateStep: Step = {
			configKey: null,
			execute: generate,
			group: "generate",
			id: "generate",
			schema: null,
			shouldRun: () => true,
		};

		const initialConfig = {
			authentication: "better-auth" as const,
			backend: "self" as const,
			orm: "drizzle" as const,
			web: "tanstack-router" as const,
		};

		expect(authenticationStep.shouldRun(initialConfig)).toBe(true);
		await expect(
			orchestrate([authenticationStep, generateStep], {
				initialConfig,
				interactive: false,
			}),
		).rejects.toThrow(
			"Better Auth needs a backend. TanStack Router can't host it; add a backend framework.",
		);

		expect(generate).not.toHaveBeenCalled();
	});

	it("accepts a canonical provider id without prompting", async () => {
		await expect(
			authenticationStep.execute({ authentication: "better-auth" }, false),
		).resolves.toBe("better-auth");

		expect(promptMocks.select).not.toHaveBeenCalled();
	});

	it("normalizes display-name aliases in non-interactive mode", async () => {
		await expect(
			authenticationStep.execute(
				rawConfig({ authentication: "Better Auth" }),
				false,
			),
		).resolves.toBe("better-auth");
	});

	it("skips unavailable providers in non-interactive mode", async () => {
		await expect(
			authenticationStep.execute(rawConfig({ authentication: "Clerk" }), false),
		).resolves.toBe(SKIP);
	});

	it("skips when the configured provider is unknown", async () => {
		await expect(
			authenticationStep.execute(
				rawConfig({ authentication: "passport" }),
				false,
			),
		).resolves.toBe(SKIP);
	});

	it("returns the selected provider", async () => {
		promptMocks.select.mockResolvedValue("better-auth");

		await expect(authenticationStep.execute({}, true)).resolves.toBe(
			"better-auth",
		);

		expect(promptMocks.select).toHaveBeenCalledWith({
			message: "What is your preferred way to handle authentication?",
			options: [
				{ label: "Better Auth", value: "better-auth" },
				{ label: "Auth.js", value: "authjs", hint: "coming soon" },
				{ label: "WorkOS", value: "workos", hint: "coming soon" },
				{ label: "Clerk", value: "clerk", hint: "coming soon" },
				{ label: "None", value: "none" },
			],
		});
	});

	it("explains and re-prompts when an unavailable provider is selected", async () => {
		promptMocks.select
			.mockResolvedValueOnce("workos")
			.mockResolvedValueOnce("better-auth");

		await expect(authenticationStep.execute({}, true)).resolves.toBe(
			"better-auth",
		);

		expect(promptMocks.logWarn).toHaveBeenCalledWith(
			"We don't support WorkOS yet.",
		);

		expect(promptMocks.select).toHaveBeenCalledTimes(2);
	});

	it("skips when none is selected", async () => {
		promptMocks.select.mockResolvedValue("none");
		await expect(authenticationStep.execute({}, true)).resolves.toBe(SKIP);
	});
});

describe("authenticationCustomUI step", () => {
	beforeEach(() => {
		promptMocks.cancel.mockReset();
		promptMocks.confirm.mockReset();
		promptMocks.isCancel.mockReset();
		promptMocks.logWarn.mockReset();
		promptMocks.select.mockReset();

		promptMocks.isCancel.mockReturnValue(false);
		cancelMocks.cancel.mockClear();
	});

	it("only runs for providers with a hosted UI", () => {
		expect(
			authenticationCustomUIStep.shouldRun({ authentication: "workos" }),
		).toBe(true);

		expect(
			authenticationCustomUIStep.shouldRun({ authentication: "clerk" }),
		).toBe(true);

		expect(
			authenticationCustomUIStep.shouldRun({ authentication: "better-auth" }),
		).toBe(false);

		expect(authenticationCustomUIStep.shouldRun({})).toBe(false);
	});

	it("passes through a configured false without prompting", async () => {
		await expect(
			authenticationCustomUIStep.execute(
				{ authenticationCustomUI: false },
				false,
			),
		).resolves.toBe(false);

		expect(promptMocks.confirm).not.toHaveBeenCalled();
	});

	it("skips non-interactively when nothing is configured", async () => {
		await expect(authenticationCustomUIStep.execute({}, false)).resolves.toBe(
			SKIP,
		);
	});

	it("confirms with the provider label in the message", async () => {
		promptMocks.confirm.mockResolvedValue(true);

		await expect(
			authenticationCustomUIStep.execute({ authentication: "workos" }, true),
		).resolves.toBe(true);

		expect(promptMocks.confirm).toHaveBeenCalledWith({
			message: "Do you want a custom UI for WorkOS?",
			active: "Yes",
			inactive: "No",
		});
	});

	it("cancels the custom-UI prompt when interrupted", async () => {
		promptMocks.confirm.mockResolvedValue(Symbol("cancel"));
		promptMocks.isCancel.mockReturnValueOnce(true);

		await expect(
			authenticationCustomUIStep.execute({ authentication: "clerk" }, true),
		).rejects.toThrow("Cancelled");

		expect(cancelMocks.cancel).toHaveBeenCalledTimes(1);
	});
});
