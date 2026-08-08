import { Layer } from "effect";
import { Apply } from "./apply";
import { CommandProbe } from "./command";
import { ConfigStore } from "./config";
import { Environment } from "./environment";
import { Planner } from "./planner";
import { Renderer } from "./renderer";
import { State } from "./state";
import { Subprocess } from "./subprocess";

const commandProbeLive = CommandProbe.Default.pipe(
	Layer.provide(Subprocess.Default),
);

const baseCoreLive = Layer.mergeAll(
	Apply.Default,
	commandProbeLive,
	ConfigStore.Default,
	Environment.Default,
	Renderer.Default,
	State.Default,
	Subprocess.Default,
);

export const CoreLive = Planner.Default.pipe(Layer.provideMerge(baseCoreLive));
