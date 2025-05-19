import { cancel } from "../utils/cancel";
import { type Config, configSchema } from "./schema";

let config: Partial<Config> = {};

export function getUnsafeConfig(): Partial<Config> {
	return config;
}

export function validateConfig(): Config {
	const result = configSchema.safeParse(config);

	if (result.error)
		cancel("Your fire went out unexpectedly. (It's not you, it's us.)", 1);

	return result.data;
}

export function setConfig(newConfig: Partial<Config>) {
	config = { ...config, ...newConfig };
}
