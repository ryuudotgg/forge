import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { inspect } from "node:util";
import {
	ApplyError,
	type ApplyPlan,
	type LockfileArtifact,
} from "@ryuujs/core";
import { Cause } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	canResolveInteractively,
	isInteractiveLifecycleSession,
	promptForConflictResolutions,
} from "../src/commands/interactive-resolution";
import { applyLifecyclePlan } from "../src/commands/lifecycle";
import { failureFromCause } from "../src/runtime";
import { withTempDir, writeText } from "./lifecycle-fixtures";

const promptMocks = vi.hoisted(() => ({
	cancel: vi.fn(),
	cancelToken: Symbol("cancel"),
	isCancel: vi.fn(),
	logError: vi.fn(),
	logInfo: vi.fn(),
	logSuccess: vi.fn(),
	logWarn: vi.fn(),
	select: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
	cancel: promptMocks.cancel,
	isCancel: promptMocks.isCancel,
	log: {
		error: promptMocks.logError,
		info: promptMocks.logInfo,
		success: promptMocks.logSuccess,
		warn: promptMocks.logWarn,
	},
	select: promptMocks.select,
}));

function hashContent(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

function setTTY(isTTY: boolean): () => void {
	const stdinDescriptor = Object.getOwnPropertyDescriptor(
		process.stdin,
		"isTTY",
	);
	const stdoutDescriptor = Object.getOwnPropertyDescriptor(
		process.stdout,
		"isTTY",
	);
	Object.defineProperty(process.stdin, "isTTY", {
		configurable: true,
		value: isTTY,
	});
	Object.defineProperty(process.stdout, "isTTY", {
		configurable: true,
		value: isTTY,
	});

	return () => {
		if (stdinDescriptor === undefined)
			Reflect.deleteProperty(process.stdin, "isTTY");
		else Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
		if (stdoutDescriptor === undefined)
			Reflect.deleteProperty(process.stdout, "isTTY");
		else Object.defineProperty(process.stdout, "isTTY", stdoutDescriptor);
	};
}

function conflictError() {
	return new ApplyError({
		reason: "preflight-failed",
		detail: "Semantic merge conflicts were found.",
		path: "managed files",
		preflight: {
			conflicts: [
				{
					base: "tsc",
					forge: "tsc -b",
					label: "package.json -> scripts.build",
					user: "tsc --watch",
				},
				{
					base: "vite",
					forge: "vite --port 4000",
					label: "package.json -> scripts.dev",
					user: "vite --host",
				},
			],
			hasConflicts: true,
			hasManagedRemovals: false,
			hasManagedRefusals: true,
			hasUnmanagedRefusals: false,
			hasUnmanagedRemovals: false,
			refusals: [
				{
					reason: "managed-file-modified",
					operation: "write",
					path: "README.md",
					resolvable: true,
				},
			],
		},
	});
}

async function semanticFixture(directory: string) {
	const artifactId = "project:surface:rootPackageJson";
	const base =
		'{\n\t"scripts": {\n\t\t"build": "tsc",\n\t\t"dev": "vite"\n\t}\n}\n';
	const baseHash = hashContent(base);
	const artifact: LockfileArtifact = {
		base: { hash: baseHash, mergeKind: "json", semanticsVersion: 1 },
		definitionIds: ["root"],
		hash: baseHash,
		kind: "surface",
		path: "package.json",
	};
	await applyLifecyclePlan(
		directory,
		{
			lockfile: { artifacts: { [artifactId]: artifact } },
			manifest: { config: {}, installs: [], modules: {} },
			removals: [],
			writes: [{ artifactId, content: base, path: "package.json" }],
		},
		{},
	);

	const user =
		'{\n\t"scripts": {\n\t\t"build": "tsc --watch",\n\t\t"dev": "vite --host"\n\t}\n}\n';
	await writeText(join(directory, "package.json"), user);
	const incoming =
		'{\n\t"scripts": {\n\t\t"build": "tsc -b",\n\t\t"dev": "vite --port 4000"\n\t}\n}\n';
	const incomingHash = hashContent(incoming);
	const plan: ApplyPlan = {
		lockfile: {
			artifacts: {
				[artifactId]: {
					...artifact,
					base: {
						hash: incomingHash,
						mergeKind: "json",
						semanticsVersion: 1,
					},
					hash: incomingHash,
				},
			},
		},
		manifest: { config: { changed: true }, installs: [], modules: {} },
		removals: [],
		writes: [{ artifactId, content: incoming, path: "package.json" }],
	};

	return { plan, user };
}

async function repeatedLineFixture(directory: string) {
	const artifactId = "project:surface:gitignore";
	const path = ".gitignore";
	const base = "# Sec\nkeep\nshared\nmid\nshared\ntail\n";
	const baseHash = hashContent(base);
	const artifact: LockfileArtifact = {
		base: { hash: baseHash, mergeKind: "lines", semanticsVersion: 1 },
		definitionIds: ["gitignore"],
		hash: baseHash,
		kind: "surface",
		path,
	};
	await applyLifecyclePlan(
		directory,
		{
			lockfile: { artifacts: { [artifactId]: artifact } },
			manifest: { config: {}, installs: [], modules: {} },
			removals: [],
			writes: [{ artifactId, content: base, path }],
		},
		{},
	);

	await writeText(
		join(directory, path),
		"# Sec\nkeep\nuser-one\nmid\nuser-two\ntail\n",
	);
	const incoming = "# Sec\nkeep\nforge-one\nmid\nforge-two\ntail\n";
	const incomingHash = hashContent(incoming);

	return {
		path,
		plan: {
			lockfile: {
				artifacts: {
					[artifactId]: {
						...artifact,
						base: {
							hash: incomingHash,
							mergeKind: "lines",
							semanticsVersion: 1,
						},
						hash: incomingHash,
					},
				},
			},
			manifest: { config: { changed: true }, installs: [], modules: {} },
			removals: [],
			writes: [{ artifactId, content: incoming, path }],
		} satisfies ApplyPlan,
	};
}

describe("interactive resolution", () => {
	beforeEach(() => {
		promptMocks.cancel.mockReset();
		promptMocks.isCancel.mockReset();
		promptMocks.logError.mockReset();
		promptMocks.logInfo.mockReset();
		promptMocks.logSuccess.mockReset();
		promptMocks.logWarn.mockReset();
		promptMocks.select.mockReset();
		promptMocks.isCancel.mockImplementation(
			(value: unknown) => value === promptMocks.cancelToken,
		);
		vi.unstubAllEnvs();
	});

	it("renders grouped values and summarizes mixed choices exactly", async () => {
		promptMocks.select
			.mockResolvedValueOnce("user")
			.mockResolvedValueOnce("forge")
			.mockResolvedValueOnce("user");

		const resolution = await promptForConflictResolutions(conflictError());

		expect(promptMocks.logInfo.mock.calls).toEqual([
			["README.md"],
			["package.json"],
		]);
		expect(promptMocks.select.mock.calls).toEqual([
			[
				{
					message: "This managed file was modified.",
					options: [
						{ label: "Keep my value", value: "user" },
						{ label: "Take Forge's", value: "forge" },
					],
				},
			],
			[
				{
					message:
						'scripts.build\nBase:   "tsc"\nYours:  "tsc --watch"\nForge:  "tsc -b"',
					options: [
						{ label: "Keep my value", value: "user" },
						{ label: "Take Forge's", value: "forge" },
					],
				},
			],
			[
				{
					message:
						'scripts.dev\nBase:   "vite"\nYours:  "vite --host"\nForge:  "vite --port 4000"',
					options: [
						{ label: "Keep my value", value: "user" },
						{ label: "Take Forge's", value: "forge" },
					],
				},
			],
		]);
		expect(resolution).toEqual({
			options: {
				conflictResolutions: {
					"README.md": { resolution: "user" },
					"package.json -> scripts.build": {
						expected: { forge: "tsc -b", user: "tsc --watch" },
						resolution: "forge",
					},
					"package.json -> scripts.dev": {
						expected: { forge: "vite --port 4000", user: "vite --host" },
						resolution: "user",
					},
				},
			},
			summary:
				"We resolved README.md with your value, package.json -> scripts.build with Forge's value, and package.json -> scripts.dev with your value.",
		});
	});

	it("retries the ordinary apply with mixed per-cell choices", async () => {
		const restoreTTY = setTTY(true);
		vi.stubEnv("CI", "");
		promptMocks.select
			.mockResolvedValueOnce("user")
			.mockResolvedValueOnce("forge");

		try {
			await withTempDir("interactive-mixed", async (directory) => {
				const { plan } = await semanticFixture(directory);
				await applyLifecyclePlan(directory, plan, {});

				expect(
					JSON.parse(await readFile(join(directory, "package.json"), "utf-8")),
				).toEqual({
					scripts: {
						build: "tsc --watch",
						dev: "vite --port 4000",
					},
				});
				expect(promptMocks.logSuccess).toHaveBeenCalledWith(
					"We resolved package.json -> scripts.build with your value and package.json -> scripts.dev with Forge's value.",
				);
			});
		} finally {
			restoreTTY();
		}
	});

	it("honors mixed choices for repeated line conflict labels", async () => {
		const restoreTTY = setTTY(true);
		vi.stubEnv("CI", "");
		promptMocks.select
			.mockResolvedValueOnce("user")
			.mockResolvedValueOnce("forge");

		try {
			await withTempDir("interactive-repeated-lines", async (directory) => {
				const { path, plan } = await repeatedLineFixture(directory);
				await applyLifecyclePlan(directory, plan, {});

				expect(await readFile(join(directory, path), "utf-8")).toBe(
					"# Sec\nkeep\nuser-one\nmid\nforge-two\ntail\n",
				);
				expect(promptMocks.logSuccess).toHaveBeenCalledWith(
					"We resolved .gitignore -> Sec -> shared with your value and .gitignore -> Sec -> shared (2nd) with Forge's value.",
				);
			});
		} finally {
			restoreTTY();
		}
	});

	it("refuses a stored choice when its shown value changes", async () => {
		const restoreTTY = setTTY(true);
		vi.stubEnv("CI", "");
		const exit = vi
			.spyOn(process, "exit")
			.mockImplementation((code?: string | number | null): never => {
				throw new Error(`exit:${code ?? 0}`);
			});

		try {
			await withTempDir("interactive-value-drift", async (directory) => {
				const { plan } = await semanticFixture(directory);
				const drifted =
					'{\n\t"scripts": {\n\t\t"build": "changed-during-prompt",\n\t\t"dev": "vite --host"\n\t}\n}\n';
				promptMocks.select
					.mockImplementationOnce(async () => {
						await writeText(join(directory, "package.json"), drifted);
						return "user";
					})
					.mockResolvedValueOnce("forge");

				await expect(applyLifecyclePlan(directory, plan, {})).rejects.toThrow(
					"exit:1",
				);
				expect(await readFile(join(directory, "package.json"), "utf-8")).toBe(
					drifted,
				);
				expect(promptMocks.logSuccess).not.toHaveBeenCalled();
				expect(promptMocks.logError).toHaveBeenCalledWith(
					expect.stringContaining("Semantic merge conflicts were found:"),
				);
			});
		} finally {
			exit.mockRestore();
			restoreTTY();
		}
	});

	it("does not prompt for stale merge semantics", async () => {
		const restoreTTY = setTTY(true);
		vi.stubEnv("CI", "");
		const exit = vi
			.spyOn(process, "exit")
			.mockImplementation((code?: string | number | null): never => {
				throw new Error(`exit:${code ?? 0}`);
			});

		try {
			await withTempDir("interactive-stale-semantics", async (directory) => {
				const { plan } = await semanticFixture(directory);
				const lockPath = join(directory, ".forge/lock.json");
				const lock = await readFile(lockPath, "utf-8");
				await writeText(
					lockPath,
					lock.replace('"semanticsVersion": 1', '"semanticsVersion": 99'),
				);

				await expect(applyLifecyclePlan(directory, plan, {})).rejects.toThrow(
					"exit:1",
				);
				expect(promptMocks.select).not.toHaveBeenCalled();
				expect(promptMocks.logError).toHaveBeenCalledWith(
					"We couldn't apply this change. Forge cannot safely update these files:\npackage.json was modified after Forge last managed it.\nRun again with --keep-user to keep your edits, or --accept-forge to take Forge's changes.",
				);
			});
		} finally {
			exit.mockRestore();
			restoreTTY();
		}
	});

	it("renders defects with a friendly sentence and the defect", () => {
		const defect = new Error("apply defect");
		const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
		const exit = vi
			.spyOn(process, "exit")
			.mockImplementation((code?: string | number | null): never => {
				throw new Error(`exit:${code ?? 0}`);
			});

		try {
			expect(() => failureFromCause(Cause.die(defect))).toThrow("exit:1");
			expect(promptMocks.logError).toHaveBeenCalledWith(
				"We couldn't complete this command because an unexpected error occurred.",
			);
			expect(stderr).toHaveBeenCalledWith(defect);
		} finally {
			exit.mockRestore();
			stderr.mockRestore();
		}
	});

	it("renders a defect cause chain to stderr", () => {
		const source = new Error("source defect");
		const defect = new Error("outer defect", { cause: source });
		let rendered = "";
		const stderr = vi.spyOn(console, "error").mockImplementation((value) => {
			rendered += inspect(value);
		});
		const exit = vi
			.spyOn(process, "exit")
			.mockImplementation((code?: string | number | null): never => {
				throw new Error(`exit:${code ?? 0}`);
			});

		try {
			expect(() => failureFromCause(Cause.die(defect))).toThrow("exit:1");
			expect(rendered).toContain("outer defect");
			expect(rendered).toContain("source defect");
		} finally {
			exit.mockRestore();
			stderr.mockRestore();
		}
	});

	it("cancels mid-flow without changing the project", async () => {
		const restoreTTY = setTTY(true);
		vi.stubEnv("CI", "");
		const exit = vi
			.spyOn(process, "exit")
			.mockImplementation((code?: string | number | null): never => {
				throw new Error(`exit:${code ?? 0}`);
			});
		promptMocks.select
			.mockResolvedValueOnce("user")
			.mockResolvedValueOnce(promptMocks.cancelToken);

		try {
			await withTempDir("interactive-cancel", async (directory) => {
				const { plan, user } = await semanticFixture(directory);
				const lockBefore = await readFile(
					join(directory, ".forge/lock.json"),
					"utf-8",
				);

				await expect(applyLifecyclePlan(directory, plan, {})).rejects.toThrow(
					"exit:0",
				);
				expect(promptMocks.cancel).toHaveBeenCalledWith(
					"You've extinguished the forge.",
				);
				expect(await readFile(join(directory, "package.json"), "utf-8")).toBe(
					user,
				);
				expect(
					await readFile(join(directory, ".forge/lock.json"), "utf-8"),
				).toBe(lockBefore);
				expect(promptMocks.logSuccess).not.toHaveBeenCalled();
			});
		} finally {
			exit.mockRestore();
			restoreTTY();
		}
	});

	it("keeps the refusal path outside a TTY", async () => {
		const restoreTTY = setTTY(false);
		const exit = vi
			.spyOn(process, "exit")
			.mockImplementation((code?: string | number | null): never => {
				throw new Error(`exit:${code ?? 0}`);
			});

		try {
			await withTempDir("interactive-nontty", async (directory) => {
				const { plan } = await semanticFixture(directory);
				await expect(applyLifecyclePlan(directory, plan, {})).rejects.toThrow(
					"exit:1",
				);
				expect(promptMocks.select).not.toHaveBeenCalled();
				expect(promptMocks.logError).toHaveBeenCalledWith(
					expect.stringContaining(
						"We couldn't apply this change. Semantic merge conflicts were found:",
					),
				);
			});
		} finally {
			exit.mockRestore();
			restoreTTY();
		}
	});

	it("skips prompts when a policy flag is present or CI is set", async () => {
		const error = conflictError();
		expect(
			canResolveInteractively(error, { resolutionPolicy: "keep-user" }),
		).toBe(false);

		const restoreTTY = setTTY(true);
		vi.stubEnv("CI", "true");
		try {
			expect(isInteractiveLifecycleSession()).toBe(false);

			vi.stubEnv("CI", "");
			await withTempDir("interactive-policy", async (directory) => {
				const { plan } = await semanticFixture(directory);
				await applyLifecyclePlan(directory, plan, {
					resolutionPolicy: "accept-forge",
				});

				expect(promptMocks.select).not.toHaveBeenCalled();
				expect(
					JSON.parse(await readFile(join(directory, "package.json"), "utf-8")),
				).toEqual({
					scripts: {
						build: "tsc -b",
						dev: "vite --port 4000",
					},
				});
			});
		} finally {
			restoreTTY();
		}
	});

	it("never prompts for unmanaged files", () => {
		const error = conflictError();
		const preflight = error.preflight;
		if (preflight === undefined) throw new Error("Expected preflight details");

		expect(
			canResolveInteractively(
				new ApplyError({
					reason: error.reason,
					detail: error.message,
					path: error.path,
					preflight: { ...preflight, hasUnmanagedRefusals: true },
				}),
				{},
			),
		).toBe(false);
	});

	it("does not treat a resolvable unmanaged write as interactive", () => {
		const error = conflictError();
		const preflight = error.preflight;
		if (preflight === undefined) throw new Error("Expected preflight details");

		expect(
			canResolveInteractively(
				new ApplyError({
					reason: error.reason,
					detail: error.message,
					path: error.path,
					preflight: {
						...preflight,
						conflicts: [],
						hasConflicts: false,
						refusals: [
							{
								reason: "unmanaged-file-exists",
								operation: "write",
								path: "README.md",
								resolvable: true,
							},
						],
					},
				}),
				{},
			),
		).toBe(false);
	});

	it("never prompts for managed removals", () => {
		const error = conflictError();
		const preflight = error.preflight;
		if (preflight === undefined) throw new Error("Expected preflight details");

		expect(
			canResolveInteractively(
				new ApplyError({
					reason: "managed-file-modified",
					path: "README.md",
					preflight: {
						...preflight,
						conflicts: [],
						hasConflicts: false,
						hasManagedRemovals: true,
						refusals: [
							{
								reason: "managed-file-modified",
								operation: "removal",
								path: "README.md",
								resolvable: false,
							},
						],
					},
				}),
				{},
			),
		).toBe(false);
	});
});
