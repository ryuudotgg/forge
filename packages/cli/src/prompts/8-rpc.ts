import { isCancel, select } from "@clack/prompts";
import { z } from "zod/v4";
import { getUnsafeConfig, setConfig } from "../config";
import { cancel } from "../utils/cancel";

const rpcOptions = ["tRPC", "oRPC", "None"] as const;
export const rpcSchema = z.enum(rpcOptions.filter((rpc) => rpc !== "None"));

async function getRPC(): Promise<void> {
	const { web, backend } = getUnsafeConfig();
	if (backend === "Convex") return;

	const rpc = await select({
		message: `Do you want to use an RPC API with ${web}?`,
		options: rpcOptions.map((rpc) => ({
			label: rpc,
			value: rpc,
		})),
	});

	if (isCancel(rpc)) cancel();
	if (rpc !== "None") setConfig({ rpc });
}

export default getRPC;
