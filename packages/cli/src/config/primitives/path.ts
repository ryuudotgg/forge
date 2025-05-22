import { z } from "zod/v4";

export const pathSchema = z
	.string({ error: "You need to provide a path." })
	.trim()
	.min(1, { error: "You need to provide a path." })
	.regex(/^(\.\/.*|\.)$/, { error: "You need to provide a relative path." });
