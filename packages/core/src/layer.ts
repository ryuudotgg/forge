import { Layer } from "effect";
import { CommandProbe } from "./command";
import { ConfigStore } from "./config";
import { Environment } from "./environment";
import { Pipeline } from "./pipeline";
import { Registry } from "./registry";
import { State } from "./state";
import { Vfs } from "./virtual-fs";

const baseCoreLive = Layer.mergeAll(
	CommandProbe.Default,
	ConfigStore.Default,
	Environment.Default,
	Registry.Default,
	State.Default,
	Vfs.Default,
);

export const CoreLive = Pipeline.Default.pipe(Layer.provideMerge(baseCoreLive));
