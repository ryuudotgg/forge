import { Layer } from "effect";
import { Apply } from "./apply";
import { CommandProbe } from "./command";
import { ConfigStore } from "./config";
import { Environment } from "./environment";
import { Pipeline } from "./pipeline";
import { Planner } from "./planner";
import { Registry } from "./registry";
import { Renderer } from "./renderer";
import { State } from "./state";
import { Vfs } from "./virtual-fs";

const baseCoreLive = Layer.mergeAll(
	Apply.Default,
	CommandProbe.Default,
	ConfigStore.Default,
	Environment.Default,
	Renderer.Default,
	Registry.Default,
	State.Default,
	Vfs.Default,
);

export const CoreLive = Layer.mergeAll(Pipeline.Default, Planner.Default).pipe(
	Layer.provideMerge(baseCoreLive),
);
