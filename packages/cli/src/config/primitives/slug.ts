import { z } from "zod/v4";

export const slugSchema = z
	.string({ error: "You need to provide a slug." })
	.trim()
	.min(1, { error: "You need to provide a slug." })
	.max(15, { error: "It must be less than 15 characters." })
	.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
		error:
			"We couldn't generate a valid slug. Try again with a different name.",
	});
