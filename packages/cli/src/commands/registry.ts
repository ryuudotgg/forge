export type ParsedValues = Record<string, string | boolean | undefined>;

export interface SubcommandDef {
	readonly description: string;
	readonly arg?: string;
	readonly default?: boolean;
	readonly run: (positionals: string[], values: ParsedValues) => Promise<void>;
}

export const subcommands = {
	create: {
		default: true,
		description: "Use me to forge a new project!",
		async run(_positionals, values) {
			const { runCreate } = await import("./create");
			await runCreate(values);
		},
	},

	update: {
		description: "Update your project. (Coming Soon)",
		async run(_positionals, values) {
			const { runUpdate } = await import("./update");
			await runUpdate(values);
		},
	},

	add: {
		description: "Add to your project. (Coming Soon)",
		arg: "<generator-id>",
		async run(positionals, values) {
			const id = positionals[0];
			if (!id) {
				console.error("Usage: forge add <generator-id>");
				process.exit(1);
			}

			const { runAdd } = await import("./add");
			await runAdd(id, values);
		},
	},

	remove: {
		description: "Remove from your project. (Coming Soon)",
		arg: "<generator-id>",
		async run(positionals, values) {
			const id = positionals[0];
			if (!id) {
				console.error("Usage: forge remove <generator-id>");
				process.exit(1);
			}

			const { runRemove } = await import("./remove");
			await runRemove(id, values);
		},
	},
} as const satisfies Record<string, SubcommandDef>;

export type SubcommandName = keyof typeof subcommands;

export function getSubcommand(name: string): SubcommandDef | undefined {
	if (Object.hasOwn(subcommands, name))
		return subcommands[name as SubcommandName];

	return undefined;
}

const found = Object.entries<SubcommandDef>(subcommands).find(
	([, cmd]) => cmd.default,
);

if (!found) throw new Error("We couldn't find a default command.");

export const defaultCommand = found;
