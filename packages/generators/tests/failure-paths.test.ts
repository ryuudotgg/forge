import { describe, expect, it } from "vitest";
import betterAuth from "../src/auth/better-auth";
import typescript from "../src/tooling/typescript";
import { uiComponentsJson } from "../src/ui/shared";

const definitionContext = {
	commandVersions: {},
	frameworks: [],
};

describe("registry-era definition failures", () => {
	it("requires an ORM before Better Auth contributes artifacts", () => {
		expect(() =>
			betterAuth.contribute({
				...definitionContext,
				config: { authentication: "better-auth" },
			}),
		).toThrow("You need to add an ORM before you can use Better Auth.");
	});

	it("rejects a selected web framework missing from the registry", () => {
		expect(() =>
			typescript.contribute({
				...definitionContext,
				config: { web: "nextjs" },
			}),
		).toThrow("Framework Definition Missing: nextjs");
	});

	it("uses the stable fallback slug in registry-era UI metadata", () => {
		expect(uiComponentsJson({}, true)).toMatchObject({
			aliases: {
				components: "@my-app/ui/components",
				hooks: "@my-app/ui/hooks",
				lib: "@my-app/ui/lib",
				ui: "@my-app/ui/components",
				utils: "@my-app/ui/lib/utils",
			},
		});
	});
});
