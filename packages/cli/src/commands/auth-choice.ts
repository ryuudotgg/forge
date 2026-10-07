import { log } from "@clack/prompts";
import { packageManagerCommand } from "@ryuugg/core";
import {
	type AuthChoice,
	authChoiceChangesSchema,
	authChoiceLabel,
	configWithAuthChoice,
	hasAuthChoice,
	pmRunIn,
	resolveAuthMethods,
} from "@ryuugg/generators";
import { configIssue, malformedConfigIssue, ormIssue } from "../config/schema";
import { completionLine } from "../utils/completion";
import { reportRetainedFiles } from "../utils/retained";
import {
	applyInstalledPlan,
	configuredPackageManager,
	type ManagedProject,
} from "./lifecycle";
import { resolutionArguments } from "./resolution";

export async function runAuthChoiceChange(
	project: ManagedProject,
	choice: AuthChoice,
	direction: "add" | "remove",
	values: Record<string, string | boolean | string[] | undefined>,
) {
	const label = authChoiceLabel(choice);
	const malformed = malformedConfigIssue(project.config);
	if (malformed !== undefined) {
		log.error(malformed);
		process.exit(1);
	}

	const present = hasAuthChoice(project.config, choice);
	if (direction === "remove" && !present) {
		log.error(`We couldn't find ${label} in this project.`);
		process.exit(1);
	}

	if (direction === "add" && present) {
		log.info(`${label} is already set up.`);
		return;
	}

	if (
		direction === "remove" &&
		choice.kind === "method" &&
		new Set(resolveAuthMethods(project.config)).size === 1
	) {
		log.error(
			`We can't remove ${label} because it's your only sign-in method.`,
		);

		process.exit(1);
	}

	const nextConfig = configWithAuthChoice(
		project.config,
		choice,
		direction === "add",
	);

	const issue =
		malformedConfigIssue(nextConfig) ??
		configIssue(nextConfig) ??
		ormIssue(nextConfig);

	if (issue !== undefined) {
		log.error(issue);
		process.exit(1);
	}

	const applied = await applyInstalledPlan(
		project.projectRoot,
		nextConfig,
		project.manifest.installs,
		undefined,
		project.manifest.registries,
		...resolutionArguments(values),
	);

	const packageManager = configuredPackageManager(nextConfig);
	log.success(
		completionLine(
			direction === "add" ? `We added ${label}.` : `We removed ${label}.`,
			applied,
			packageManager,
		),
	);

	reportRetainedFiles(applied.retained);

	if (authChoiceChangesSchema(choice) && nextConfig.orm !== undefined) {
		const database = {
			name: `@${nextConfig.slug ?? "my-app"}/db`,
			path: "packages/db",
		};

		const pm = packageManagerCommand(packageManager);
		const push = pmRunIn(pm, database, "push");
		const change =
			direction === "add"
				? `${label} changes your auth schema`
				: `Removing ${label} changes your auth schema`;

		const generate = pmRunIn(pm, database, "generate");
		const migrate = pmRunIn(pm, database, "migrate");
		const steps =
			nextConfig.orm !== "prisma"
				? `run "${push}" to update your database.`
				: nextConfig.databaseProvider === "turso"
					? `run "${migrate}" to create a migration, apply it to Turso with "turso db shell <database-name> < packages/db/prisma/migrations/<migration>/migration.sql", and then run "${generate}".`
					: `run "${push}" and then "${generate}" to update your database and client.`;

		log.info(`${change}, so ${steps}`);
	}
}
