import type { PackageManagerId } from "@ryuugg/core";
import { pmRun } from "../pm";

export function standaloneServerScripts(pm: PackageManagerId) {
	return {
		build: pmRun(pm, "with-env", "tsdown"),
		dev: "dotenv -e ../../.env -v NODE_ENV=development -- tsx watch src/index.ts",
		start: "dotenv -e ../../.env -v NODE_ENV=production -- node dist/index.js",
		typecheck: "tsc --noEmit",
		"with-env": "dotenv -e ../../.env --",
	};
}
