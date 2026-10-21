import { join } from "node:path";
import { Effect, FileSystem, Schema } from "effect";
import { type DirectoryMove, relocatePath } from "./relocation";
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
	| {
			readonly _tag: "Dirty";
			readonly paths?: ReadonlyArray<string>;
			readonly renamedPaths?: ReadonlyArray<string>;
	  }
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

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function withoutPrefix(path: string, prefix: string): string {
	return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

const lockfiles = [
	"pnpm-lock.yaml",
	"package-lock.json",
	"yarn.lock",
	"bun.lock",
	"bun.lockb",
];

export function workingTreeStatus(
	root: string,
	excludedPaths?: ReadonlyArray<string>,
) {
	return Effect.gen(function* () {
		const tracked = yield* git(root, ["ls-files", "-z", "--", "."]);
		if (tracked.output.length === 0)
			return { _tag: "Untracked" } satisfies WorkingTreeStatus;

		const changes = yield* git(root, [
			"status",
			"--porcelain=v1",
			"-z",
			"--untracked-files=normal",
			"--",
			".",
			...(excludedPaths ?? []).map((path) => `:(exclude)${path}`),
		]);

		if (changes.output.length > 0) {
			if (excludedPaths === undefined)
				return { _tag: "Dirty" } satisfies WorkingTreeStatus;

			const prefix = (yield* git(root, [
				"rev-parse",
				"--show-prefix",
			])).output.trimEnd();

			const entries = changes.output.split("\0");
			const paths: string[] = [];
			const renamedPaths: string[] = [];
			for (let index = 0; index < entries.length; index += 1) {
				const entry = entries[index];
				if (entry === undefined || entry === "") continue;

				paths.push(withoutPrefix(entry.slice(3), prefix));

				if (
					entry.slice(0, 2).includes("R") ||
					entry.slice(0, 2).includes("C")
				) {
					renamedPaths.push(paths.at(-1) ?? "");
					index += 1;
					const source = entries[index];
					if (source !== undefined) {
						paths.push(withoutPrefix(source, prefix));
						renamedPaths.push(paths.at(-1) ?? "");
					}
				}
			}

			return {
				_tag: "Dirty",
				paths: [...new Set(paths)],
				...(renamedPaths.length === 0
					? {}
					: { renamedPaths: [...new Set(renamedPaths)] }),
			} satisfies WorkingTreeStatus;
		}

		return { _tag: "Clean" } satisfies WorkingTreeStatus;
	}).pipe(
		Effect.map((status): WorkingTreeStatus => status),
		Effect.catchTag("SubprocessError", (cause) =>
			cause.reason === "non-zero-exit" &&
			cause.detail?.includes("not a git repository")
				? Effect.succeed<WorkingTreeStatus>({ _tag: "Untracked" })
				: Effect.fail(new GitError({ root, detail: cause.message, cause })),
		),
	);
}

export interface ReferenceToken {
	readonly previous: string;
	readonly next: string;
}

export interface ReferenceHit {
	readonly path: string;
	readonly line: number;
	readonly token: string;
	readonly replacement: string;
	readonly env: boolean;
}

export function referenceHits(
	path: string,
	line: number,
	text: string,
	tokens: ReadonlyArray<ReferenceToken>,
	env = false,
): ReferenceHit[] {
	return tokens
		.filter((token) => {
			const escaped = escapeRegex(token.previous);
			const packageToken = token.previous.startsWith("@");
			return new RegExp(
				packageToken
					? `(?<![a-zA-Z0-9_@/.-])${escaped}(?![a-zA-Z0-9_.-])`
					: `(?<![a-zA-Z0-9_@-])${escaped}(?![a-zA-Z0-9_-]|\\.[a-zA-Z0-9_-])`,
			).test(text);
		})
		.map((token) => ({
			path,
			line,
			token: token.previous,
			replacement: token.next,
			env,
		}));
}

export function trackedReferenceHits(
	root: string,
	tokens: ReadonlyArray<ReferenceToken>,
	moves: ReadonlyArray<DirectoryMove> = [],
) {
	if (tokens.length === 0) return Effect.succeed<ReferenceHit[]>([]);

	return Effect.gen(function* () {
		const result = yield* git(root, [
			"grep",
			"-n",
			"-I",
			"-z",
			"-F",
			...tokens.flatMap((token) => ["-e", token.previous]),
			"--",
			".",
			":(exclude).forge/**",
			...lockfiles.flatMap((name) => [
				`:(exclude)${name}`,
				`:(exclude)**/${name}`,
			]),
		]).pipe(
			Effect.catchTag("SubprocessError", (cause) =>
				cause.exitCode === 1
					? Effect.succeed({ exitCode: 1, output: "" })
					: Effect.fail(cause),
			),
		);

		const hits = [
			...result.output.matchAll(/([^\0]+)\0(\d+)\0([^\n]*)\n/g),
		].flatMap((match) => {
			const path = match[1];
			const line = match[2];
			const text = match[3];
			return path === undefined || line === undefined || text === undefined
				? []
				: referenceHits(path, Number(line), text, tokens);
		});

		if (moves.length === 0) return hits;

		const fs = yield* FileSystem.FileSystem;
		const tracked = yield* git(root, [
			"ls-files",
			"-z",
			"--",
			".",
			":(exclude).forge/**",
			...lockfiles.flatMap((name) => [
				`:(exclude)${name}`,
				`:(exclude)**/${name}`,
			]),
		]);

		const changes = new Map(moves.map((move) => [move.moduleId, move]));
		for (const path of tracked.output.split("\0")) {
			const relocated = relocatePath(path, changes);
			if (
				path === relocated ||
				(yield* fs.exists(join(root, path))) ||
				!(yield* fs.exists(join(root, relocated)))
			)
				continue;

			const content = yield* fs.readFileString(join(root, relocated));
			if (content.includes("\0")) continue;

			hits.push(
				...content
					.split("\n")
					.flatMap((text, index) =>
						referenceHits(relocated, index + 1, text, tokens),
					),
			);
		}

		return hits;
	}).pipe(
		Effect.mapError(
			(cause) => new GitError({ root, detail: cause.message, cause }),
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
