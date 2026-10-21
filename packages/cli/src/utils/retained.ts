import { log } from "@clack/prompts";
import { listAnd } from "./list";

export function reportRetainedFiles(retained: ReadonlyArray<string>) {
	if (retained.length > 0)
		log.info(
			`We kept your edited ${retained.length === 1 ? "file" : "files"} at ${listAnd.format(retained)}.`,
		);
}
