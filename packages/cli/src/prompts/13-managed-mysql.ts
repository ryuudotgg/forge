import { isCancel, select } from "@clack/prompts";
import { z } from "zod/v4";
import { getUnsafeConfig, setConfig } from "../config";
import { cancel } from "../utils/cancel";

const managedMySQLOptions = ["PlanetScale", "None"] as const;
export const managedMySQLSchema = z.enum(
	managedMySQLOptions.filter((managedMySQL) => managedMySQL !== "None"),
);

async function getManagedMySQL(): Promise<void> {
	const { database } = getUnsafeConfig();
	if (database !== "MySQL") return;

	const managedMySQL = await select({
		message: "Do you want a managed MySQL database?",
		options: managedMySQLOptions.map((managedMySQL) => ({
			label: managedMySQL,
			value: managedMySQL,
		})),
	});

	if (isCancel(managedMySQL)) cancel();
	if (managedMySQL !== "None") setConfig({ managedMySQL });
}

export default getManagedMySQL;
