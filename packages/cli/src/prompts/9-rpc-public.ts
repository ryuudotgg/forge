import { confirm, isCancel } from "@clack/prompts";
import { z } from "zod/v4";
import { getUnsafeConfig, setConfig } from "../config";
import { cancel } from "../utils/cancel";

export const publicRPCSchema = z.boolean();

async function getRPC(): Promise<void> {
	const { rpc } = getUnsafeConfig();
	if (!rpc) return;

	const rpcPublic = await confirm({
		message: "Do you want your API to be publicly available?",
		active: "Yes (OpenAPI Specification)",
		inactive: "No",
	});

	if (isCancel(rpcPublic)) cancel();

	setConfig({ rpcPublic });
}

export default getRPC;
