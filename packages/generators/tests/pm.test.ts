import type { PackageManagerId } from "@ryuujs/core";
import { describe, expect, it } from "vitest";
import {
	pmDlx,
	pmExec,
	pmRun,
	pmRunIn,
	resolvePackageManager,
} from "../src/pm";

describe("resolvePackageManager", () => {
	it("defaults to pnpm when the config has no package manager", () => {
		expect(resolvePackageManager({})).toBe("pnpm");
	});

	it("maps display names to package manager ids", () => {
		expect(resolvePackageManager({ packageManager: "pnpm" })).toBe("pnpm");
		expect(resolvePackageManager({ packageManager: "npm" })).toBe("npm");
		expect(resolvePackageManager({ packageManager: "Yarn" })).toBe("yarn");
		expect(resolvePackageManager({ packageManager: "Bun" })).toBe("bun");
	});
});

describe("pmRun", () => {
	const cases: ReadonlyArray<{
		readonly pm: PackageManagerId;
		readonly script: string;
		readonly withArgs: string;
	}> = [
		{
			pm: "pnpm",
			script: "pnpm check",
			withArgs: "pnpm with-env prisma migrate dev",
		},
		{
			pm: "npm",
			script: "npm run check",
			withArgs: "npm run with-env -- prisma migrate dev",
		},
		{
			pm: "yarn",
			script: "yarn check",
			withArgs: "yarn with-env prisma migrate dev",
		},
		{
			pm: "bun",
			script: "bun run check",
			withArgs: "bun run with-env prisma migrate dev",
		},
	];

	it("emits the script invocation per package manager", () => {
		for (const { pm, script } of cases)
			expect(pmRun(pm, "check"), pm).toBe(script);
	});

	it("forwards extra arguments with npm's separator", () => {
		for (const { pm, withArgs } of cases)
			expect(pmRun(pm, "with-env", "prisma migrate dev"), pm).toBe(withArgs);
	});
});

describe("pmRunIn", () => {
	const pkg = { name: "@acme/db", path: "../../packages/db" };

	it("targets the workspace package per package manager", () => {
		expect(pmRunIn("pnpm", pkg, "generate")).toBe(
			"pnpm --filter @acme/db run generate",
		);
		expect(pmRunIn("npm", pkg, "generate")).toBe(
			"npm run generate --prefix ../../packages/db",
		);
		expect(pmRunIn("yarn", pkg, "generate")).toBe(
			"yarn workspace @acme/db generate",
		);
		expect(pmRunIn("bun", pkg, "generate")).toBe(
			"bun --filter @acme/db generate",
		);
	});
});

describe("pmDlx", () => {
	it("emits the one-off runner per package manager", () => {
		expect(pmDlx("pnpm", "shadcn@latest init")).toBe(
			"pnpm dlx shadcn@latest init",
		);
		expect(pmDlx("npm", "shadcn@latest init")).toBe("npx shadcn@latest init");
		expect(pmDlx("yarn", "shadcn@latest init")).toBe(
			"yarn dlx shadcn@latest init",
		);
		expect(pmDlx("bun", "shadcn@latest init")).toBe("bunx shadcn@latest init");
	});
});

describe("pmExec", () => {
	it("emits the local binary runner per package manager", () => {
		expect(pmExec("pnpm", "lefthook install")).toBe(
			"pnpm exec lefthook install",
		);
		expect(pmExec("npm", "lefthook install")).toBe("npx lefthook install");
		expect(pmExec("yarn", "lefthook install")).toBe(
			"yarn exec lefthook install",
		);
		expect(pmExec("bun", "lefthook install")).toBe("bunx lefthook install");
	});
});
