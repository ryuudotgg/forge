import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { interpolate } from "@ryuugg/core";

export { interpolate };

const __filename = fileURLToPath(import.meta.url);

const PKG_ROOT = join(dirname(__filename), "..");
const TEMPLATE_DIR = join(PKG_ROOT, "templates");
export function readTemplate(templatePath: string): string {
	return readFileSync(join(TEMPLATE_DIR, templatePath), "utf-8");
}

export function replaceAnchor(
	template: string,
	anchor: string,
	replacement: string,
): string {
	if (template.split(anchor).length !== 2)
		throw new Error(`Template Anchor Not Unique: ${anchor}`);

	return template.replace(anchor, () => replacement);
}

export function renderHeadersFromRequest(
	requestType: "Request" | "FastifyRequest",
) {
	return interpolate(readTemplate("api/headers-from-request.ts"), {
		REQUEST_TYPE: requestType,
	}).trimEnd();
}
