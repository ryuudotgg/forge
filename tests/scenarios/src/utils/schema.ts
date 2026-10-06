const blockBounds = {
	drizzle: { start: "export const passkeys = ", end: "\nexport " },
	prisma: { start: "model Passkey {", end: "\n}" },
} as const;

export function passkeySchemaBlock(
	schema: string,
	orm: keyof typeof blockBounds,
): string {
	const { start, end } = blockBounds[orm];
	const from = schema.indexOf(start);
	if (from === -1) throw new Error(`Missing Passkey Table: ${start}`);

	const to = schema.indexOf(end, from + start.length);
	return schema.slice(from, to === -1 ? undefined : to);
}
