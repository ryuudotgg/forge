import type { ForgeConfig } from "../config";

export function packageOverrides(
	config: ForgeConfig,
): Readonly<Record<string, string>> {
	// react-native-css fails to compile with lightningcss 1.31+.
	return config.mobile === "expo" &&
		config.nativeStyleFramework === "nativewind"
		? { lightningcss: "1.30.1" }
		: {};
}
