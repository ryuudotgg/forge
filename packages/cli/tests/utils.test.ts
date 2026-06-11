import { beforeEach, describe, expect, it, vi } from "vitest";
import { cancel } from "../src/utils/cancel";
import { rainbow } from "../src/utils/rainbow";
import { slugify } from "../src/utils/slugify";
import { stripNulls } from "../src/utils/strip-nulls";

const promptMocks = vi.hoisted(() => ({
	cancel: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
	cancel: promptMocks.cancel,
}));

vi.mock("picocolors", () => ({
	default: {
		blue: (text: string) => `[blue]${text}`,
		green: (text: string) => `[green]${text}`,
		magenta: (text: string) => `[magenta]${text}`,
		red: (text: string) => `[red]${text}`,
		yellow: (text: string) => `[yellow]${text}`,
	},
}));

describe("slugify", () => {
	it("lowercases and dashes whitespace", () => {
		expect(slugify("My App")).toBe("my-app");
	});

	it("strips punctuation and converts underscores", () => {
		expect(slugify("Hello__World!!")).toBe("hello-world");
	});

	it("collapses repeated dashes", () => {
		expect(slugify("a--b")).toBe("a-b");
	});
});

describe("cancel", () => {
	beforeEach(() => {
		promptMocks.cancel.mockReset();
	});

	it("prints the farewell message and exits cleanly by default", () => {
		const exit = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		try {
			expect(() => cancel()).toThrow("exit:0");
			expect(promptMocks.cancel).toHaveBeenCalledWith(
				"You've extinguished the forge.",
			);
		} finally {
			exit.mockRestore();
		}
	});

	it("forwards a custom message and exit code", () => {
		const exit = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		try {
			expect(() => cancel("bye", 1)).toThrow("exit:1");
			expect(promptMocks.cancel).toHaveBeenCalledWith("bye");
		} finally {
			exit.mockRestore();
		}
	});
});

describe("stripNulls", () => {
	it("filters null and undefined from arrays", () => {
		expect(stripNulls([1, null, undefined, 2])).toEqual([1, 2]);
	});

	it("filters null and undefined from objects", () => {
		expect(stripNulls({ a: 1, b: null, c: undefined })).toEqual({ a: 1 });
	});

	it("returns entries when requested", () => {
		expect(stripNulls({ a: 1, b: null }, true)).toEqual([["a", 1]]);
	});

	it("keeps falsy values that are present", () => {
		expect(stripNulls([0, "", false, null])).toEqual([0, "", false]);
		expect(stripNulls({ a: 0, b: "", c: false, d: undefined })).toEqual({
			a: 0,
			b: "",
			c: false,
		});
	});
});

describe("rainbow", () => {
	it("cycles the five colors across characters", () => {
		expect(rainbow("MYTHIC")).toBe(
			"[red]M[magenta]Y[blue]T[green]H[yellow]I[red]C",
		);
	});

	it("returns an empty string untouched", () => {
		expect(rainbow("")).toBe("");
	});
});
