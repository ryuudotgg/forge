import { mkdir, readFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
	GitError,
	Subprocess,
	SubprocessError,
	trackedFiles,
	workingTreeStatus,
} from "../src/index";
import { withTempDir, writeText } from "./harness";

const gitLayer = Subprocess.Default.pipe(
	Layer.provideMerge(NodeServices.layer),
);

function git(root: string, args: ReadonlyArray<string>) {
	return Effect.runPromise(
		Subprocess.run({
			command: "git",
			args,
			cwd: root,
			timeoutMs: 10_000,
			outputMode: "capture",
		}).pipe(Effect.provide(gitLayer)),
	);
}

function status(root: string) {
	return Effect.runPromise(
		workingTreeStatus(root).pipe(Effect.provide(gitLayer)),
	);
}

function files(root: string) {
	return Effect.runPromise(trackedFiles(root).pipe(Effect.provide(gitLayer)));
}

async function commit(root: string) {
	await git(root, ["add", "."]);
	await git(root, [
		"-c",
		"user.name=Forge",
		"-c",
		"user.email=forge@example.com",
		"-c",
		"commit.gpgsign=false",
		"-c",
		"core.hooksPath=/dev/null",
		"commit",
		"-qm",
		"fixture",
	]);
}

async function repository(root: string) {
	await git(root, ["init", "-q"]);
	await writeText(join(root, "file.ts"), "export {};\n");
	await commit(root);
}

describe("project Git boundary", () => {
	it("keeps Forge bases byte identical when cloning with autocrlf", async () => {
		await withTempDir("git-base-autocrlf", async (directory) => {
			const root = join(directory, "repo");
			const destination = join(directory, "clone");
			await mkdir(root);
			await git(root, ["init", "-q"]);
			await writeText(
				join(root, ".gitattributes"),
				"# Forge state\n.forge/** -text\n",
			);

			await writeText(join(root, ".forge/bases/abc"), "a\nb\n");
			await writeText(join(root, "notes.txt"), "a\nb\n");
			await git(root, ["-c", "core.autocrlf=false", "add", "."]);
			await git(root, [
				"-c",
				"user.name=t",
				"-c",
				"user.email=t@t",
				"-c",
				"core.autocrlf=false",
				"-c",
				"commit.gpgsign=false",
				"-c",
				"core.hooksPath=/dev/null",
				"commit",
				"-qm",
				"fixture",
			]);

			await git(directory, [
				"-c",
				"core.autocrlf=true",
				"clone",
				root,
				destination,
			]);

			expect(
				await readFile(join(destination, ".forge/bases/abc"), "utf-8"),
			).toBe("a\nb\n");

			expect(await readFile(join(destination, "notes.txt"), "utf-8")).toBe(
				"a\r\nb\r\n",
			);
		});
	});

	it("formats the Git failure message exactly", () => {
		expect(
			new GitError({ root: "/project", detail: "permission denied" }).message,
		).toBe("Git Failed: permission denied");
	});

	it("fails with GitError when the working directory does not exist", async () => {
		await withTempDir("git-invalid-cwd", async (directory) => {
			const root = join(directory, "missing");
			const failure = await Effect.runPromise(
				workingTreeStatus(root).pipe(Effect.flip, Effect.provide(gitLayer)),
			);

			expect(failure).toBeInstanceOf(GitError);
			expect(failure.root).toBe(root);
			expect(failure.cause).toBeInstanceOf(SubprocessError);

			if (!(failure.cause instanceof SubprocessError))
				throw new Error("Expected subprocess failure");

			expect(failure.cause.reason).toBe("spawn-error");
			expect(failure.detail).toBe(failure.cause.message);
			expect(failure.message).toBe(`Git Failed: ${failure.cause.message}`);
		});
	});

	it("maps tracked-file failures outside a repository to GitError", async () => {
		await withTempDir("git-files-missing", async (root) => {
			const failure = await Effect.runPromise(
				trackedFiles(root).pipe(Effect.flip, Effect.provide(gitLayer)),
			);

			expect(failure).toBeInstanceOf(GitError);
			expect(failure.root).toBe(root);
			expect(failure.cause).toBeInstanceOf(SubprocessError);

			if (!(failure.cause instanceof SubprocessError))
				throw new Error("Expected subprocess failure");

			expect(failure.cause.reason).toBe("non-zero-exit");
			expect(failure.cause.exitCode).toBe(128);
			expect(failure.cause.detail).toBe(
				"fatal: not a git repository (or any of the parent directories): .git\n",
			);

			expect(failure.detail).toBe(failure.cause.message);
			expect(failure.message).toBe(
				"Git Failed: Subprocess Non-Zero Exit: git --no-optional-locks ls-files -s -z exited with code 128. fatal: not a git repository (or any of the parent directories): .git\n",
			);
		});
	});

	it("identifies a directory outside a repository", async () => {
		await withTempDir("git-missing", async (root) => {
			expect(await status(root)).toEqual({ _tag: "Untracked" });
		});
	});

	it("lists committed files in a clean repository", async () => {
		await withTempDir("git-clean", async (root) => {
			await repository(root);
			expect(await status(root)).toEqual({ _tag: "Clean" });
			expect(await files(root)).toEqual(["file.ts"]);
		});
	});

	it("detects untracked files", async () => {
		await withTempDir("git-untracked", async (root) => {
			await repository(root);
			await writeText(join(root, "untracked.ts"), "export {};\n");

			expect(await status(root)).toEqual({ _tag: "Dirty" });
			expect(await files(root)).toEqual(["file.ts"]);
		});
	});

	it("detects modified tracked files", async () => {
		await withTempDir("git-modified", async (root) => {
			await repository(root);
			await writeText(join(root, "file.ts"), "export const changed = true;\n");
			expect(await status(root)).toEqual({ _tag: "Dirty" });
		});
	});

	it("drops deleted tracked files", async () => {
		await withTempDir("git-deleted", async (root) => {
			await repository(root);
			await rm(join(root, "file.ts"));
			expect(await files(root)).toEqual([]);
		});
	});

	it("drops tracked symlinks and preserves unusual path names", async () => {
		await withTempDir("git-paths", async (root) => {
			await repository(root);
			await symlink("file.ts", join(root, "link.ts"));
			await writeText(join(root, "-space\tline\n.ts"), "export {};\n");
			await commit(root);

			expect(await files(root)).toEqual(["-space\tline\n.ts", "file.ts"]);
		});
	});

	it("treats a project its enclosing repository ignores as untracked", async () => {
		await withTempDir("git-ignored", async (root) => {
			await writeText(join(root, ".gitignore"), "project/\n");
			await repository(root);
			const project = join(root, "project");
			await mkdir(project);
			await writeText(join(project, "inside.ts"), "export {};\n");

			expect(await status(project)).toEqual({ _tag: "Untracked" });
		});
	});

	it("ignores changes outside the project subdirectory", async () => {
		await withTempDir("git-subdirectory", async (root) => {
			await repository(root);
			const project = join(root, "project");
			await mkdir(project);
			await writeText(join(project, "inside.ts"), "export {};\n");
			await commit(root);

			await writeText(join(root, "file.ts"), "changed\n");
			await writeText(join(root, "outside.ts"), "export {};\n");

			expect(await status(project)).toEqual({ _tag: "Clean" });
			expect(await files(project)).toEqual(["inside.ts"]);
		});
	});
});
