import { isCancel, select } from "@clack/prompts";
import { z } from "zod/v4";
import { getUnsafeConfig, setConfig } from "../config";
import { cancel } from "../utils/cancel";

const managedSQLiteOptions = ["Turso", "None"] as const;
export const managedSQLiteSchema = z.enum(
	managedSQLiteOptions.filter((managedSQLite) => managedSQLite !== "None"),
);

async function getManagedSQLite(): Promise<void> {
	const { database } = getUnsafeConfig();
	if (database !== "SQLite") return;

	const managedSQLite = await select({
		message: "Do you want a managed SQLite database?",
		options: managedSQLiteOptions.map((managedSQLite) => ({
			label: managedSQLite,
			value: managedSQLite,
		})),
	});

	if (isCancel(managedSQLite)) cancel();
	if (managedSQLite !== "None") setConfig({ managedSQLite });
}

export default getManagedSQLite;
