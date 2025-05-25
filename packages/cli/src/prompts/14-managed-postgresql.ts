import { isCancel, select } from "@clack/prompts";
import { z } from "zod/v4";
import { getUnsafeConfig, setConfig } from "../config";
import { cancel } from "../utils/cancel";

const managedPostgreSQLOptions = [
	"Neon",
	"Nile",
	"Supabase",
	"Prisma Postgres",
	"None",
] as const;

export const managedPostgreSQLSchema = z.enum(
	managedPostgreSQLOptions.filter(
		(managedPostgreSQL) => managedPostgreSQL !== "None",
	),
);

async function getManagedPostgreSQL(): Promise<void> {
	const { database, orm } = getUnsafeConfig();
	if (database !== "PostgreSQL") return;

	const managedPostgreSQL = await select({
		message: "Do you want a managed PostgreSQL database?",
		options: managedPostgreSQLOptions
			.filter(
				(managedPostgreSQL) =>
					orm === "Prisma" || managedPostgreSQL !== "Prisma Postgres",
			)
			.map((managedPostgreSQL) => ({
				label: managedPostgreSQL,
				value: managedPostgreSQL,
			})),
	});

	if (isCancel(managedPostgreSQL)) cancel();
	if (managedPostgreSQL !== "None") setConfig({ managedPostgreSQL });
}

export default getManagedPostgreSQL;
