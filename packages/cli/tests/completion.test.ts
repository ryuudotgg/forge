import { describe, expect, it } from "vitest";
import { completionLine, shellArgument } from "../src/utils/completion";

describe("completion lines", () => {
	it("asks for an install only when dependencies changed", () => {
		expect(
			completionLine("We added Biome.", { dependenciesChanged: true }, "Yarn"),
		).toBe('We added Biome. Run "yarn install" to update your dependencies.');

		expect(
			completionLine("We added Biome.", { dependenciesChanged: false }, "Yarn"),
		).toBe("We added Biome.");
	});

	it("quotes paths a shell would split", () => {
		expect(shellArgument("./acme")).toBe("./acme");
		expect(shellArgument("./my acme")).toBe("'./my acme'");
		expect(shellArgument("./it's")).toBe(`'./it'\\''s'`);
	});
});
