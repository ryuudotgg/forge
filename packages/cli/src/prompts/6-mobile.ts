import { isCancel, select } from "@clack/prompts";
import { z } from "zod";
import { getUnsafeConfig, setConfig } from "../config";
import { cancel } from "../utils/cancel";

const mobileOptions = ["Expo", "React Native"] as const;
export const mobileSchema = z.enum(mobileOptions);

async function getMobile(): Promise<void> {
	const { platforms } = getUnsafeConfig();
	if (!platforms?.includes("Mobile")) return;

	const mobile = await select({
		message: "What is your preferred mobile framework?",
		options: mobileOptions.map((mobile, index) => ({
			label: index === 0 ? `${mobile} (Recommended)` : mobile,
			value: mobile,
		})),
	});

	if (isCancel(mobile)) cancel();

	setConfig({ mobile });
}

export default getMobile;
