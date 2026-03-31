import addonSelect from "./addons/select";
import authCustomUI from "./auth/custom-ui";
import authProvider from "./auth/provider";
import backendFramework from "./backend/framework";
import orpcContracts from "./backend/orpc-contracts";
import rpc from "./backend/rpc";
import rpcPublic from "./backend/rpc-public";
import database from "./data/database";
import managedProvider from "./data/managed-provider";
import orm from "./data/orm";
import generate from "./generate";
import intro from "./intro";
import outro from "./outro";
import desktop from "./platforms/desktop";
import mobile from "./platforms/mobile";
import platformSelect from "./platforms/select";
import web from "./platforms/web";
import gitInit from "./post/git-init";
import installDeps from "./post/install-deps";
import linter from "./project/linter";
import name from "./project/name";
import packageManager from "./project/package-manager";
import path from "./project/path";
import runtime from "./project/runtime";
import nativeStyleFramework from "./style/native-framework";
import tailwindEcosystem from "./style/tailwind-ecosystem";
import webStyleFramework from "./style/web-framework";
import type { Step } from "./types";

export const steps: Step[] = [
	intro,

	name,
	path,
	runtime,
	packageManager,
	linter,

	platformSelect,
	web,
	desktop,
	mobile,

	backendFramework,
	rpc,
	rpcPublic,
	orpcContracts,

	database,
	orm,
	managedProvider,

	authProvider,
	authCustomUI,

	tailwindEcosystem,
	webStyleFramework,
	nativeStyleFramework,

	addonSelect,

	generate,

	gitInit,
	installDeps,

	outro,
];
