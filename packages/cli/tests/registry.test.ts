import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	defaultCommand,
	getSubcommand,
	subcommands,
} from "../src/commands/registry";

const commandMocks = vi.hoisted(() => ({
	runAdd: vi.fn(),
	runCreate: vi.fn(),
	runRemove: vi.fn(),
	runUpdate: vi.fn(),
}));

vi.mock("../src/commands/add", () => ({ runAdd: commandMocks.runAdd }));
vi.mock("../src/commands/create", () => ({
	runCreate: commandMocks.runCreate,
}));
vi.mock("../src/commands/remove", () => ({
	runRemove: commandMocks.runRemove,
}));
vi.mock("../src/commands/update", () => ({
	runUpdate: commandMocks.runUpdate,
}));

beforeEach(() => {
	commandMocks.runAdd.mockReset();
	commandMocks.runCreate.mockReset();
	commandMocks.runRemove.mockReset();
	commandMocks.runUpdate.mockReset();
});

describe("command registry", () => {
	it("exposes every subcommand through getSubcommand", () => {
		expect(getSubcommand("create")).toBe(subcommands.create);
		expect(getSubcommand("update")).toBe(subcommands.update);
		expect(getSubcommand("add")).toBe(subcommands.add);
		expect(getSubcommand("remove")).toBe(subcommands.remove);
	});

	it("ignores inherited object members and unknown names", () => {
		expect(getSubcommand("hasOwnProperty")).toBeUndefined();
		expect(getSubcommand("toString")).toBeUndefined();
		expect(getSubcommand("bogus")).toBeUndefined();
	});

	it("marks create as the default command", () => {
		expect(defaultCommand[0]).toBe("create");
		expect(defaultCommand[1]).toBe(subcommands.create);
		expect(defaultCommand[1].default).toBe(true);
	});

	it("forwards values to runCreate", async () => {
		await subcommands.create.run(["ignored"], { preset: "default" });

		expect(commandMocks.runCreate).toHaveBeenCalledWith({
			preset: "default",
		});
	});

	it("forwards values to runUpdate", async () => {
		await subcommands.update.run([], { config: "./forge.config.json" });

		expect(commandMocks.runUpdate).toHaveBeenCalledWith({
			config: "./forge.config.json",
		});
	});

	it("forwards the addon id and values to runAdd", async () => {
		await subcommands.add.run(["tailwind"], { path: "./app" });

		expect(commandMocks.runAdd).toHaveBeenCalledWith("tailwind", {
			path: "./app",
		});

		await subcommands.add.run([], {});

		expect(commandMocks.runAdd).toHaveBeenLastCalledWith(undefined, {});
	});

	it("forwards the addon id and values to runRemove", async () => {
		await subcommands.remove.run(["tailwind"], {});

		expect(commandMocks.runRemove).toHaveBeenCalledWith("tailwind", {});
	});
});
