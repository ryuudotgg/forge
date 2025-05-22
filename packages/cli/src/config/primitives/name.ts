import { z } from "zod/v4";

export const nameSchema = z
	.string({ error: "You need to provide a name." })
	.trim()
	.min(1, { error: "You need to provide a name." })
	.max(15, { error: "It must be less than 15 characters." });
