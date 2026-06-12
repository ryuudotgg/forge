import { beforeEach, describe, expect, it, vi } from "vitest";
import authenticationCustomUIStep from "../src/steps/auth/custom-ui";
import authenticationStep from "../src/steps/auth/provider";
import { type PartialConfig, SKIP } from "../src/steps/types";

const promptMocks = vi.hoisted(() => ({
	cancel: vi.fn(),
	confirm: vi.fn(),
	isCancel: vi.fn(),
	logWarn: vi.fn(),
	select: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
	cancel: promptMocks.cancel,
	confirm: promptMocks.confirm,
	isCancel: promptMocks.isCancel,
	log: { warn: promptMocks.logWarn },
	select: promptMocks.select,
}));

function rawConfig(values: { [key: string]: unknown }): PartialConfig {
	const config: PartialConfig = {};
	return Object.assign(config, values);
}

describe("authentication step", () => {
	beforeEach(() => {
		promptMocks.cancel.mockReset();
		promptMocks.confirm.mockReset();
		promptMocks.isCancel.mockReset();
		promptMocks.logWarn.mockReset();
		promptMocks.select.mockReset();
		promptMocks.isCancel.mockReturnValue(false);
	});

	it("only runs when an orm is selected", () => {
		expect(authenticationStep.shouldRun({})).toBe(false);
		expect(authenticationStep.shouldRun({ orm: "drizzle" })).toBe(true);
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
});
