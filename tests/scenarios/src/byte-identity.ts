import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { parseArgs, TextDecoder } from "node:util";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readObject(content: string, path: string): Record<string, unknown> {
	const value: unknown = JSON.parse(content);
	if (!isRecord(value)) throw new Error(`Invalid JSON Object: ${path}`);
	return value;
}

function sha256(content: Uint8Array): string {
	return createHash("sha256").update(content).digest("hex");
}

function textContent(content: Uint8Array): string | undefined {
	if (content.includes(0)) return undefined;

	try {
		return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
			content,
		);
	} catch {
		return undefined;
	}
}

async function projectFiles(
	root: string,
	prefix = "",
): Promise<Map<string, Buffer>> {
	const files = new Map<string, Buffer>();
	const entries = await readdir(join(root, prefix), { withFileTypes: true });
	for (const entry of entries) {
		const path = join(prefix, entry.name);
		if (entry.isDirectory())
			for (const [nestedPath, content] of await projectFiles(root, path))
				files.set(nestedPath, content);
		else if (entry.isFile()) files.set(path, await readFile(join(root, path)));
		else throw new Error(`Unsupported Project Entry: ${path}`);
	}

	return files;
}

function idReplacements(
	path: string,
	modules: ReadonlyArray<{ id: string; root: string }>,
): Array<readonly [string, string]> {
	if (path === join(".forge", "manifest.json"))
		return modules.flatMap(({ id, root }) => [
			[`"${id}": {`, `"${root}": {`],
			[`"moduleId": "${id}"`, `"moduleId": "${root}"`],
		]);

	if (path === join(".forge", "lock.json"))
		return modules.map(({ id, root }) => [
			`"module:${id}:`,
			`"module:${root}:`,
		]);

	return modules
		.filter(({ root }) => path === join(root, "forge.json"))
		.map(({ id, root }) => [`"id": "${id}"`, `"id": "${root}"`]);
}

async function normalizedProject(root: string): Promise<Map<string, Buffer>> {
	const files = await projectFiles(root);
	const manifestPath = join(".forge", "manifest.json");
	const manifestContent = files.get(manifestPath);
	if (manifestContent === undefined)
		throw new Error(`Missing Manifest: ${root}`);

	const manifest = readObject(manifestContent.toString("utf-8"), manifestPath);
	const modules = manifest.modules;
	if (!isRecord(modules)) throw new Error(`Invalid Manifest Modules: ${root}`);

	const moduleRoots = Object.entries(modules).map(([id, module]) => {
		if (!isRecord(module) || typeof module.root !== "string")
			throw new Error(`Missing Module Root: ${id}`);

		return { id, root: module.root };
	});

	const normalizedFiles = new Map<string, Buffer>();
	const hashes = new Map<string, string>();
	const envHashes = new Set<string>();
	for (const [path, rawContent] of files) {
		if (basename(path) === ".env") {
			envHashes.add(sha256(rawContent));
			continue;
		}

		let text = textContent(rawContent);
		if (text !== undefined)
			for (const [id, root] of idReplacements(path, moduleRoots))
				text = text.replaceAll(id, root);

		const content = text === undefined ? rawContent : Buffer.from(text);
		normalizedFiles.set(path, content);
		hashes.set(sha256(rawContent), sha256(content));
	}

	for (const hash of envHashes) hashes.set(hash, "0".repeat(64));

	const result = new Map<string, Buffer>();
	for (const [path, content] of normalizedFiles) {
		if (
			path.startsWith(`${join(".forge", "bases")}/`) &&
			envHashes.has(basename(path))
		)
			continue;

		const normalizedPath = path.startsWith(`${join(".forge", "bases")}/`)
			? path.replace(
					/\b[0-9a-f]{64}\b/gi,
					(hash) => hashes.get(hash.toLowerCase()) ?? hash,
				)
			: path;

		const text = textContent(content);
		const normalizedContent =
			path.startsWith(".forge/") && text !== undefined
				? Buffer.from(
						text.replace(
							/\b[0-9a-f]{64}\b/gi,
							(hash) => hashes.get(hash.toLowerCase()) ?? hash,
						),
					)
				: content;

		const existing = result.get(normalizedPath);
		if (existing !== undefined && !existing.equals(normalizedContent))
			throw new Error(`Normalized File Collision: ${normalizedPath}`);

		result.set(normalizedPath, normalizedContent);
	}

	return result;
}

async function generateProject(
	cli: string,
	directory: string,
	config: Record<string, unknown>,
): Promise<string> {
	await mkdir(directory, { recursive: true });

	const projectRoot = join(directory, "project");
	const configPath = join(directory, "forge.config.json");
	await writeFile(
		configPath,
		`${JSON.stringify({ ...config, path: "./project" }, null, "\t")}\n`,
	);

	const result = spawnSync(
		process.execPath,
		[cli, "create", "--config", configPath, "--no-install", "--no-git"],
		{
			cwd: directory,
			env: {
				...process.env,
				CI: "true",
				FORCE_COLOR: "0",
				FORGE_CACHE_DIR: join(directory, ".cache/forge"),
				XDG_CACHE_HOME: join(directory, ".cache/xdg"),
			},
			encoding: "utf-8",
			maxBuffer: 16 * 1024 * 1024,
		},
	);

	if (result.error !== undefined || result.status !== 0)
		throw new Error(
			`CLI Failed: ${cli} (${result.status ?? result.signal})\n${result.error?.message ?? ""}\n${result.stdout}\n${result.stderr}`,
		);

	return projectRoot;
}

async function main(): Promise<void> {
	const { values } = parseArgs({
		options: {
			configs: { type: "string" },
			"base-cli": { type: "string" },
			"head-cli": { type: "string" },
			scratch: { type: "string" },
		},
	});

	if (
		values.configs === undefined ||
		values["base-cli"] === undefined ||
		values["head-cli"] === undefined ||
		values.scratch === undefined
	)
		throw new Error(
			"Missing Arguments: --configs, --base-cli, --head-cli and --scratch are required.",
		);

	const configsDirectory = resolve(values.configs);
	const baseCli = resolve(values["base-cli"]);
	const headCli = resolve(values["head-cli"]);
	const scratch = resolve(values.scratch);
	await mkdir(scratch, { recursive: true });

	const configFiles = (await readdir(configsDirectory))
		.filter((path) => path.endsWith(".json"))
		.sort();

	let compared = 0;
	let skipped = 0;
	let differences = 0;
	let failures = 0;
	for (const configFile of configFiles) {
		try {
			const config = readObject(
				await readFile(join(configsDirectory, configFile), "utf-8"),
				configFile,
			);

			if (config.webApps !== undefined && !Array.isArray(config.webApps))
				throw new Error(`Invalid Secondary Web Apps: ${configFile}`);

			if (Array.isArray(config.webApps) && config.webApps.length !== 0) {
				skipped += 1;
				continue;
			}

			const directory = await mkdtemp(join(scratch, "byte-identity-"));
			const baseRoot = await generateProject(
				baseCli,
				join(directory, "base"),
				config,
			);

			const headRoot = await generateProject(
				headCli,
				join(directory, "head"),
				config,
			);

			const base = await normalizedProject(baseRoot);
			const head = await normalizedProject(headRoot);
			const paths = [...new Set([...base.keys(), ...head.keys()])].sort();
			for (const path of paths) {
				const before = base.get(path);
				const after = head.get(path);
				if (before !== undefined && after !== undefined && before.equals(after))
					continue;

				differences += 1;
				const change =
					before === undefined
						? "added"
						: after === undefined
							? "removed"
							: "changed";

				console.log(`${configFile}: ${change} ${path}`);
			}

			compared += 1;
		} catch (error) {
			failures += 1;
			console.error(
				`${configFile}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	if (compared === 0 && failures === 0) {
		failures += 1;
		console.error(
			"No Eligible Configs: record successful single-app creations first.",
		);
	}

	console.log(
		`Byte identity: ${compared} configs compared, ${skipped} skipped, ${differences} differing files, ${failures} failures.`,
	);

	if (differences !== 0 || failures !== 0) process.exitCode = 1;
}

await main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	console.log(
		"Byte identity: 0 configs compared, 0 skipped, 0 differing files, 1 failure.",
	);

	process.exitCode = 1;
});
