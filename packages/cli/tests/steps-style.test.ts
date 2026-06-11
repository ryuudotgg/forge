import { uiLibraries } from "@ryuujs/generators";
import { beforeEach, describe, expect, it, vi } from "vitest";
import nativeStyleFrameworkStep from "../src/steps/style/native-framework";
import uiLibraryStep from "../src/steps/style/ui-library";
import styleFrameworkStep from "../src/steps/style/web-framework";
import { type PartialConfig, SKIP } from "../src/steps/types";

const promptMocks = vi.hoisted(() => ({
	cancel: vi.fn(),
	isCancel: vi.fn(),
	select: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
	cancel: promptMocks.cancel,
	isCancel: promptMocks.isCancel,
	select: promptMocks.select,
}));

function rawConfig(entries: Record<string, unknown>): PartialConfig {
	const config: PartialConfig = {};

	for (const [key, value] of Object.entries(entries)) config[key] = value;

	return config;
}

beforeEach(() => {
	promptMocks.cancel.mockReset();
	promptMocks.isCancel.mockReset();
	promptMocks.isCancel.mockReturnValue(false);
	promptMocks.select.mockReset();
});

describe("style framework step", () => {
	it("only runs when a web or desktop framework is selected", () => {
		expect(styleFrameworkStep.shouldRun({})).toBe(false);
		expect(styleFrameworkStep.shouldRun({ web: "nextjs" })).toBe(true);
		expect(styleFrameworkStep.shouldRun({ desktop: "tauri" })).toBe(true);
	});

	it("keeps a valid style framework when non-interactive", async () => {
		await expect(
			styleFrameworkStep.execute({ style: "tailwind" }, false),
		).resolves.toBe("tailwind");
	});

	it("skips when the style is missing or unknown", async () => {
		await expect(styleFrameworkStep.execute({}, false)).resolves.toBe(SKIP);
		await expect(
			styleFrameworkStep.execute(rawConfig({ style: "sass" }), false),
		).resolves.toBe(SKIP);
	});

	it("joins the selected framework labels in the interactive message", async () => {
		promptMocks.select.mockResolvedValue("tailwind");

		await expect(
			styleFrameworkStep.execute({ desktop: "electron", web: "nextjs" }, true),
		).resolves.toBe("tailwind");

		expect(promptMocks.select).toHaveBeenCalledWith({
			message:
				"Which styling framework do you want to use for Next.js and Electron?",
			options: [
				{ label: "Tailwind CSS", value: "tailwind" },
				{ label: "UnoCSS", value: "unocss" },
				{ label: "None", value: "none" },
			],
		});
	});

	it("drops absent frameworks from the interactive message", async () => {
		promptMocks.select.mockResolvedValue("unocss");

		await expect(
			styleFrameworkStep.execute({ web: "nextjs" }, true),
		).resolves.toBe("unocss");

		expect(promptMocks.select).toHaveBeenCalledWith(
			expect.objectContaining({
				message: "Which styling framework do you want to use for Next.js?",
			}),
		);
	});

	it("skips when none is selected interactively", async () => {
		promptMocks.select.mockResolvedValue("none");

		await expect(
			styleFrameworkStep.execute({ web: "nextjs" }, true),
		).resolves.toBe(SKIP);
	});
});

describe("native style framework step", () => {
	it("only runs when a mobile framework is selected", () => {
		expect(nativeStyleFrameworkStep.shouldRun({})).toBe(false);
		expect(nativeStyleFrameworkStep.shouldRun({ mobile: "expo" })).toBe(true);
	});

	it("keeps a valid native style framework when non-interactive", async () => {
		await expect(
			nativeStyleFrameworkStep.execute(
				{ nativeStyleFramework: "nativewind" },
				false,
			),
		).resolves.toBe("nativewind");
	});

	it("skips when none is passed non-interactively", async () => {
		await expect(
			nativeStyleFrameworkStep.execute(
				rawConfig({ nativeStyleFramework: "none" }),
				false,
			),
		).resolves.toBe(SKIP);
	});

	it("skips when the native style framework is missing or unknown", async () => {
		await expect(nativeStyleFrameworkStep.execute({}, false)).resolves.toBe(
			SKIP,
		);
		await expect(
			nativeStyleFrameworkStep.execute(
				rawConfig({ nativeStyleFramework: "styled-components" }),
				false,
			),
		).resolves.toBe(SKIP);
	});

	it("names the mobile framework in the interactive message", async () => {
		promptMocks.select.mockResolvedValue("tamagui");

		await expect(
			nativeStyleFrameworkStep.execute({ mobile: "expo" }, true),
		).resolves.toBe("tamagui");

		expect(promptMocks.select).toHaveBeenCalledWith({
			message: "Which styling framework do you want to use for Expo?",
			options: [
				{ label: "NativeWind", value: "nativewind" },
				{ label: "Tamagui", value: "tamagui" },
				{ label: "Unistyles", value: "unistyles" },
				{ label: "None", value: "none" },
			],
		});
	});

	it("skips when none is selected interactively", async () => {
		promptMocks.select.mockResolvedValue("none");

		await expect(
			nativeStyleFrameworkStep.execute({ mobile: "expo" }, true),
		).resolves.toBe(SKIP);
	});
});

describe("ui library step", () => {
	it("only runs when a web framework is selected", () => {
		expect(uiLibraryStep.shouldRun({})).toBe(false);
		expect(uiLibraryStep.shouldRun({ web: "nextjs" })).toBe(true);
	});

	it("round-trips every ui library id when non-interactive", async () => {
		for (const id of uiLibraries.ids)
			await expect(
				uiLibraryStep.execute({ uiLibrary: id }, false),
			).resolves.toBe(id);
	});

	it("skips when the ui library is missing or unknown", async () => {
		await expect(uiLibraryStep.execute({}, false)).resolves.toBe(SKIP);
		await expect(
			uiLibraryStep.execute(rawConfig({ uiLibrary: "shadcn" }), false),
		).resolves.toBe(SKIP);
	});

	it("returns the interactive choice", async () => {
		promptMocks.select.mockResolvedValue("radix");

		await expect(uiLibraryStep.execute({ web: "nextjs" }, true)).resolves.toBe(
			"radix",
		);

		expect(promptMocks.select).toHaveBeenCalledWith({
			message: "Which primitive library should your UI components use?",
			options: [
				{ label: "Base UI", value: "base-ui" },
				{ label: "Radix UI", value: "radix" },
			],
		});
	});

	it("exits through cancel when the interactive prompt is cancelled", async () => {
		const exit = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		try {
			promptMocks.select.mockResolvedValue("base-ui");
			promptMocks.isCancel.mockReturnValue(true);

			await expect(
				uiLibraryStep.execute({ web: "nextjs" }, true),
			).rejects.toThrow("exit:0");

			expect(promptMocks.cancel).toHaveBeenCalledWith(
				"You've extinguished the forge.",
			);
		} finally {
			exit.mockRestore();
		}
	});
});
