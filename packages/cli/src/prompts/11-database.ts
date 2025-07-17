import { isCancel, select } from "@clack/prompts";
import { z } from "zod";
import { getUnsafeConfig, setConfig } from "../config";
import { cancel } from "../utils/cancel";

const databaseOptions = ["MySQL", "PostgreSQL", "SQLite", "None"] as const;
export const databaseSchema = z.enum(
	databaseOptions.filter((database) => database !== "None"),
);

async function getDatabase(): Promise<void> {
	const { backend } = getUnsafeConfig();
	if (backend === "Convex") return;

	const database = await select({
		message: "What is your preferred database?",
		options: databaseOptions.map((database) => ({
			label: database,
			value: database,
		})),
	});

	if (isCancel(database)) cancel();
	if (database !== "None") setConfig({ database });
}

export default getDatabase;
