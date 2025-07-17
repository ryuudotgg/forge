import { isCancel, select } from "@clack/prompts";
import { z } from "zod";
import { getUnsafeConfig, setConfig } from "../config";
import { cancel } from "../utils/cancel";

const nativeStyleFrameworkOptions = [
	"NativeWind",
	"Tamagui",
	"Unistyles",
	"None",
] as const;

export const nativeStyleFrameworkSchema = z.enum(
	nativeStyleFrameworkOptions.filter((framework) => framework !== "None"),
);

async function getNativeStyleFramework(): Promise<void> {
	const { tailwindEcosystem: tailwind, mobile } = getUnsafeConfig();

	if (!mobile) return;
	if (tailwind) return setConfig({ nativeStyleFramework: "NativeWind" });

	const nativeStyleFramework = await select({
		message: `Which styling framework do you want to use for ${mobile}?`,
		options: nativeStyleFrameworkOptions.map((framework) => ({
			label: framework,
			value: framework,
		})),
	});

	if (isCancel(nativeStyleFramework)) cancel();
	if (nativeStyleFramework !== "None") setConfig({ nativeStyleFramework });
}

export default getNativeStyleFramework;
