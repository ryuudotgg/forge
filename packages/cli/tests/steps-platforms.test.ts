import { beforeEach, describe, expect, it, vi } from "vitest";
import desktopStep from "../src/steps/platforms/desktop";
import mobileStep from "../src/steps/platforms/mobile";
import platformsStep from "../src/steps/platforms/select";
import webStep from "../src/steps/platforms/web";
import { type PartialConfig, SKIP } from "../src/steps/types";

const promptMocks = vi.hoisted(() => ({
	multiselect: vi.fn(),
	select: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
	isCancel: () => false,
	multiselect: promptMocks.multiselect,
	select: promptMocks.select,
}));

function rawConfig(entries: Record<string, unknown>): PartialConfig {
	const config: PartialConfig = {};

	for (const [key, value] of Object.entries(entries)) config[key] = value;

	return config;
}

beforeEach(() => {
	promptMocks.multiselect.mockReset();
	promptMocks.select.mockReset();
});

describe("platforms step", () => {
	it("keeps a valid platform list when non-interactive", async () => {
		await expect(
			platformsStep.execute({ platforms: ["web", "mobile"] }, false),
		).resolves.toEqual(["web", "mobile"]);
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
		promptMocks.multiselect.mockResolvedValue(["desktop"]);

		await expect(platformsStep.execute({}, true)).resolves.toEqual(["desktop"]);

		expect(promptMocks.multiselect).toHaveBeenCalledWith({
			message: "What platforms do you want to support?",
			options: [
				{ label: "Web", value: "web" },
				{ label: "Desktop", value: "desktop" },
				{ label: "Mobile", value: "mobile" },
			],
			required: true,
		});
	});

	it("skips when the interactive selection is empty", async () => {
		promptMocks.multiselect.mockResolvedValue([]);

		await expect(platformsStep.execute({}, true)).resolves.toBe(SKIP);
	});
});

describe("web step", () => {
	it("only runs when web is a selected platform", () => {
		expect(webStep.shouldRun({})).toBe(false);
		expect(webStep.shouldRun({ platforms: ["mobile"] })).toBe(false);
		expect(webStep.shouldRun({ platforms: ["web"] })).toBe(true);
	});

	it("keeps a valid web framework when non-interactive", async () => {
		await expect(
			webStep.execute({ web: "tanstack-router" }, false),
		).resolves.toBe("tanstack-router");
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
		promptMocks.select.mockResolvedValue("react-router");

		await expect(webStep.execute({}, true)).resolves.toBe("react-router");

		expect(promptMocks.select).toHaveBeenCalledWith({
			message: "What is your preferred web framework?",
			options: [
				{ label: "Next.js (Recommended)", value: "nextjs" },
				{ label: "React Router", value: "react-router" },
				{ label: "TanStack Router", value: "tanstack-router" },
				{ label: "TanStack Start", value: "tanstack-start" },
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
});
