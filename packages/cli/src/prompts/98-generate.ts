import { validateConfig } from "../config";

function generate() {
	const config = validateConfig();
	console.log(config);

	// TODO: Generate the Project
}

export default generate;
