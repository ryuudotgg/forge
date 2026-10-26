import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./tegami.mts", import.meta.url));

const env = Object.fromEntries(
	Object.entries(process.env).filter(
		([key]) => key !== "CI" && key !== "GITHUB_ACTIONS" && !/TOKEN/.test(key),
	),
);

function run(cwd: string, command: string, args: string[]) {
	const result = spawnSync(command, args, { cwd, encoding: "utf8", env });
	return {
		output: `${result.stdout}${result.stderr}`,
		status: result.status,
		stdout: result.stdout.trim(),
	};
}

function git(cwd: string, ...args: string[]) {
	const result = run(cwd, "git", args);
	assert.equal(result.status, 0, result.output);
	return result.stdout;
}

function write(cwd: string, path: string, content: string) {
	mkdirSync(dirname(join(cwd, path)), { recursive: true });
	writeFileSync(join(cwd, path), content);
}

function fixtureRepo() {
	const cwd = mkdtempSync(join(tmpdir(), "forge-tegami-"));

	write(
		cwd,
		"package.json",
		JSON.stringify({ name: "fixture", packageManager: "pnpm@12.15.0" }),
	);

	write(cwd, "pnpm-workspace.yaml", "packages:\n  - packages/*\n");
	write(
		cwd,
		"packages/cli/package.json",
		JSON.stringify({ name: "@ryuugg/forge", version: "0.0.0" }),
	);

	git(cwd, "init", "--quiet", "--initial-branch=main");
	git(cwd, "config", "user.name", "Forge Test");
	git(cwd, "config", "user.email", "test@forge.invalid");
	git(cwd, "config", "commit.gpgsign", "false");
	git(cwd, "config", "core.hooksPath", "/dev/null");

	git(cwd, "add", "-A");
	git(cwd, "commit", "--quiet", "-m", "chore: init");

	return cwd;
}

function changeFile(heading: string, body: string) {
	return `---\npackages:\n  "@ryuugg/forge": patch\n---\n\n${heading}\n\n${body}\n`;
}

function utcDate() {
	return new Intl.DateTimeFormat("en-US", {
		dateStyle: "long",
		timeZone: "UTC",
	}).format(new Date());
}

function tegami(cwd: string, ...args: string[]) {
	return run(cwd, process.execPath, [script, ...args]);
}

describe("tegami version", () => {
	test("renders change files in the pretty changelog shape", () => {
		const cwd = fixtureRepo();

		write(
			cwd,
			".tegami/2026-10-01-yarn-hang.md",
			changeFile(
				"### 🐛 Yarn installs finish",
				"`forge create` no longer hangs when Yarn\nasks for a linker.",
			),
		);

		git(cwd, "add", "-A");
		git(cwd, "commit", "--quiet", "-m", "fix: stop the yarn hang (#57)");

		write(
			cwd,
			".tegami/2026-10-02-faster-installs.md",
			changeFile(
				"### 🎨 Faster installs",
				"Scaffolded projects install in half the time.",
			),
		);

		git(cwd, "add", "-A");
		git(cwd, "commit", "--quiet", "-m", "feat: speed up installs");

		const sha = git(cwd, "rev-parse", "HEAD");
		const short = git(cwd, "rev-parse", "--short", "HEAD");

		const before = utcDate();
		const result = tegami(cwd, "version");
		assert.equal(result.status, 0, result.output);

		const changelog = readFileSync(
			join(cwd, "packages/cli/CHANGELOG.md"),
			"utf8",
		);

		const date = changelog.includes(`*${before}*`) ? before : utcDate();

		assert.equal(
			changelog,
			[
				"## 0.0.1",
				"",
				`*${date}*`,
				"",
				"### 🎨 Improved",
				"",
				`- **Faster installs** ([${short}](https://github.com/ryuudotgg/forge/commit/${sha}))\\`,
				"  Scaffolded projects install in half the time.",
				"",
				"### 🐛 Fixed",
				"",
				"- **Yarn installs finish** ([#57](https://github.com/ryuudotgg/forge/pull/57))\\",
				"  `forge create` no longer hangs when Yarn asks for a linker.",
				"",
			].join("\n"),
		);
	});

	test("links a renamed change file to the pull request that added it", () => {
		const cwd = fixtureRepo();

		write(
			cwd,
			".tegami/2026-10-01-draft.md",
			changeFile(
				"### 🐛 Yarn installs finish",
				"Wrapped lines stay one paragraph, see <https://forge.dev>.",
			),
		);
		git(cwd, "add", "-A");
		git(cwd, "commit", "--quiet", "-m", "fix: stop the yarn hang (#57)");

		git(cwd, "mv", ".tegami/2026-10-01-draft.md", ".tegami/2026-10-01-yarn.md");
		git(cwd, "commit", "--quiet", "-m", "chore: rename the change file");

		const result = tegami(cwd, "version");
		assert.equal(result.status, 0, result.output);

		assert.match(
			readFileSync(join(cwd, "packages/cli/CHANGELOG.md"), "utf8"),
			/\*\*Yarn installs finish\*\* \(\[#57\]\(https:\/\/github\.com\/ryuudotgg\/forge\/pull\/57\)\)\\\n {2}Wrapped lines stay one paragraph, see <https:\/\/forge\.dev>\.\n/,
		);
	});
});

const valid = "### 🐛 Yarn installs finish";

const refusals: [string, string, string][] = [
	[
		"a name outside the format",
		".tegami/Yarn_Hang.md",
		changeFile(valid, "Body."),
	],
	[
		"no heading",
		".tegami/2026-10-01-no-heading.md",
		'---\npackages:\n  "@ryuugg/forge": patch\n---\n\nJust a body.\n',
	],
	[
		"a heading with no category",
		".tegami/2026-10-01-no-category.md",
		changeFile("### Yarn installs finish", "Body."),
	],
	[
		"a heading other than ###",
		".tegami/2026-10-01-wrong-depth.md",
		changeFile("## 🐛 Yarn installs finish", "Body."),
	],
	[
		"a misspelled package",
		".tegami/2026-10-01-misspelled.md",
		changeFile(valid, "Body.").replace("@ryuugg/forge", "@ryugg/forge"),
	],
	[
		"a list",
		".tegami/2026-10-01-list.md",
		changeFile(valid, "Body:\n- one\n- two"),
	],
	[
		"a table",
		".tegami/2026-10-01-table.md",
		changeFile(valid, "| a | b |\n| - | - |\n| 1 | 2 |"),
	],
	[
		"a code block",
		".tegami/2026-10-01-code.md",
		changeFile(valid, "Run this:\n```sh\nforge create\n```"),
	],
	[
		"a second paragraph",
		".tegami/2026-10-01-paragraphs.md",
		changeFile(valid, "First paragraph.\n\nSecond paragraph."),
	],
	[
		"HTML after the first line",
		".tegami/2026-10-01-html.md",
		changeFile(valid, 'First line.\n<img src="x.png">'),
	],
];

describe("tegami refuses a change file outside the format", () => {
	for (const [name, path, content] of refusals)
		for (const args of [["version"], ["version", "--dry-run"]])
			test(`${name}, ${args.join(" ")}`, () => {
				const cwd = fixtureRepo();
				write(cwd, path, content);

				const result = tegami(cwd, ...args);
				assert.notEqual(result.status, 0, result.output);
				assert.ok(
					result.output.includes(`Invalid Change File: ${path}`),
					result.output,
				);
			});
});
