import { loadDefinitionRegistry } from "@ryuugg/generators";
import { Result, Schema } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildFlagOverrides, parseCliArgs } from "../src/cli";
import { orchestrate } from "../src/orchestrator";
import desktopStep from "../src/steps/platforms/desktop";
import mobileStep from "../src/steps/platforms/mobile";
import platformsStep from "../src/steps/platforms/select";
import webStep from "../src/steps/platforms/web";
import webAppsStep, { webAppsSchema } from "../src/steps/platforms/web-apps";
import { type PartialConfig, SKIP } from "../src/steps/types";

const promptMocks = vi.hoisted(() => ({
	confirm: vi.fn(),
	isCancel: vi.fn<(value: unknown) => boolean>(() => false),
	logWarn: vi.fn(),
	multiselect: vi.fn(),
	select: vi.fn(),
	text: vi.fn<
		(options: {
			message: string;
			validate: (value: string | undefined) => string | undefined;
		}) => Promise<string | symbol>
	>(),
}));

const cancelMocks = vi.hoisted(() => ({
	cancel: vi.fn((): never => {
		throw new Error("Cancelled");
	}),
}));

vi.mock("@clack/prompts", () => ({
	confirm: promptMocks.confirm,
	isCancel: promptMocks.isCancel,
	log: { warn: promptMocks.logWarn },
	multiselect: promptMocks.multiselect,
	select: promptMocks.select,
	text: promptMocks.text,
}));

vi.mock("../src/utils/cancel", () => ({ cancel: cancelMocks.cancel }));

function rawConfig(entries: Record<string, unknown>): PartialConfig {
	const config: PartialConfig = {};
	for (const [key, value] of Object.entries(entries)) config[key] = value;
	return config;
}

beforeEach(() => {
	promptMocks.confirm.mockReset();
	promptMocks.text.mockReset();
	promptMocks.isCancel.mockReset();
	promptMocks.isCancel.mockReturnValue(false);

	promptMocks.logWarn.mockReset();
	promptMocks.multiselect.mockReset();
	promptMocks.select.mockReset();
	cancelMocks.cancel.mockClear();
});

describe("platforms step", () => {
	it("keeps a valid platform list when non-interactive", async () => {
		await expect(
			platformsStep.execute({ platforms: ["web"] }, false),
		).resolves.toEqual(["web"]);
	});

	it("skips when the list contains an unavailable platform", async () => {
		await expect(
			platformsStep.execute({ platforms: ["desktop"] }, false),
		).resolves.toBe(SKIP);
	});

	it("silently filters unknown platforms when non-interactive", async () => {
		await expect(
			platformsStep.execute(rawConfig({ platforms: ["web", "webb"] }), false),
		).resolves.toEqual(["web"]);
	});

	it("skips when every platform is unknown", async () => {
		await expect(
			platformsStep.execute(rawConfig({ platforms: ["bogus"] }), false),
		).resolves.toBe(SKIP);
	});

	it("skips when platforms is not an array", async () => {
		await expect(
			platformsStep.execute(rawConfig({ platforms: "web" }), false),
		).resolves.toBe(SKIP);
	});

	it("returns the interactive multiselect choice", async () => {
		promptMocks.multiselect.mockResolvedValue(["web"]);

		await expect(platformsStep.execute({}, true)).resolves.toEqual(["web"]);

		expect(promptMocks.multiselect).toHaveBeenCalledWith({
			message: "What platforms do you want to support?",
			options: [
				{ label: "Web", value: "web" },
				{ label: "Desktop", value: "desktop", hint: "coming soon" },
				{ label: "Mobile", value: "mobile" },
			],
			required: true,
		});
	});

	it("warns and re-prompts when an unavailable platform is selected", async () => {
		promptMocks.multiselect
			.mockResolvedValueOnce(["web", "desktop"])
			.mockResolvedValueOnce(["web"]);

		await expect(platformsStep.execute({}, true)).resolves.toEqual(["web"]);

		expect(promptMocks.logWarn).toHaveBeenCalledWith(
			"We don't support Desktop yet.",
		);

		expect(promptMocks.multiselect).toHaveBeenCalledTimes(2);
	});

	it("lists every unsupported platform in one warning", async () => {
		promptMocks.multiselect
			.mockResolvedValueOnce(["web", "desktop", "mobile"])
			.mockResolvedValueOnce(["web", "mobile"]);

		await expect(platformsStep.execute({}, true)).resolves.toEqual([
			"web",
			"mobile",
		]);

		expect(promptMocks.logWarn).toHaveBeenCalledTimes(1);
		expect(promptMocks.logWarn).toHaveBeenCalledWith(
			"We don't support Desktop yet.",
		);
	});

	it("skips when the interactive selection is empty", async () => {
		promptMocks.multiselect.mockResolvedValue([]);
		await expect(platformsStep.execute({}, true)).resolves.toBe(SKIP);
	});

	it("cancels platform selection when the prompt is interrupted", async () => {
		promptMocks.multiselect.mockResolvedValue(Symbol("cancel"));
		promptMocks.isCancel.mockReturnValueOnce(true);

		await expect(platformsStep.execute({}, true)).rejects.toThrow("Cancelled");

		expect(cancelMocks.cancel).toHaveBeenCalledTimes(1);
	});
});

describe("secondary web apps step", () => {
	it("runs after web selection and skips non-interactive defaults", async () => {
		expect(webAppsStep.id).toBe("webApps");
		expect(webAppsStep.group).toBe("platforms");
		expect(webAppsStep.configKey).toBe("webApps");
		expect(webAppsStep.dependencies).toEqual(["web"]);

		expect(webAppsStep.shouldRun({})).toBe(false);
		expect(webAppsStep.shouldRun({ platforms: ["mobile"] })).toBe(false);
		expect(webAppsStep.shouldRun({ platforms: ["web"] })).toBe(true);

		await expect(webAppsStep.execute({}, false)).resolves.toBe(SKIP);

		expect(promptMocks.confirm).not.toHaveBeenCalled();
		expect(promptMocks.select).not.toHaveBeenCalled();
		expect(promptMocks.multiselect).not.toHaveBeenCalled();
	});

	it("declines secondary apps without changing the config", async () => {
		promptMocks.confirm.mockResolvedValue(false);

		await expect(webAppsStep.execute({ web: "nextjs" }, true)).resolves.toBe(
			SKIP,
		);

		expect(promptMocks.text).not.toHaveBeenCalled();
	});

	it("collects two secondary apps with separate client choices", async () => {
		promptMocks.confirm
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(false);

		promptMocks.text
			.mockResolvedValueOnce("admin")
			.mockResolvedValueOnce("docs");

		promptMocks.select
			.mockResolvedValueOnce("nextjs")
			.mockResolvedValueOnce("react-router");

		await expect(
			webAppsStep.execute({ web: "tanstack-router" }, true),
		).resolves.toEqual([
			{ name: "admin", framework: "nextjs", client: true },
			{ name: "docs", framework: "react-router" },
		]);

		expect(promptMocks.confirm).toHaveBeenCalledWith({
			message: "Mark admin as an API client?",
			initialValue: false,
		});

		const first = promptMocks.text.mock.calls[0]?.[0];
		const second = promptMocks.text.mock.calls[1]?.[0];

		expect(first?.validate("web")).toBe(
			"web is reserved. Pick another name for this web app.",
		);

		expect(first?.validate("Bad_Name")).toBe(
			"Bad_Name isn't a valid web app name. Start with a lowercase letter and use only lowercase letters, numbers and hyphens.",
		);

		expect(first?.validate(undefined)).toBe("Give this web app a name.");
		expect(first?.validate("")).toBe("Give this web app a name.");
		expect(first?.validate("settings")).toBeUndefined();

		expect(second?.validate("admin")).toBe(
			"admin is used by more than one web app.",
		);
	});

	it("asks each secondary's framework by name without a recommendation", async () => {
		promptMocks.confirm
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(false);

		promptMocks.text.mockResolvedValue("admin");
		promptMocks.select.mockResolvedValue("react-router");

		await webAppsStep.execute({ web: "nextjs" }, true);

		expect(promptMocks.select).toHaveBeenCalledWith({
			message: "Which web framework should admin use?",
			options: [
				{ label: "Next.js", value: "nextjs" },
				{ label: "React Router", value: "react-router" },
				{ label: "TanStack Router", value: "tanstack-router" },
				{ label: "TanStack Start", value: "tanstack-start" },
			],
		});
	});

	it("refuses every first-party addon id as a new app name", async () => {
		promptMocks.confirm.mockResolvedValueOnce(true);
		promptMocks.text.mockResolvedValue(Symbol("cancel"));
		promptMocks.isCancel.mockImplementation(
			(value) => typeof value === "symbol",
		);

		await expect(
			webAppsStep.execute({ web: "tanstack-router" }, true),
		).rejects.toThrow("Cancelled");

		const validate = promptMocks.text.mock.calls[0]?.[0].validate;
		const addonIds = loadDefinitionRegistry().registry.addons.map(
			(addon) => addon.id,
		);

		expect(addonIds).toEqual(
			expect.arrayContaining(["biome", "tailwind", "drizzle"]),
		);

		for (const id of addonIds) expect(validate?.(id)).toBeDefined();

		expect(validate?.("biome")).toBe(
			"biome is an addon id. Pick another name for this web app.",
		);

		expect(() =>
			buildFlagOverrides(
				parseCliArgs(["--web", "nextjs", "--web", "tailwind=nextjs"]).values,
			),
		).toThrow(
			/^tailwind is an addon id\. Pick another name for this web app\.$/,
		);
	});

	it("produces the same secondary config as repeatable web flags", async () => {
		promptMocks.confirm
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(false);

		promptMocks.text.mockResolvedValue("admin");
		promptMocks.select.mockResolvedValue("nextjs");
		const apps = await webAppsStep.execute({ web: "tanstack-router" }, true);

		expect(
			buildFlagOverrides(
				parseCliArgs(["--web", "tanstack-router", "--web", "admin=nextjs"])
					.values,
			),
		).toEqual({ web: "tanstack-router", webApps: apps });
	});

	it.each(["more", "name", "framework", "client"])(
		"cancels at %s before generation",
		async (stage) => {
			const cancelled = Symbol("cancel");
			promptMocks.isCancel.mockImplementation(
				(value: unknown) => value === cancelled,
			);

			promptMocks.confirm
				.mockResolvedValueOnce(stage === "more" ? cancelled : true)
				.mockResolvedValueOnce(stage === "client" ? cancelled : false);

			promptMocks.text.mockResolvedValue(
				stage === "name" ? cancelled : "admin",
			);

			promptMocks.select.mockResolvedValue(
				stage === "framework" ? cancelled : "nextjs",
			);

			const generate = vi.fn();

			await expect(
				orchestrate(
					[
						webAppsStep,
						{
							id: "generate",
							group: "generate",
							schema: null,
							configKey: null,
							shouldRun: () => true,
							execute: generate,
						},
					],
					{
						initialConfig: { platforms: ["web"], web: "nextjs" },
						interactive: true,
					},
				),
			).rejects.toThrow("Cancelled");

			expect(cancelMocks.cancel).toHaveBeenCalledOnce();
			expect(generate).not.toHaveBeenCalled();
		},
	);

	it("keeps the no-flags non-interactive primary and no secondaries", async () => {
		const config = await orchestrate([webStep, webAppsStep], {
			initialConfig: { platforms: ["web"] },
			interactive: false,
		});

		expect(config).toEqual({ web: "nextjs" });
		expect(promptMocks.confirm).not.toHaveBeenCalled();
	});

	it.each([
		[
			{ name: "admin", framework: "nextjs" },
			{ name: "admin", framework: "nextjs" },
		],
		[{ name: "web", framework: "nextjs" }],
		[{ name: "Admin", framework: "nextjs" }],
		[{ name: "2admin", framework: "nextjs" }],
		[{ name: "admin_tools", framework: "nextjs" }],
		[{ name: "admin", framework: "unknown" }],
		[{ name: "admin", framework: "nextjs", client: "yes" }],
	])("rejects invalid secondary apps %j", (...apps) => {
		expect(
			Result.isFailure(Schema.decodeUnknownResult(webAppsSchema)(apps)),
		).toBe(true);
	});

	it("accepts valid secondary apps and an empty list", () => {
		for (const apps of [
			[],
			[{ name: "admin-tools", framework: "nextjs" }],
			[{ name: "admin", framework: "nextjs", client: true }],
		])
			expect(
				Result.isSuccess(Schema.decodeUnknownResult(webAppsSchema)(apps)),
			).toBe(true);
	});
});

describe("web step", () => {
	it("only runs when web is a selected platform", () => {
		expect(webStep.shouldRun({})).toBe(false);
		expect(webStep.shouldRun({ platforms: ["mobile"] })).toBe(false);
		expect(webStep.shouldRun({ platforms: ["web"] })).toBe(true);
	});

	it("keeps a valid web framework when non-interactive", async () => {
		await expect(webStep.execute({ web: "nextjs" }, false)).resolves.toBe(
			"nextjs",
		);

		await expect(webStep.execute({ web: "react-router" }, false)).resolves.toBe(
			"react-router",
		);

		await expect(
			webStep.execute({ web: "tanstack-router" }, false),
		).resolves.toBe("tanstack-router");

		await expect(
			webStep.execute({ web: "tanstack-start" }, false),
		).resolves.toBe("tanstack-start");
	});

	it("defaults to nextjs when web is missing", async () => {
		await expect(webStep.execute({}, false)).resolves.toBe("nextjs");
	});

	it("silently defaults to nextjs when web is unknown", async () => {
		await expect(
			webStep.execute(rawConfig({ web: "angular" }), false),
		).resolves.toBe("nextjs");
	});

	it("recommends the first option and returns the interactive choice", async () => {
		promptMocks.select.mockResolvedValue("nextjs");

		await expect(webStep.execute({}, true)).resolves.toBe("nextjs");

		expect(promptMocks.select).toHaveBeenCalledWith({
			message: "What is your preferred web framework?",
			options: [
				{ label: "Next.js (Recommended)", value: "nextjs" },
				{ label: "React Router", value: "react-router" },
				{ label: "TanStack Router", value: "tanstack-router" },
				{
					label: "TanStack Start",
					value: "tanstack-start",
				},
			],
		});
	});
});

describe("desktop step", () => {
	it("only runs when desktop is a selected platform", () => {
		expect(desktopStep.shouldRun({})).toBe(false);
		expect(desktopStep.shouldRun({ platforms: ["web"] })).toBe(false);
		expect(desktopStep.shouldRun({ platforms: ["desktop"] })).toBe(true);
	});

	it("keeps a valid desktop framework when non-interactive", async () => {
		await expect(
			desktopStep.execute({ desktop: "tauri" }, false),
		).resolves.toBe("tauri");
	});

	it("defaults to electron when desktop is missing", async () => {
		await expect(desktopStep.execute({}, false)).resolves.toBe("electron");
	});

	it("silently defaults to electron when desktop is unknown", async () => {
		await expect(
			desktopStep.execute(rawConfig({ desktop: "qt" }), false),
		).resolves.toBe("electron");
	});

	it("recommends the first option and returns the interactive choice", async () => {
		promptMocks.select.mockResolvedValue("tauri");

		await expect(desktopStep.execute({}, true)).resolves.toBe("tauri");

		expect(promptMocks.select).toHaveBeenCalledWith({
			message: "What is your preferred desktop framework?",
			options: [
				{ label: "Electron (Recommended)", value: "electron" },
				{ label: "Tauri", value: "tauri" },
			],
		});
	});

	it("cancels the desktop prompt when interrupted", async () => {
		promptMocks.select.mockResolvedValue(Symbol("cancel"));
		promptMocks.isCancel.mockReturnValueOnce(true);

		await expect(desktopStep.execute({}, true)).rejects.toThrow("Cancelled");

		expect(cancelMocks.cancel).toHaveBeenCalledTimes(1);
	});
});

describe("mobile step", () => {
	it("only runs when mobile is a selected platform", () => {
		expect(mobileStep.shouldRun({})).toBe(false);
		expect(mobileStep.shouldRun({ platforms: ["desktop"] })).toBe(false);
		expect(mobileStep.shouldRun({ platforms: ["mobile"] })).toBe(true);
	});

	it("keeps Expo when non-interactive", async () => {
		await expect(mobileStep.execute({ mobile: "expo" }, false)).resolves.toBe(
			"expo",
		);
	});

	it("skips unavailable mobile frameworks when non-interactive", async () => {
		await expect(
			mobileStep.execute({ mobile: "react-native" }, false),
		).resolves.toBe(SKIP);
	});

	it("defaults to expo when mobile is missing", async () => {
		await expect(mobileStep.execute({}, false)).resolves.toBe("expo");
	});

	it("silently defaults to expo when mobile is unknown", async () => {
		await expect(
			mobileStep.execute(rawConfig({ mobile: "ionic" }), false),
		).resolves.toBe("expo");
	});

	it("recommends the first option and returns the interactive choice", async () => {
		promptMocks.select.mockResolvedValue("expo");

		await expect(mobileStep.execute({}, true)).resolves.toBe("expo");

		expect(promptMocks.select).toHaveBeenCalledWith({
			message: "What is your preferred mobile framework?",
			options: [
				{ label: "Expo (Recommended)", value: "expo" },
				{ label: "React Native", value: "react-native", hint: "coming soon" },
			],
		});
	});

	it("warns and re-prompts when React Native is selected", async () => {
		promptMocks.select
			.mockResolvedValueOnce("react-native")
			.mockResolvedValueOnce("expo");

		await expect(mobileStep.execute({}, true)).resolves.toBe("expo");

		expect(promptMocks.logWarn).toHaveBeenCalledWith(
			"We don't support React Native yet.",
		);

		expect(promptMocks.select).toHaveBeenCalledTimes(2);
	});

	it("cancels the mobile prompt when interrupted", async () => {
		promptMocks.select.mockResolvedValue(Symbol("cancel"));
		promptMocks.isCancel.mockReturnValueOnce(true);

		await expect(mobileStep.execute({}, true)).rejects.toThrow("Cancelled");

		expect(cancelMocks.cancel).toHaveBeenCalledTimes(1);
	});
});
