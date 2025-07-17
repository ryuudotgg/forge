import { isCancel, select } from "@clack/prompts";
import { z } from "zod";
import { getUnsafeConfig, setConfig } from "../config";
import { cancel } from "../utils/cancel";
import { stripNulls } from "../utils/strip-nulls";

const styleFrameworkOptions = ["Tailwind CSS", "UnoCSS", "None"] as const;
export const styleFrameworkSchema = z.enum(
	styleFrameworkOptions.filter((framework) => framework !== "None"),
);

async function getStyleFramework(): Promise<void> {
	const { tailwindEcosystem: tailwind, web, desktop } = getUnsafeConfig();

	if (tailwind) return setConfig({ styleFramework: "Tailwind CSS" });
	if (!web && !desktop) return;

	const styleFramework = await select({
		message: `Which styling framework do you want to use for ${stripNulls([
			web,
			desktop,
		]).join(" and ")}?`,

		options: styleFrameworkOptions.map((framework) => ({
			label: framework,
			value: framework,
		})),
	});

	if (isCancel(styleFramework)) cancel();
	if (styleFramework !== "None") setConfig({ styleFramework });
}

export default getStyleFramework;
