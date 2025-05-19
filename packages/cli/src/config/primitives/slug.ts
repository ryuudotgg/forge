import { z } from "zod";

export const slugSchema = z
	.string({ required_error: "You need to provide a slug." })
	.trim()
	.min(1, "You need to provide a slug.")
	.max(15, "It must be less than 15 characters.")
	.regex(
		/^[a-z0-9]+(?:-[a-z0-9]+)*$/,
		"We couldn't generate a valid slug. Try again with a different name.",
	);
