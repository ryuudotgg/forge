import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Command as PlatformCommand } from "@effect/platform";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import gitInitStep from "../src/steps/post/git-init";
import installDepsStep from "../src/steps/post/install-deps";
import { SKIP } from "../src/steps/types";

const promptMocks = vi.hoisted(() => ({
	confirm: vi.fn(),
	isCancel: vi.fn(() => false),
	log: { warn: vi.fn() },
	spinner: vi.fn(),
	spinnerStart: vi.fn(),
	spinnerStop: vi.fn(),
	text: vi.fn(),
}));

const commandMocks = vi.hoisted(() => ({
	exitCode: vi.fn(),
	failCommit: false,
	string: vi.fn(),
}));

const cancelMocks = vi.hoisted(() => ({
	cancel: vi.fn((): never => {
		throw new Error("Cancelled");
	}),
}));

vi.mock("@clack/prompts", () => ({
	confirm: promptMocks.confirm,
	isCancel: promptMocks.isCancel,
	log: promptMocks.log,
	spinner: promptMocks.spinner,
	text: promptMocks.text,
}));

vi.mock("../src/utils/cancel", () => ({ cancel: cancelMocks.cancel }));

vi.mock("@effect/platform", async (importOriginal) => {
	const original = await importOriginal<typeof import("@effect/platform")>();

	commandMocks.string.mockImplementation((command: PlatformCommand.Command) =>
		commandMocks.failCommit &&
		command._tag === "StandardCommand" &&
		command.args[0] === "commit"
			? Effect.fail("fatal: unable to auto-detect email address")
			: original.Command.string(command),
	);

	return {
		...original,
		Command: {
			...original.Command,
			exitCode: commandMocks.exitCode,
			string: commandMocks.string,
		},
	};
});

const gitEnv = {
	GIT_AUTHOR_EMAIL: "forge@example.com",
	GIT_AUTHOR_NAME: "Forge Test",
	GIT_COMMITTER_EMAIL: "forge@example.com",
	GIT_COMMITTER_NAME: "Forge Test",
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_NOSYSTEM: "1",
};

async function withTempDir<T>(
	name: string,
	run: (directory: string) => Promise<T>,
) {
	const directory = await mkdtemp(join(tmpdir(), `forge-${name}-`));

	try {
		return await run(directory);
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
}

async function withGitEnv<T>(run: () => Promise<T>) {
	const previous = new Map(
		Object.keys(gitEnv).map((key) => [key, process.env[key]]),
	);

	Object.assign(process.env, gitEnv);

	try {
		return await run();
	} finally {
		for (const [key, value] of previous) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

function lastCommitSubject(directory: string): string {
	return execFileSync("git", ["log", "-1", "--format=%s"], {
		cwd: directory,
		encoding: "utf-8",
	}).trim();
}

beforeEach(() => {
	promptMocks.confirm.mockReset();
	promptMocks.isCancel.mockReset();
	promptMocks.isCancel.mockReturnValue(false);
	promptMocks.log.warn.mockReset();
	promptMocks.spinner.mockReset();
	promptMocks.spinnerStart.mockReset();
	promptMocks.spinnerStop.mockReset();
	promptMocks.text.mockReset();
	promptMocks.spinner.mockImplementation(() => ({
		message: vi.fn(),
		start: promptMocks.spinnerStart,
		stop: promptMocks.spinnerStop,
	}));
	commandMocks.exitCode.mockReset();
	commandMocks.exitCode.mockReturnValue(Effect.succeed(0));
	commandMocks.string.mockClear();
	commandMocks.failCommit = false;
	cancelMocks.cancel.mockClear();
});

describe("git init step", () => {
	it("initializes a repository with the default message when non-interactive", async () => {
		await withTempDir("git-init", async (directory) => {
			await writeFile(join(directory, "README.md"), "# Forge\n", "utf-8");

			await withGitEnv(async () => {
				await expect(
					gitInitStep.execute({ path: directory }, false),
				).resolves.toBe(SKIP);
			});

			expect(existsSync(join(directory, ".git"))).toBe(true);
			expect(lastCommitSubject(directory)).toBe(
				"chore: initialize repository via forge",
			);
		});
	});

	it("skips when gitInit is false", async () => {
		await withTempDir("git-init", async (directory) => {
			await expect(
				gitInitStep.execute({ gitInit: false, path: directory }, false),
			).resolves.toBe(SKIP);

			expect(existsSync(join(directory, ".git"))).toBe(false);
		});
	});

	it("commits with the custom message when interactive", async () => {
		await withTempDir("git-init", async (directory) => {
			await writeFile(join(directory, "README.md"), "# Forge\n", "utf-8");
			promptMocks.confirm.mockResolvedValue(true);
			promptMocks.text.mockResolvedValue("feat: custom");

			await withGitEnv(async () => {
				await gitInitStep.execute({ path: directory }, true);
			});

			expect(promptMocks.confirm).toHaveBeenCalledWith({
				message: "Do you want to initialize a Git Repository?",
				active: "Yes & Modify Message (Recommended)",
				inactive: "No",
			});
			expect(lastCommitSubject(directory)).toBe("feat: custom");
		});
	});

	it("falls back to the default message when the custom message is empty", async () => {
		await withTempDir("git-init", async (directory) => {
			await writeFile(join(directory, "README.md"), "# Forge\n", "utf-8");
			promptMocks.confirm.mockResolvedValue(true);
			promptMocks.text.mockResolvedValue("");

			await withGitEnv(async () => {
				await gitInitStep.execute({ path: directory }, true);
			});

			expect(lastCommitSubject(directory)).toBe(
				"chore: initialize repository via forge",
			);
		});
	});

	it("skips without initializing when the user declines", async () => {
		await withTempDir("git-init", async (directory) => {
			promptMocks.confirm.mockResolvedValue(false);

			await expect(
				gitInitStep.execute({ path: directory }, true),
			).resolves.toBe(SKIP);

			expect(promptMocks.text).not.toHaveBeenCalled();
			expect(existsSync(join(directory, ".git"))).toBe(false);
		});
	});

	it("cancels git init when the confirm prompt is interrupted", async () => {
		await withTempDir("git-init", async (directory) => {
			const sentinel = Symbol("cancel");
			promptMocks.confirm.mockResolvedValue(sentinel);
			promptMocks.isCancel.mockReturnValueOnce(true);

			await expect(
				gitInitStep.execute({ path: directory }, true),
			).rejects.toThrow("Cancelled");

			expect(cancelMocks.cancel).toHaveBeenCalledTimes(1);
			expect(promptMocks.text).not.toHaveBeenCalled();
		});
	});

	it("cancels git init when the message prompt is interrupted", async () => {
		await withTempDir("git-init", async (directory) => {
			const sentinel = Symbol("cancel");
			promptMocks.confirm.mockResolvedValue(true);
			promptMocks.text.mockResolvedValue(sentinel);
			promptMocks.isCancel.mockReturnValueOnce(false).mockReturnValueOnce(true);

			await expect(
				gitInitStep.execute({ path: directory }, true),
			).rejects.toThrow("Cancelled");

			expect(cancelMocks.cancel).toHaveBeenCalledTimes(1);
			expect(existsSync(join(directory, ".git"))).toBe(false);
		});
	});

	it("warns and resolves when the commit fails", async () => {
		await withTempDir("git-init-fail", async (directory) => {
			await writeFile(join(directory, "README.md"), "# Forge\n", "utf-8");
			commandMocks.failCommit = true;

			await withGitEnv(async () => {
				await expect(
					gitInitStep.execute({ path: directory }, false),
				).resolves.toBe(SKIP);
			});

			expect(promptMocks.log.warn).toHaveBeenCalledWith(
				"We couldn't create the initial commit, so set up git yourself when you're ready.",
			);
		});
	});
});

describe("install deps step", () => {
	it("skips without starting the spinner when installDeps is false", async () => {
		await expect(
			installDepsStep.execute({ installDeps: false }, false),
		).resolves.toBe(SKIP);

		expect(promptMocks.spinner).not.toHaveBeenCalled();
		expect(commandMocks.exitCode).not.toHaveBeenCalled();
	});

	it("skips without installing when the user declines", async () => {
		promptMocks.confirm.mockResolvedValue(false);

		await expect(
			installDepsStep.execute({ path: "./project" }, true),
		).resolves.toBe(SKIP);

		expect(promptMocks.confirm).toHaveBeenCalledWith({
			message: "Do you want to install dependencies with pnpm?",
			active: "Yes",
			inactive: "No",
		});
		expect(promptMocks.spinner).not.toHaveBeenCalled();
		expect(commandMocks.exitCode).not.toHaveBeenCalled();
	});

	it("cancels dependency installation when the prompt is interrupted", async () => {
		const sentinel = Symbol("cancel");
		promptMocks.confirm.mockResolvedValue(sentinel);
		promptMocks.isCancel.mockReturnValueOnce(true);

		await expect(
			installDepsStep.execute({ path: "./project" }, true),
		).rejects.toThrow("Cancelled");

		expect(cancelMocks.cancel).toHaveBeenCalledTimes(1);
		expect(commandMocks.exitCode).not.toHaveBeenCalled();
	});

	it("installs dependencies behind a spinner when the command succeeds", async () => {
		commandMocks.exitCode.mockReturnValue(Effect.succeed(0));

		await expect(
			installDepsStep.execute(
				{ packageManager: "pnpm", path: "./project" },
				false,
			),
		).resolves.toBe(SKIP);

		expect(commandMocks.exitCode).toHaveBeenCalledTimes(1);
		expect(promptMocks.spinnerStart).toHaveBeenCalledWith(
			"We're installing your dependencies...",
		);
		expect(promptMocks.spinnerStop).toHaveBeenCalledWith(
			"We've installed your dependencies!",
		);
	});

	it("warns and resolves when the install command exits non-zero (non-interactive)", async () => {
		commandMocks.exitCode.mockReturnValue(Effect.succeed(1));

		await expect(
			installDepsStep.execute(
				{ packageManager: "pnpm", path: "./project" },
				false,
			),
		).resolves.toBe(SKIP);

		expect(promptMocks.spinnerStop).toHaveBeenCalledWith(
			"We couldn't install your dependencies.",
		);
		expect(promptMocks.log.warn).toHaveBeenCalledWith(
			"The pnpm install didn't finish, so run it yourself inside the project when you're ready.",
		);
	});

	it("warns and resolves when the install command exits non-zero (interactive)", async () => {
		promptMocks.confirm.mockResolvedValue(true);
		commandMocks.exitCode.mockReturnValue(Effect.succeed(1));

		await installDepsStep.execute(
			{ packageManager: "pnpm", path: "./project" },
			true,
		);

		expect(promptMocks.spinnerStop).toHaveBeenCalledWith(
			"We couldn't install your dependencies.",
		);
		expect(promptMocks.log.warn).toHaveBeenCalledWith(
			"The pnpm install didn't finish, so run it yourself inside the project when you're ready.",
		);
	});
});
