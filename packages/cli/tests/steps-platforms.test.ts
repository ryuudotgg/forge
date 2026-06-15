import { beforeEach, describe, expect, it, vi } from "vitest";
import desktopStep from "../src/steps/platforms/desktop";
import mobileStep from "../src/steps/platforms/mobile";
import platformsStep from "../src/steps/platforms/select";
import webStep from "../src/steps/platforms/web";
import { type PartialConfig, SKIP } from "../src/steps/types";

const promptMocks = vi.hoisted(() => ({
	isCancel: vi.fn(() => false),
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
	isCancel: promptMocks.isCancel,
	log: { warn: promptMocks.logWarn },
	multiselect: promptMocks.multiselect,
	select: promptMocks.select,
}));

vi.mock("../src/utils/cancel", () => ({ cancel: cancelMocks.cancel }));

function rawConfig(entries: Record<string, unknown>): PartialConfig {
	const config: PartialConfig = {};

	for (const [key, value] of Object.entries(entries)) config[key] = value;

	return config;
}

beforeEach(() => {
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
			platformsStep.execute({ platforms: ["web", "mobile"] }, false),
		).resolves.toBe(SKIP);
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
				{ label: "Mobile", value: "mobile", hint: "coming soon" },
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
			.mockResolvedValueOnce(["web"]);

		await expect(platformsStep.execute({}, true)).resolves.toEqual(["web"]);

		expect(promptMocks.logWarn).toHaveBeenCalledTimes(1);
		expect(promptMocks.logWarn).toHaveBeenCalledWith(
			"We don't support Desktop and Mobile yet.",
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
	});

	it("defaults to nextjs when web is missing", async () => {
		await expect(webStep.execute({}, false)).resolves.toBe("nextjs");
	});

	it("silently defaults to nextjs when web is unknown", async () => {
		await expect(
			webStep.execute(rawConfig({ web: "angular" }), false),
		).resolves.toBe("nextjs");
	});

	it("silently defaults to nextjs when web is unavailable", async () => {
		await expect(webStep.execute({ web: "react-router" }, false)).resolves.toBe(
			"nextjs",
		);
	});

	it("recommends the first option and returns the interactive choice", async () => {
		promptMocks.select.mockResolvedValue("nextjs");

		await expect(webStep.execute({}, true)).resolves.toBe("nextjs");

		expect(promptMocks.select).toHaveBeenCalledWith({
			message: "What is your preferred web framework?",
			options: [
				{ label: "Next.js (Recommended)", value: "nextjs" },
				{ label: "React Router", value: "react-router", hint: "coming soon" },
				{
					label: "TanStack Router",
					value: "tanstack-router",
					hint: "coming soon",
				},
				{
					label: "TanStack Start",
					value: "tanstack-start",
					hint: "coming soon",
				},
			],
		});
	});

	it("warns and re-prompts when an unavailable web framework is selected", async () => {
		promptMocks.select
			.mockResolvedValueOnce("react-router")
			.mockResolvedValueOnce("nextjs");

		await expect(webStep.execute({}, true)).resolves.toBe("nextjs");

		expect(promptMocks.logWarn).toHaveBeenCalledWith(
			"We don't support React Router yet.",
		);
		expect(promptMocks.select).toHaveBeenCalledTimes(2);
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

	it("keeps a valid mobile framework when non-interactive", async () => {
		await expect(
			mobileStep.execute({ mobile: "react-native" }, false),
		).resolves.toBe("react-native");
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
		promptMocks.select.mockResolvedValue("react-native");

		await expect(mobileStep.execute({}, true)).resolves.toBe("react-native");

		expect(promptMocks.select).toHaveBeenCalledWith({
			message: "What is your preferred mobile framework?",
			options: [
				{ label: "Expo (Recommended)", value: "expo" },
				{ label: "React Native", value: "react-native" },
			],
		});
	});

	it("cancels the mobile prompt when interrupted", async () => {
		promptMocks.select.mockResolvedValue(Symbol("cancel"));
		promptMocks.isCancel.mockReturnValueOnce(true);

		await expect(mobileStep.execute({}, true)).rejects.toThrow("Cancelled");

		expect(cancelMocks.cancel).toHaveBeenCalledTimes(1);
	});
});
