import { isCancel, select } from "@clack/prompts";
import { z } from "zod";
import { getUnsafeConfig, setConfig } from "../config";
import { cancel } from "../utils/cancel";

const ormOptions = ["Drizzle ORM", "Prisma", "None"] as const;
export const ormSchema = z.enum(ormOptions.filter((orm) => orm !== "None"));

async function getORM(): Promise<void> {
	const { database } = getUnsafeConfig();
	if (!database) return;

	const orm = await select({
		message: "What is your preferred ORM?",
		options: ormOptions.map((orm) => ({
			label: orm,
			value: orm,
		})),
	});

	if (isCancel(orm)) cancel();
	if (orm !== "None") setConfig({ orm });
}

export default getORM;
