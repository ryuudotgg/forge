import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { select, text } from "@clack/prompts";
import type {
	BumpType,
	Draft,
	LogGenerator,
	PackageGraph,
	TegamiContext,
	TegamiPlugin,
	WorkspacePackage,
} from "tegami";
import { tegami } from "tegami";
import { runCli } from "tegami/cli";
import { github } from "tegami/plugins/github";
import { isCI } from "tegami/utils";

const [command, ...flags] = process.argv.slice(2);
let applied = false;

const repo = "https://github.com/ryuudotgg/forge";

interface Category {
	emoji: string;
	label: string;
}

const categories: Category[] = [
	{ emoji: "🚨", label: "Heads up" },
	{ emoji: "✨", label: "New" },
	{ emoji: "🎨", label: "Improved" },
	{ emoji: "🐛", label: "Fixed" },
];

interface Note {
	category: Category;
	title: string;
	body: string;
	reference: string;
}

const notes = new Map<string, Note>();

const changeFileName = /^(\d{4}-\d{2}-\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const frontmatter = /^---\r?\n.+?\r?\n---\r?\n?/s;
const heading = /^ {0,3}(#{1,6})(?:[ \t]+|$)(.*)$/;

const paragraphBreaks: [RegExp, string][] = [
	[heading, "holds a second heading"],
	[/^ {0,3}(?:`{3,}|~{3,})/, "holds a code block"],
	[/^ {0,3}(?:[-+*]|1[.)])[ \t]+\S/, "holds a list"],
	[/^ {0,3}>/, "holds a blockquote"],
	[/^(?=[^|]*\|)(?=[^-]*-)[\s|:-]+$/, "holds a table"],
	[/^ {0,3}(?:(?:[-*_][ \t]*){3,}|=+[ \t]*|-+[ \t]*)$/, "holds a rule"],
	[/^ {0,3}<(?:[A-Za-z][\w-]*(?:[\s/>]|$)|\/[A-Za-z]|!)/, "holds HTML"],
	[/\\$/, "ends a line with a backslash"],
	[/^\s*$/, "holds a second paragraph"],
];

const blockOpenings: [RegExp, string][] = [
	[/^ {0,3}\d{1,9}[.)](?:[ \t]|$)/, "holds a list"],
	[/^(?: {4}|\t)/, "holds a code block"],
];

const emojiList = new Intl.ListFormat("en", { type: "disjunction" }).format(
	categories.map(({ emoji }) => emoji),
);

function categoryPrefix(emoji: string) {
	return new RegExp(`^${emoji}\\uFE0F?(?:[ \\t]+|$)`, "u");
}

type Fail = (problem: string) => never;

function invalid(filename: string): Fail {
	return (problem) => {
		throw new Error(`Invalid Change File: .tegami/${filename} ${problem}`);
	};
}

function topic(text: string) {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

function isCalendarDate(date: string) {
	const parsed = new Date(`${date}T00:00:00Z`);
	return (
		!Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date)
	);
}

function checkName(filename: string, fail: Fail) {
	const date = changeFileName.exec(filename)?.[1];
	if (!date || !isCalendarDate(date))
		fail("is not named <YYYY-MM-DD>-<lowercase-hyphenated-topic>.md");
}

function parseChangeFile(filename: string, content: string) {
	const fail = invalid(filename);
	checkName(filename, fail);
	return parseEntry(content, fail);
}

function parseEntry(content: string, fail: Fail) {
	const [first = "", ...rest] = content
		.replace(frontmatter, "")
		.trim()
		.split(/\r?\n/);

	const match = heading.exec(first);
	if (!match) return fail("does not open with a ### heading");
	if (match[1] !== "###") fail(`opens with a ${match[1]} heading, not ###`);

	const text = (match[2] ?? "").replace(/[ \t]+#+[ \t]*$/, "");
	const category = categories.find(({ emoji }) =>
		categoryPrefix(emoji).test(text),
	);

	if (!category)
		return fail(`has a heading that does not start with ${emojiList}`);

	const title = text.replace(categoryPrefix(category.emoji), "").trim();
	if (!title) fail("has a heading with no title");
	if (title.includes("*")) fail("has an asterisk in its title");

	const body = rest
		.join("\n")
		.replace(/^(?:[ \t]*\r?\n)+/, "")
		.trimEnd()
		.split(/\r?\n/);

	const [opening] = body;
	if (!opening) return fail("has no body under its heading");

	for (const [pattern, problem] of blockOpenings)
		if (pattern.test(opening)) fail(problem);

	for (const [pattern, problem] of paragraphBreaks)
		if (body.some((line) => pattern.test(line))) fail(problem);

	return {
		body: body.map((line) => line.trim()).join(" "),
		category,
		title,
	};
}

const bumps: BumpType[] = ["patch", "minor", "major"];

function choiceList(choices: string[]) {
	return new Intl.ListFormat("en", { type: "disjunction" }).format(choices);
}

const categoryFlags = choiceList(categories.map(({ label }) => topic(label)));

interface NoteAnswers {
	category?: string;
	title?: string;
	bump?: string;
	body?: string;
}

function answered(value: string | symbol) {
	if (typeof value === "symbol")
		throw new Error("Note Cancelled: no change file written");

	return value;
}

async function askMissing(answers: NoteAnswers): Promise<NoteAnswers> {
	const missing = Object.entries({
		category: answers.category,
		title: answers.title,
		bump: answers.bump,
		body: answers.body,
	}).flatMap(([name, value]) => (value === undefined ? [`--${name}`] : []));

	if (missing.length === 0) return answers;

	if (!process.stdin.isTTY)
		throw new Error(
			`Missing Note Flags: ${new Intl.ListFormat("en").format(missing)}, since there is no terminal to ask in`,
		);

	const category =
		answers.category ??
		answered(
			await select({
				message: "Which category is the change?",
				options: categories.map(({ emoji, label }) => ({
					value: topic(label),
					label: `${emoji} ${label}`,
				})),
			}),
		);

	const title =
		answers.title ??
		answered(await text({ message: "What is the title of the change?" }));

	const bump =
		answers.bump ??
		answered(
			await select({
				message: "Which bump does @ryuugg/forge take?",
				options: bumps.map((value) => ({ value, label: value })),
			}),
		);

	const body =
		answers.body ??
		answered(
			await text({ message: "Describe the change in one plain paragraph." }),
		);

	return { category, title, bump, body };
}

function writeNote(changelogDir: string, answers: NoteAnswers) {
	const fail: Fail = (problem) => {
		throw new Error(`Invalid Note: the change file ${problem}`);
	};

	const category = categories.find(
		({ label }) => topic(label) === answers.category,
	);

	if (!category)
		return fail(
			`needs a category of ${categoryFlags}, not ${answers.category}`,
		);

	const bump = bumps.find((value) => value === answers.bump);
	if (!bump)
		return fail(`needs a bump of ${choiceList(bumps)}, not ${answers.bump}`);

	const title = answers.title?.trim() ?? "";
	if (/[\r\n]/.test(title)) fail("has a title that spans more than one line");

	const content = `---\npackages:\n  "@ryuugg/forge": ${bump}\n---\n\n### ${category.emoji} ${title}\n\n${answers.body?.trimEnd() ?? ""}\n`;
	parseEntry(content, fail);

	const name = topic(title);
	if (!name) fail("has a title with no letter or digit to name the file by");

	const date = new Date().toISOString().slice(0, 10);
	checkName(`${date}-${name}.md`, fail);

	mkdirSync(changelogDir, { recursive: true });

	for (let copy = 1; ; copy++) {
		const filename = `${date}-${name}${copy === 1 ? "" : `-${copy}`}.md`;

		try {
			writeFileSync(join(changelogDir, filename), content, { flag: "wx" });
			return filename;
		} catch (error) {
			if (
				!(error instanceof Error && "code" in error && error.code === "EEXIST")
			)
				throw error;
		}
	}
}

function reference({ cwd, changelogDir }: TegamiContext, filename: string) {
	const result = spawnSync(
		"git",
		[
			"log",
			"--follow",
			"--diff-filter=A",
			"--format=%H%x1f%h%x1f%s",
			"--",
			relative(cwd, join(changelogDir, filename)),
		],
		{ cwd, encoding: "utf8" },
	);

	if (result.status !== 0)
		throw new Error(`Git Log Failed: ${result.stderr?.trim() ?? result.error}`);

	const added = result.stdout.split("\n")[0];
	if (!added) return "";

	const [sha = "", short = "", subject = ""] = added.split("\x1f");

	const pr = /\(#(\d+)\)$/.exec(subject)?.[1];
	if (pr) return ` ([#${pr}](${repo}/pull/${pr}))`;

	return ` ([${short}](${repo}/commit/${sha}))`;
}

function readNotes(context: TegamiContext, draft: Draft) {
	const { changelogDir } = context;
	const files = existsSync(changelogDir)
		? readdirSync(changelogDir).filter((name) => name.endsWith(".md"))
		: [];

	const attached = new Set(
		[...draft.getPackageDrafts().values()].flatMap(({ changelogs = [] }) =>
			changelogs.map(({ filename }) => filename),
		),
	);

	for (const file of files) {
		const note = parseChangeFile(
			file,
			readFileSync(join(changelogDir, file), "utf8"),
		);

		if (!attached.has(file))
			invalid(file)("names no workspace package and bump that Tegami can read");

		notes.set(file, { ...note, reference: reference(context, file) });
	}
}

const releaseDate = new Intl.DateTimeFormat("en-US", {
	dateStyle: "long",
	timeZone: "UTC",
});

const changelog: LogGenerator = {
	generate({ pkg, packageDraft }) {
		const entries = (packageDraft.changelogs ?? [])
			.map(({ filename }) => filename)
			.toSorted()
			.flatMap((filename) => notes.get(filename) ?? []);

		const sections = categories.flatMap((category) => {
			const items = entries.filter((entry) => entry.category === category);
			if (items.length === 0) return [];

			return [
				`### ${category.emoji} ${category.label}`,
				"",
				...items.map(
					({ title, reference, body }) =>
						`- **${title}**${reference}\\\n  ${body}`,
				),
				"",
			];
		});

		return [
			`## ${pkg.version}`,
			"",
			`*${releaseDate.format(new Date())}*`,
			"",
			...sections,
		].join("\n");
	},
};

function forge(): TegamiPlugin {
	return {
		name: "forge",
		enforce: "pre",
		initPublishPlan({ plan }) {
			for (const [id, packagePlan] of plan.packages) {
				const pkg = this.graph.get(id);
				if (pkg?.version)
					packagePlan.git = { ...packagePlan.git, tag: `v${pkg.version}` };
			}
		},
		initCli(cli) {
			cli
				.command("note", {
					description:
						"write a change file, asking for anything not passed as a flag",
				})
				.option("category", {
					type: "string",
					description: categoryFlags,
				})
				.option("title", { type: "string", description: "the entry title" })
				.option("bump", { type: "string", description: choiceList(bumps) })
				.option("body", {
					type: "string",
					description: "one plain paragraph",
				})
				.action(async ({ context, values }) => {
					const filename = writeNote(
						context.changelogDir,
						await askMissing(values),
					);

					console.log(
						relative(context.cwd, join(context.changelogDir, filename)),
					);
				});
		},
		afterPreflight({ plan }) {
			for (const pkg of plan.getPackagesToPublish())
				changelogSection(this, pkg);
		},
		initCliDraft(draft) {
			readNotes(this, draft);

			if (command === "version" && !draft.hasPending())
				throw new Error(
					"No Pending Change Files: add one under .tegami/ naming @ryuugg/forge",
				);
		},
		applyCliDraft() {
			applied = true;
		},
		beforePublishAll({ plan }) {
			if (!plan.options.dryRun && !isCI())
				throw new Error(
					"Publish Outside CI: the Publish workflow on main is the only publisher",
				);
		},
		willPublish({ pkg }) {
			const result = spawnSync(
				"pnpm",
				["exec", "turbo", "run", "build", "--filter", pkg.name],
				{ cwd: this.cwd, stdio: "inherit" },
			);

			if (result.status !== 0) throw new Error(`Build Failed: ${pkg.name}`);
		},
	};
}

function changelogSection(
	{ cwd }: TegamiContext,
	{ name, path, version }: WorkspacePackage,
) {
	const file = join(path, "CHANGELOG.md");
	const lines = existsSync(file)
		? readFileSync(file, "utf8").split(/\r?\n/)
		: [];

	const start = lines.indexOf(`## ${version}`);
	if (start === -1)
		throw new Error(
			`Missing Changelog Section: ${name}@${version} has no ## ${version} in ${relative(cwd, file)}`,
		);

	const end = lines.findIndex(
		(line, index) => index > start && line.startsWith("## "),
	);

	return lines
		.slice(start + 1, end === -1 ? undefined : end)
		.join("\n")
		.trim();
}

function releaseTitle(graph: PackageGraph) {
	return `chore: release ${graph.getByName("@ryuugg/forge")[0]?.version}`;
}

const paper = tegami({
	generator: changelog,
	npm: {
		client: "pnpm",
		trustedPublish: { provider: "github", workflow: "publish.yml" },
	},
	plugins: [
		github({
			repo: "ryuudotgg/forge",
			release: {
				create({ pkg }) {
					return { notes: changelogSection(this, pkg) };
				},
			},
			versionPr: {
				create() {
					return { title: releaseTitle(this.graph) };
				},
				commit({ type }) {
					if (type === "version-packages")
						return { title: releaseTitle(this.graph) };
				},
			},
		}),
		forge(),
	],
});

async function previewVersion() {
	const context = await paper._internal.context();
	const draft = await paper.draft();
	readNotes(context, draft);

	for (const pkg of context.graph.getPackages()) {
		const bumped = draft.getPackageDraft(pkg.id)?.bumpVersion(pkg);
		if (pkg.version && bumped && bumped !== pkg.version)
			console.log(`${pkg.id}: ${pkg.version} -> ${bumped}`);
	}
}

if (command === "version" && flags.includes("--dry-run"))
	await previewVersion().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
else await runCli(paper);

if (command === "version" && !flags.includes("--dry-run") && !applied) {
	console.error("No Publish Lock: tegami version wrote nothing");
	process.exitCode = 1;
}
