import { z } from "zod";

export const nameSchema = z
	.string({ required_error: "You need to provide a name." })
	.trim()
	.min(1, "You need to provide a name.")
	.max(15, "It must be less than 15 characters.");
