import {
	GitError,
	type InstallRecord,
	LONG_RUNNING_TIMEOUT_MS,
	Subprocess,
	SubprocessError,
} from "@ryuugg/core";
import { loadAddonDefinition } from "@ryuugg/generators";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSwitch } from "../src/commands/switch";
import { managedProject } from "./lifecycle-fixtures";

const promptMocks = vi.hoisted(() => ({
	error: vi.fn(),
	info: vi.fn(),
	message: vi.fn(),
	success: vi.fn(),
	warn: vi.fn(),
	start: vi.fn(),
	stop: vi.fn(),
}));

const boundaryMocks = vi.hoisted(() => ({
	applyInstalledPlan:
		vi.fn<typeof import("../src/commands/lifecycle").applyInstalledPlan>(),
	workingTreeStatus: vi.fn<typeof import("@ryuugg/core").workingTreeStatus>(),
	trackedFiles: vi.fn<typeof import("@ryuugg/core").trackedFiles>(),
}));

vi.mock("@clack/prompts", () => ({
	log: promptMocks,
	spinner: () => ({ start: promptMocks.start, stop: promptMocks.stop }),
}));

vi.mock("@ryuugg/core", async (importOriginal) => ({
	...(await importOriginal<typeof import("@ryuugg/core")>()),
	workingTreeStatus: boundaryMocks.workingTreeStatus,
	trackedFiles: boundaryMocks.trackedFiles,
}));

vi.mock("../src/commands/lifecycle", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/commands/lifecycle")>()),
	applyInstalledPlan: boundaryMocks.applyInstalledPlan,
}));

const project = managedProject({
	config: { slug: "acme", web: "nextjs", linter: "biome" },
});

const installs: ReadonlyArray<InstallRecord> = [
	{ definitionId: "oxc", targets: [{ kind: "project" }] },
];

const request: Parameters<typeof runSwitch>[1] = {
	addon: loadAddonDefinition("oxc").addon,
	holder: loadAddonDefinition("biome").addon,
	installs,
	registryIds: ["@acme/forge-tools"],
	noInstall: false,
	resolution: [{ resolutionPolicy: "accept-forge" }],
};

const remaining =
	'Run "pnpm install --no-frozen-lockfile", then "pnpm exec oxfmt --no-error-on-unmatched-pattern .", then "forge update --keep-user" inside the project to finish the switch.';

function operation(command: string, args: ReadonlyArray<string>) {
	return {
		command,
		args,
		cwd: ".",
		timeoutMs: LONG_RUNNING_TIMEOUT_MS,
		outputMode: "pipe",
	};
}

describe("exclusive addon switch", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		boundaryMocks.workingTreeStatus.mockReturnValue(
			Effect.succeed({ _tag: "Clean" }),
		);

		boundaryMocks.trackedFiles.mockReturnValue(Effect.succeed(["a.ts"]));
		boundaryMocks.applyInstalledPlan.mockResolvedValue({
			dependenciesChanged: false,
			retained: [],
			declined: [],
			dropped: [],
		});

		vi.spyOn(Subprocess, "run").mockReturnValue(
			Effect.succeed({ exitCode: 0, output: "" }),
		);

		vi.spyOn(process, "exit").mockImplementation((code) => {
			throw new Error(`exit:${code ?? 0}`);
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("rejects an addon without switching before checking Git", async () => {
		await expect(
			runSwitch(project, {
				...request,
				addon: loadAddonDefinition("prisma").addon,
			}),
		).rejects.toThrow("Addon Switching Missing: prisma");

		expect(boundaryMocks.workingTreeStatus).not.toHaveBeenCalled();
		expect(boundaryMocks.applyInstalledPlan).not.toHaveBeenCalled();
	});

	it("refuses a failed Git status check without applying", async () => {
		boundaryMocks.workingTreeStatus.mockReturnValue(
			Effect.fail(new GitError({ root: ".", detail: "status unavailable" })),
		);

		await expect(runSwitch(project, request)).rejects.toThrow("exit:1");

		expect(promptMocks.error).toHaveBeenCalledWith(
			"We couldn't check this project's Git status. Nothing was changed.",
		);

		expect(boundaryMocks.applyInstalledPlan).not.toHaveBeenCalled();
		expect(Subprocess.run).not.toHaveBeenCalled();
	});

	it.each([
		{
			_tag: "Dirty",
			message:
				"We can't switch from Biome to Oxc while you have uncommitted changes. Commit or stash them first.",
		},
		{
			_tag: "Untracked",
			message:
				"We can't switch from Biome to Oxc until Git tracks this project. Commit your project first.",
		},
	])("refuses $_tag without applying", async ({ _tag, message }) => {
		if (_tag !== "Dirty" && _tag !== "Untracked")
			throw new Error("Invalid status fixture");

		boundaryMocks.workingTreeStatus.mockReturnValue(Effect.succeed({ _tag }));

		await expect(runSwitch(project, request)).rejects.toThrow("exit:1");

		expect(promptMocks.error).toHaveBeenCalledWith(message);
		expect(boundaryMocks.applyInstalledPlan).not.toHaveBeenCalled();
		expect(Subprocess.run).not.toHaveBeenCalled();
		expect(boundaryMocks.trackedFiles).not.toHaveBeenCalled();
	});

	it("leaves manual finish commands when installation is disabled", async () => {
		await runSwitch(project, { ...request, noInstall: true });

		expect(promptMocks.warn).toHaveBeenCalledWith(
			`We switched the addon configuration from Biome to Oxc, but haven't installed its dependencies or reformatted your files yet. ${remaining}`,
		);

		expect(boundaryMocks.applyInstalledPlan).toHaveBeenCalledExactlyOnceWith(
			".",
			{ slug: "acme", web: "nextjs", linter: "oxc" },
			installs,
			undefined,
			request.registryIds,
			{ resolutionPolicy: "accept-forge", departing: ["biome"] },
		);

		expect(Subprocess.run).not.toHaveBeenCalled();
		expect(boundaryMocks.trackedFiles).not.toHaveBeenCalled();
		expect(promptMocks.success).not.toHaveBeenCalled();
	});

	it("prints the install failure detail and finish commands", async () => {
		vi.mocked(Subprocess.run).mockReturnValueOnce(
			Effect.fail(
				new SubprocessError({
					command: "pnpm",
					args: ["install", "--no-frozen-lockfile"],
					reason: "non-zero-exit",
					exitCode: 1,
					detail: "Dependency registry unavailable",
				}),
			),
		);

		await expect(runSwitch(project, request)).rejects.toThrow("exit:1");

		expect(Subprocess.run).toHaveBeenCalledExactlyOnceWith(
			operation("pnpm", ["install", "--no-frozen-lockfile"]),
		);

		expect(promptMocks.stop).toHaveBeenCalledWith(
			"We couldn't install your dependencies.",
		);

		expect(promptMocks.error).toHaveBeenCalledWith(
			`The configuration was switched, but the install failed. ${remaining}`,
		);

		expect(promptMocks.message).toHaveBeenCalledWith(
			"Subprocess Non-Zero Exit: pnpm install --no-frozen-lockfile exited with code 1. Dependency registry unavailable",
		);

		expect(boundaryMocks.applyInstalledPlan).toHaveBeenCalledTimes(1);
		expect(boundaryMocks.trackedFiles).not.toHaveBeenCalled();
	});

	it("refuses to reformat when tracked files cannot be read", async () => {
		boundaryMocks.trackedFiles.mockReturnValue(
			Effect.fail(new GitError({ root: ".", detail: "files unavailable" })),
		);

		await expect(runSwitch(project, request)).rejects.toThrow("exit:1");

		expect(promptMocks.stop).toHaveBeenCalledWith(
			"We couldn't read this project's tracked files.",
		);

		expect(promptMocks.error).toHaveBeenCalledWith(
			`The configuration was switched and dependencies installed, but reformatting couldn't start. ${remaining}`,
		);

		expect(Subprocess.run).toHaveBeenCalledTimes(1);
		expect(boundaryMocks.applyInstalledPlan).toHaveBeenCalledTimes(1);
	});

	it("prints the reformat failure detail without refreshing artifacts", async () => {
		vi.mocked(Subprocess.run)
			.mockReturnValueOnce(Effect.succeed({ exitCode: 0, output: "" }))
			.mockReturnValueOnce(
				Effect.fail(
					new SubprocessError({
						command: "pnpm",
						args: [
							"exec",
							"oxfmt",
							"--no-error-on-unmatched-pattern",
							"./a.ts",
						],
						reason: "non-zero-exit",
						exitCode: 1,
						detail: "Formatter failed",
					}),
				),
			);

		await expect(runSwitch(project, request)).rejects.toThrow("exit:1");

		expect(Subprocess.run).toHaveBeenNthCalledWith(
			2,
			operation("pnpm", [
				"exec",
				"oxfmt",
				"--no-error-on-unmatched-pattern",
				"./a.ts",
			]),
		);

		expect(promptMocks.stop).toHaveBeenCalledWith(
			"Reformatting didn't finish.",
		);

		expect(promptMocks.error).toHaveBeenCalledWith(
			`The configuration was switched and dependencies installed, but reformatting failed. ${remaining}`,
		);

		expect(promptMocks.message).toHaveBeenCalledWith(
			"Subprocess Non-Zero Exit: pnpm exec oxfmt --no-error-on-unmatched-pattern ./a.ts exited with code 1. Formatter failed",
		);

		expect(boundaryMocks.applyInstalledPlan).toHaveBeenCalledTimes(1);
	});

	it("installs, reformats, then refreshes artifacts with keep-user", async () => {
		await runSwitch(project, request);

		expect(boundaryMocks.workingTreeStatus).toHaveBeenCalledWith(".");
		expect(boundaryMocks.trackedFiles).toHaveBeenCalledWith(".");
		expect(Subprocess.run).toHaveBeenNthCalledWith(
			1,
			operation("pnpm", ["install", "--no-frozen-lockfile"]),
		);

		expect(Subprocess.run).toHaveBeenNthCalledWith(
			2,
			operation("pnpm", [
				"exec",
				"oxfmt",
				"--no-error-on-unmatched-pattern",
				"./a.ts",
			]),
		);

		expect(Subprocess.run).toHaveBeenCalledTimes(2);
		expect(boundaryMocks.applyInstalledPlan).toHaveBeenNthCalledWith(
			1,
			".",
			{ slug: "acme", web: "nextjs", linter: "oxc" },
			installs,
			undefined,
			request.registryIds,
			{ resolutionPolicy: "accept-forge", departing: ["biome"] },
		);

		expect(boundaryMocks.applyInstalledPlan).toHaveBeenNthCalledWith(
			2,
			".",
			{ slug: "acme", web: "nextjs", linter: "oxc" },
			installs,
			undefined,
			request.registryIds,
			{ resolutionPolicy: "keep-user", departing: ["biome"] },
		);

		expect(boundaryMocks.applyInstalledPlan).toHaveBeenCalledTimes(2);
		expect(
			boundaryMocks.applyInstalledPlan.mock.invocationCallOrder[0],
		).toBeLessThan(vi.mocked(Subprocess.run).mock.invocationCallOrder[0] ?? 0);

		expect(
			boundaryMocks.applyInstalledPlan.mock.invocationCallOrder[1],
		).toBeGreaterThan(
			vi.mocked(Subprocess.run).mock.invocationCallOrder[1] ?? 0,
		);

		expect(promptMocks.info).toHaveBeenCalledWith(
			"This project uses Biome, so we're switching it to Oxc.",
		);

		expect(promptMocks.start.mock.calls).toEqual([
			["We're installing your dependencies..."],
			["Reformatting this project's tracked files with Oxc."],
		]);

		expect(promptMocks.stop.mock.calls).toEqual([
			["We've installed your dependencies!"],
			["Reformatted this project's tracked files."],
		]);

		expect(promptMocks.success).toHaveBeenCalledWith(
			"We switched this project from Biome to Oxc. Review the changes and commit them.",
		);
	});

	it("splits more than 96 KiB of UTF-8 paths into bounded reformat calls", async () => {
		const paths = Array.from(
			{ length: 240 },
			(_, index) => `${index}/${"é".repeat(300)}.ts`,
		);

		boundaryMocks.trackedFiles.mockReturnValue(Effect.succeed(paths));
		expect(
			Buffer.byteLength(paths.map((path) => `./${path}`).join("\0")),
		).toBeGreaterThan(96 * 1024);

		await runSwitch(project, request);

		const calls = vi.mocked(Subprocess.run).mock.calls.slice(1);
		expect(calls.length).toBeGreaterThan(1);
		expect(calls.flatMap(([input]) => input.args.slice(3))).toEqual(
			paths.map((path) => `./${path}`),
		);

		for (const [input] of calls) {
			expect(input).toEqual(
				operation("pnpm", [
					"exec",
					"oxfmt",
					"--no-error-on-unmatched-pattern",
					...input.args.slice(3),
				]),
			);

			expect(
				input.args
					.slice(3)
					.reduce((bytes, path) => bytes + Buffer.byteLength(path) + 1, 0),
			).toBeLessThanOrEqual(96 * 1024);
		}
	});

	it("refreshes artifacts without running the formatter for no tracked files", async () => {
		boundaryMocks.trackedFiles.mockReturnValue(Effect.succeed([]));

		await runSwitch(project, { ...request, resolution: [] });

		expect(Subprocess.run).toHaveBeenCalledTimes(1);
		expect(boundaryMocks.applyInstalledPlan).toHaveBeenNthCalledWith(
			1,
			".",
			{ slug: "acme", web: "nextjs", linter: "oxc" },
			installs,
			undefined,
			request.registryIds,
			{ departing: ["biome"] },
		);

		expect(boundaryMocks.applyInstalledPlan).toHaveBeenCalledTimes(2);
	});

	it.each([false, true])(
		"reports dropped edits with noInstall=%s",
		async (noInstall) => {
			boundaryMocks.applyInstalledPlan.mockResolvedValueOnce({
				dependenciesChanged: false,
				retained: [],
				declined: [],
				dropped: [{ path: "biome.json", lines: "!**/legacy\n\n  " }],
			});

			await runSwitch(project, { ...request, noInstall });

			expect(promptMocks.warn).toHaveBeenCalledWith(
				"Biome is gone, so we removed biome.json and the changes you made to it. They're still in your last commit:\n!**/legacy",
			);

			expect(promptMocks.warn.mock.invocationCallOrder[0]).toBeGreaterThan(
				boundaryMocks.applyInstalledPlan.mock.invocationCallOrder[0] ?? 0,
			);

			if (noInstall) {
				expect(boundaryMocks.applyInstalledPlan).toHaveBeenCalledTimes(1);
				expect(Subprocess.run).not.toHaveBeenCalled();
			}
		},
	);

	it("reports a dropped empty file without a trailing listing", async () => {
		boundaryMocks.applyInstalledPlan.mockResolvedValueOnce({
			dependenciesChanged: false,
			retained: [],
			declined: [],
			dropped: [{ path: "biome.json", lines: "\n" }],
		});

		await runSwitch(project, { ...request, noInstall: true });

		expect(promptMocks.warn).toHaveBeenCalledWith(
			"Biome is gone, so we removed biome.json and the changes you made to it. They're still in your last commit.",
		);
	});
});
