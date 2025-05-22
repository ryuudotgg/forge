import { z } from "zod/v4";

import { nameSchema } from "./primitives/name";
import { pathSchema } from "./primitives/path";
import { slugSchema } from "./primitives/slug";

export const configSchema = z.object({
	name: nameSchema,
	slug: slugSchema,
	path: pathSchema,
});

export type Config = z.infer<typeof configSchema>;
