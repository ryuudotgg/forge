export type ParsedValues = Record<string, string | boolean | undefined>;

export interface SubcommandDef {
	readonly description: string;
	readonly arg?: string;
	readonly argRequired?: boolean;
	readonly default?: boolean;
	readonly machineOutput?: boolean;
	readonly run: (positionals: string[], values: ParsedValues) => Promise<void>;
}

export const subcommands = {
	create: {
		default: true,
		description: "Forge a new project from a framework, template, and addons.",
		async run(_positionals, values) {
			const { runCreate } = await import("./create");
			await runCreate(values);
		},
	},

	init: {
		description: "Adopt an existing project into Forge.",
		async run(_positionals, values) {
			const { runInit } = await import("./init");
			await runInit(values);
		},
	},

	update: {
		description: "Reconcile your installed addons and templates.",
		async run(_positionals, values) {
			const { runUpdate } = await import("./update");
			await runUpdate(values);
		},
	},

	list: {
		description: "Browse the Forge catalog.",
		arg: "[query]",
		machineOutput: true,
		async run(positionals, values) {
			const { runList } = await import("./list");
			await runList(positionals[0], values);
		},
	},

	info: {
		description: "Show details for a catalog entry.",
		arg: "<id>",
		argRequired: true,
		machineOutput: true,
		async run(positionals, values) {
			const { runInfo } = await import("./info");

			const id = positionals[0];
			if (id === undefined)
				throw new Error("Catalog Entry Missing: an id is required.");

			await runInfo(id, values);
		},
	},

	add: {
		description: "Add an addon to your project.",
		arg: "[addon-id]",
		async run(positionals, values) {
			const { runAdd } = await import("./add");
			await runAdd(positionals[0], values);
		},
	},

	remove: {
		description: "Remove an addon from your project.",
		arg: "[addon-id]",
		async run(positionals, values) {
			const { runRemove } = await import("./remove");
			await runRemove(positionals[0], values);
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
