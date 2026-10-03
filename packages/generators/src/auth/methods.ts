import { type AuthMethod, authMethods, type ForgeConfig } from "../config";
import { standaloneApiOrigin } from "../origins";

function isAuthMethodList(value: unknown): value is ReadonlyArray<AuthMethod> {
	if (!Array.isArray(value) || value.length === 0) return false;

	const methods: ReadonlyArray<unknown> = value;
	for (const method of methods)
		if (!authMethods.ids.some((id) => id === method)) return false;

	return true;
}

export function resolveAuthMethods(
	config: ForgeConfig,
): ReadonlyArray<AuthMethod> {
	if (config.authMethods !== undefined) {
		if (!isAuthMethodList(config.authMethods))
			throw new Error(
				`Invalid Auth Methods: ${JSON.stringify(config.authMethods)}`,
			);

		return config.authMethods;
	}

	return standaloneApiOrigin(config) !== undefined || config.mobile === "expo"
		? ["email-password", "google", "apple"]
		: ["google", "apple"];
}

export function authUsesPassword(config: ForgeConfig): boolean {
	return resolveAuthMethods(config).includes("email-password");
}

const socialProviders = [
	{ id: "google", envStem: "AUTH_GOOGLE" },
	{ id: "apple", envStem: "AUTH_APPLE" },
] as const satisfies ReadonlyArray<{
	readonly id: AuthMethod;
	readonly envStem: string;
}>;

export function authSocialProviders(config: ForgeConfig) {
	const methods = resolveAuthMethods(config);
	return socialProviders.filter(({ id }) => methods.includes(id));
}
