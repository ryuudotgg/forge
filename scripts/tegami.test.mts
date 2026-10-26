import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
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

function run(
	cwd: string,
	command: string,
	args: string[],
	extraEnv: Record<string, string> = {},
) {
	const result = spawnSync(command, args, {
		cwd,
		encoding: "utf8",
		env: { ...env, ...extraEnv },
	});

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

function note(cwd: string, overrides: Record<string, string> = {}) {
	const answers = {
		category: "fixed",
		title: "Yarn linker keeps its choice",
		bump: "patch",
		body: "`forge create` keeps the Yarn linker it was given.",
		...overrides,
	};

	return tegami(
		cwd,
		"note",
		...Object.entries(answers).flatMap(([name, value]) => [`--${name}`, value]),
	);
}

function changeFiles(cwd: string) {
	const dir = join(cwd, ".tegami");
	return existsSync(dir) ? readdirSync(dir).toSorted() : [];
}

describe("tegami note", () => {
	const today = () => new Date().toISOString().slice(0, 10);

	test("writes a dated change file the version run accepts", () => {
		const cwd = fixtureRepo();

		const result = note(cwd);
		assert.equal(result.status, 0, result.output);

		const path = `.tegami/${today()}-yarn-linker-keeps-its-choice.md`;
		assert.equal(result.stdout, path);
		assert.equal(
			readFileSync(join(cwd, path), "utf8"),
			changeFile(
				"### 🐛 Yarn linker keeps its choice",
				"`forge create` keeps the Yarn linker it was given.",
			),
		);

		const preview = tegami(cwd, "version", "--dry-run");
		assert.equal(preview.status, 0, preview.output);
		assert.match(preview.output, /@ryuugg\/forge: 0\.0\.0 -> 0\.0\.1/);
	});

	test("gives a second note on the same day and title its own file", () => {
		const cwd = fixtureRepo();

		assert.equal(note(cwd).status, 0);

		const second = note(cwd, { body: "A second paragraph of news." });
		assert.equal(second.status, 0, second.output);

		const first = `${today()}-yarn-linker-keeps-its-choice.md`;
		const copy = `${today()}-yarn-linker-keeps-its-choice-2.md`;
		assert.deepEqual(changeFiles(cwd), [first, copy].toSorted());
		assert.equal(second.stdout, `.tegami/${copy}`);
		assert.match(
			readFileSync(join(cwd, ".tegami", first), "utf8"),
			/keeps the Yarn linker/,
		);
	});

	const refused: [string, Record<string, string>, string][] = [
		["a body with a list", { body: "Body:\n- one\n- two" }, "holds a list"],
		[
			"an unknown category",
			{ category: "internal" },
			"needs a category of heads-up, new, improved, or fixed, not internal",
		],
		["an empty title", { title: "" }, "has a heading with no title"],
		[
			"an indented code block",
			{ body: "    first line\n    second line" },
			"holds a code block",
		],
	];

	for (const [name, overrides, problem] of refused)
		test(`refuses ${name} and writes nothing`, () => {
			const cwd = fixtureRepo();

			const result = note(cwd, overrides);
			assert.notEqual(result.status, 0, result.output);
			assert.ok(
				result.output.replace(/[│\s]+/g, " ").includes(problem),
				result.output,
			);

			assert.deepEqual(changeFiles(cwd), []);
		});

	test("asks for nothing and names the missing flags without a terminal", () => {
		const cwd = fixtureRepo();

		const result = tegami(cwd, "note", "--title", "Yarn linker");
		assert.notEqual(result.status, 0, result.output);
		assert.ok(
			result.output
				.replace(/[│\s]+/g, " ")
				.includes("Missing Note Flags: --category, --bump, and --body"),
			result.output,
		);

		assert.deepEqual(changeFiles(cwd), []);
	});
});

const fakeFetch = `import { appendFileSync } from "node:fs";

globalThis.fetch = async (input, init = {}) => {
	const url = new URL(String(input));
	const method = init.method ?? "GET";
	const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
	appendFileSync(process.env.FORGE_TEST_REQUESTS, \`\${JSON.stringify({ method, url: url.href, body })}\\n\`);

	if (url.host === "registry.npmjs.org") return new Response(null, { status: 404 });
	if (url.pathname.startsWith("/repos/ryuudotgg/forge/releases/tags/")) return new Response(null, { status: 404 });
	if (method === "POST" && url.pathname === "/repos/ryuudotgg/forge/releases") return Response.json({ id: 1 }, { status: 201 });

	return new Response(\`Unexpected Request: \${method} \${url.href}\`, { status: 500 });
};
`;

interface SentRequest {
	method: string;
	url: string;
	body?: { name?: string; body?: string; prerelease?: boolean };
}

function publish(cwd: string) {
	const sandbox = mkdtempSync(join(tmpdir(), "forge-tegami-publish-"));
	const origin = join(sandbox, "origin.git");
	const requests = join(sandbox, "requests.jsonl");

	write(sandbox, "fetch.mjs", fakeFetch);
	write(sandbox, "bin/pnpm", "#!/bin/sh\nexit 0\n");
	chmodSync(join(sandbox, "bin/pnpm"), 0o755);

	git(sandbox, "init", "--quiet", "--bare", origin);
	git(cwd, "remote", "add", "origin", origin);
	git(
		cwd,
		"config",
		`url.${origin}.insteadOf`,
		"https://x-access-token:fake@github.com/ryuudotgg/forge.git",
	);

	const result = run(
		cwd,
		process.execPath,
		["--import", join(sandbox, "fetch.mjs"), script, "publish"],
		{
			CI: "true",
			FORGE_TEST_REQUESTS: requests,
			GITHUB_TOKEN: "fake",
			PATH: `${join(sandbox, "bin")}:${process.env.PATH}`,
		},
	);

	const sent: SentRequest[] = existsSync(requests)
		? readFileSync(requests, "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line))
		: [];

	return { ...result, sent };
}

function releases(sent: SentRequest[]) {
	return sent.filter(
		({ method, url }) =>
			method === "POST" &&
			url === "https://api.github.com/repos/ryuudotgg/forge/releases",
	);
}

function versioned() {
	const cwd = fixtureRepo();

	write(
		cwd,
		".tegami/2026-10-01-yarn-hang.md",
		changeFile(
			"### 🐛 Yarn installs finish",
			"`forge create` no longer hangs when Yarn asks for a linker.",
		),
	);

	git(cwd, "add", "-A");
	git(cwd, "commit", "--quiet", "-m", "fix: stop the yarn hang (#57)");

	const result = tegami(cwd, "version");
	assert.equal(result.status, 0, result.output);

	git(cwd, "add", "-A");
	git(cwd, "commit", "--quiet", "-m", "chore: release");

	return cwd;
}

describe("tegami publish", () => {
	test("creates the GitHub release from the changelog section", () => {
		const cwd = versioned();
		const section = readFileSync(
			join(cwd, "packages/cli/CHANGELOG.md"),
			"utf8",
		);

		write(
			cwd,
			"packages/cli/CHANGELOG.md",
			`${section}\n## 0.0.0\n\nOlder notes.\n`,
		);

		git(cwd, "commit", "--quiet", "-am", "chore: keep older notes");

		const result = publish(cwd);
		assert.equal(result.status, 0, result.output);

		const [release, ...rest] = releases(result.sent);
		assert.ok(release, JSON.stringify(result.sent));
		assert.deepEqual(rest, []);

		assert.equal(
			release.body?.body,
			section.replace(/^## 0\.0\.1\n/, "").trim(),
		);

		assert.equal(release.body?.name, "@ryuugg/forge@0.0.1");
		assert.equal(release.body?.prerelease, false);
	});

	test("marks a prerelease version as a prerelease", () => {
		const cwd = versioned();
		const manifest = join(cwd, "packages/cli/package.json");
		const changelog = join(cwd, "packages/cli/CHANGELOG.md");

		write(
			cwd,
			"packages/cli/package.json",
			readFileSync(manifest, "utf8").replace("0.0.1", "0.1.0-beta.0"),
		);

		write(
			cwd,
			"packages/cli/CHANGELOG.md",
			readFileSync(changelog, "utf8").replace("## 0.0.1", "## 0.1.0-beta.0"),
		);

		git(cwd, "commit", "--quiet", "-am", "chore: enter beta");

		const result = publish(cwd);
		assert.equal(result.status, 0, result.output);

		const [release] = releases(result.sent);
		assert.ok(release, JSON.stringify(result.sent));
		assert.equal(release.body?.name, "@ryuugg/forge@0.1.0-beta.0");
		assert.equal(release.body?.prerelease, true);
		assert.equal(
			release.body?.body,
			readFileSync(changelog, "utf8")
				.replace(/^## 0\.1\.0-beta\.0\n/, "")
				.trim(),
		);
	});

	test("refuses a version with no changelog section before any request", () => {
		const cwd = versioned();

		write(cwd, "packages/cli/CHANGELOG.md", "## 0.0.0\n\nOlder notes.\n");
		git(cwd, "commit", "--quiet", "-am", "chore: drop the section");

		const result = publish(cwd);
		assert.notEqual(result.status, 0, result.output);
		assert.ok(
			result.output.includes(
				"Missing Changelog Section: @ryuugg/forge@0.0.1 has no ## 0.0.1",
			),
			result.output,
		);

		assert.deepEqual(result.sent, []);
	});
});
