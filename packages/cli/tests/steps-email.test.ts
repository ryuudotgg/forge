import { beforeEach, describe, expect, it, vi } from "vitest";
import { steps } from "../src/steps";
import emailProviderStep from "../src/steps/email/provider";
import { type PartialConfig, SKIP } from "../src/steps/types";

const promptMocks = vi.hoisted(() => ({ isCancel: vi.fn(), select: vi.fn() }));
const cancelMocks = vi.hoisted(() => ({
	cancel: vi.fn((): never => {
		throw new Error("Cancelled");
	}),
}));

vi.mock("@clack/prompts", () => ({ ...promptMocks }));
vi.mock("../src/utils/cancel", () => ({ cancel: cancelMocks.cancel }));

function rawConfig(values: Record<string, unknown>): PartialConfig {
	const config: PartialConfig = {};
	return Object.assign(config, values);
}

describe("email provider step", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		promptMocks.isCancel.mockReturnValue(false);
	});

	it("runs for an API host, worker, or preset provider", () => {
		expect(emailProviderStep.shouldRun({})).toBe(false);
		expect(emailProviderStep.shouldRun({ web: "tanstack-router" })).toBe(false);

		expect(emailProviderStep.shouldRun({ web: "nextjs" })).toBe(true);
		expect(emailProviderStep.shouldRun({ backend: "hono" })).toBe(true);

		expect(emailProviderStep.shouldRun({ addons: ["worker"] })).toBe(true);
		expect(emailProviderStep.shouldRun({ addons: ["shared"] })).toBe(false);

		expect(emailProviderStep.shouldRun({ emailProvider: "resend" })).toBe(true);
	});

	it("follows addon selection before the summary", () => {
		const index = steps.findIndex((step) => step.id === "emailProvider");

		expect(steps[index - 1]?.id).toBe("addons");
		expect(steps[index + 1]?.id).toBe("summary");
		expect(emailProviderStep.group).toBe("backend");
	});

	it.each(["resend", "postmark", "smtp"])(
		"accepts %s without prompting",
		async (id) => {
			await expect(
				emailProviderStep.execute(rawConfig({ emailProvider: id }), false),
			).resolves.toBe(id);

			expect(promptMocks.select).not.toHaveBeenCalled();
		},
	);

	it.each([
		["Resend", "resend"],
		["Postmark", "postmark"],
		["SMTP", "smtp"],
	])("normalizes %s", async (alias, id) => {
		await expect(
			emailProviderStep.execute(rawConfig({ emailProvider: alias }), false),
		).resolves.toBe(id);
	});

	it("skips unknown and unset providers", async () => {
		await expect(
			emailProviderStep.execute(rawConfig({ emailProvider: "unknown" }), false),
		).resolves.toBe(SKIP);

		await expect(emailProviderStep.execute({}, false)).resolves.toBe(SKIP);
	});

	it("offers the providers and None", async () => {
		promptMocks.select.mockResolvedValue("resend");

		await expect(emailProviderStep.execute({}, true)).resolves.toBe("resend");
		expect(promptMocks.select).toHaveBeenCalledWith({
			message: "Which email provider would you like to use?",
			options: [
				{ label: "Resend", value: "resend" },
				{ label: "Postmark", value: "postmark" },
				{ label: "SMTP", value: "smtp" },
				{ label: "None", value: "none" },
			],
		});
	});

	it("skips None", async () => {
		promptMocks.select.mockResolvedValue("none");
		await expect(emailProviderStep.execute({}, true)).resolves.toBe(SKIP);
	});

	it.each(["email-otp", "magic-link"])(
		"requires a provider for %s",
		async (method) => {
			promptMocks.select.mockResolvedValue("smtp");

			await expect(
				emailProviderStep.execute(
					rawConfig({ authentication: "better-auth", authMethods: [method] }),
					true,
				),
			).resolves.toBe("smtp");

			expect(promptMocks.select).toHaveBeenCalledWith({
				message: "Which email provider would you like to use?",
				options: [
					{ label: "Resend", value: "resend" },
					{ label: "Postmark", value: "postmark" },
					{ label: "SMTP", value: "smtp" },
				],
			});
		},
	);

	it("cancels once", async () => {
		promptMocks.select.mockResolvedValue(Symbol("cancel"));
		promptMocks.isCancel.mockReturnValue(true);

		await expect(emailProviderStep.execute({}, true)).rejects.toThrow(
			"Cancelled",
		);

		expect(cancelMocks.cancel).toHaveBeenCalledTimes(1);
	});
});
