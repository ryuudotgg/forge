import { confirm, isCancel } from "@clack/prompts";
import { z } from "zod";
import { getUnsafeConfig, setConfig } from "../config";
import { cancel } from "../utils/cancel";

export const orpcContractsSchema = z.boolean();

async function getORPCContracts(): Promise<void> {
	const { rpc } = getUnsafeConfig();
	if (rpc !== "oRPC") return;

	const orpcContracts = await confirm({
		message: "Do you want to use oRPC Contracts?",
		active: "Yes",
		inactive: "No",
	});

	if (isCancel(orpcContracts)) cancel();
	if (orpcContracts) setConfig({ orpcContracts });
}

export default getORPCContracts;
