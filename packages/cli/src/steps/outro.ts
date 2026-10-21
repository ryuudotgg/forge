import { log, outro } from "@clack/prompts";
import { packageManagerCommand } from "@ryuugg/core";
import { shellArgument } from "../utils/completion";
import { rainbow } from "../utils/rainbow";
import { defineStep, SKIP } from "./types";

const outroStep = defineStep({
	id: "outro",
	group: "outro",
	schema: null,
	configKey: null,

	shouldRun: () => true,

	async execute(config, interactive) {
		if (interactive) {
			outro(`You've forged a ${rainbow("MYTHIC")} grade project!`);
			return;
		}

		const path = String(config.path);
		const created = `We created ${config.name} in ${path}.`;
		if (config.installDeps !== false) {
			log.success(created);
			return SKIP;
		}

		const install = packageManagerCommand(config.packageManager ?? "pnpm");
		log.success(
			`${created} Run "cd ${shellArgument(path)}", then "${install} install" to install its dependencies.`,
		);

		return SKIP;
	},
});

export default outroStep;
