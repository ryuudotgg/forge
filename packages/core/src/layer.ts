import { Layer } from "effect";
import { Apply } from "./apply";
import { CommandProbe } from "./command";
import { ConfigStore } from "./config";
import { Environment } from "./environment";
import { Planner } from "./planner";
import { Renderer } from "./renderer";
import { State } from "./state";

const baseCoreLive = Layer.mergeAll(
	Apply.Default,
	CommandProbe.Default,
	ConfigStore.Default,
	Environment.Default,
	Renderer.Default,
	State.Default,
);

export const CoreLive = Planner.Default.pipe(Layer.provideMerge(baseCoreLive));
