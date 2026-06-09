import type { PartialConfig } from "../steps/types";
import { defaultPreset } from "./default";

export const presets: Record<string, PartialConfig> = {
	default: defaultPreset,
};
