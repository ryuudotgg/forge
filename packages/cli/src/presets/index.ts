import type { PartialConfig } from "../steps/types";
import { apiOnly } from "./api-only";
import { fullstack } from "./fullstack";
import { saas } from "./saas";

export const presets: Record<string, PartialConfig> = {
	saas,
	"api-only": apiOnly,
	fullstack,
};
