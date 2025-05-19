import { outro } from "@clack/prompts";
import { rainbow } from "../utils/rainbow";

function printOutro(): void {
	outro(`You've forged a ${rainbow("MYTIC")} grade project!`);
}

export default printOutro;
