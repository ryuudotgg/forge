import { join } from "node:path";
import { Effect, FileSystem, Schema } from "effect";
import { PROBE_TIMEOUT_MS, Subprocess } from "./subprocess";

export class GitError extends Schema.TaggedError<GitError>()("GitError", {
	root: Schema.String,
	detail: Schema.String,
	cause: Schema.optional(Schema.Defect()),
}) {
	override get message() {
		return `Git Failed: ${this.detail}`;
	}
}

export type WorkingTreeStatus =
	| { readonly _tag: "Clean" }
	| { readonly _tag: "Dirty" }
	| { readonly _tag: "Untracked" };

function git(root: string, args: ReadonlyArray<string>) {
	return Subprocess.run({
		command: "git",
		args: ["--no-optional-locks", ...args],
		cwd: root,
		env: { LC_ALL: "C" },
		timeoutMs: PROBE_TIMEOUT_MS,
		outputMode: "capture",
	});
}

export function workingTreeStatus(root: string) {
	return Effect.gen(function* () {
		const changes = yield* git(root, [
			"status",
			"--porcelain=v1",
			"-z",
			"--untracked-files=normal",
			"--",
			".",
		]);

		if (changes.output.length > 0)
			return { _tag: "Dirty" } satisfies WorkingTreeStatus;

		const tracked = yield* git(root, ["ls-files", "-z", "--", "."]);

		return {
			_tag: tracked.output.length > 0 ? "Clean" : "Untracked",
		} satisfies WorkingTreeStatus;
	}).pipe(
		Effect.catchTag("SubprocessError", (cause) =>
			cause.reason === "non-zero-exit" &&
			cause.detail?.includes("not a git repository")
				? Effect.succeed<WorkingTreeStatus>({ _tag: "Untracked" })
				: Effect.fail(new GitError({ root, detail: cause.message, cause })),
		),
	);
}

export function trackedFiles(root: string) {
	return Effect.gen(function* () {
		const fileSystem = yield* FileSystem.FileSystem;
		const result = yield* git(root, ["ls-files", "-s", "-z"]);

		const paths = result.output.split("\0").flatMap((entry) => {
			const separator = entry.indexOf("\t");
			const mode = entry.slice(0, 6);
			return separator >= 0 && (mode === "100644" || mode === "100755")
				? [entry.slice(separator + 1)]
				: [];
		});

		return yield* Effect.filter([...new Set(paths)], (path) =>
			fileSystem.exists(join(root, path)),
		);
	}).pipe(
		Effect.mapError(
			(cause) => new GitError({ root, detail: cause.message, cause }),
		),
	);
}
