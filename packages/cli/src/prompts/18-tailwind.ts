import { confirm, isCancel } from "@clack/prompts";
import { z } from "zod";
import { getUnsafeConfig, setConfig } from "../config";
import { cancel } from "../utils/cancel";
import { stripNulls } from "../utils/strip-nulls";

export const tailwindEcosystemSchema = z.boolean();

async function getTailwindEcosystem(): Promise<void> {
	const { web, desktop, mobile } = getUnsafeConfig();
	if ((!web && !desktop) || !mobile) return;

	const tailwind = await confirm({
		message: "Do you want to use Tailwind CSS for the entire ecosystem?",
		active: "Yes (Recommended)",
		inactive: `No (${stripNulls([web, desktop]).join(
			" and ",
		)} UI Primitives are Non-Reusable in ${mobile})`,
	});

	if (isCancel(tailwind)) cancel();

	setConfig({ tailwindEcosystem: tailwind });
}

export default getTailwindEcosystem;
