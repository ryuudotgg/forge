import { z } from "zod";

export const pathSchema = z
	.string({ required_error: "You need to provide a path." })
	.trim()
	.min(1, "You need to provide a path.")
	.regex(/^(\.\/.*|\.)$/, "You need to provide a relative path.");
