import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export { interpolate } from "@ryuujs/core";

const __filename = fileURLToPath(import.meta.url);

const PKG_ROOT = join(dirname(__filename), "..");
const TEMPLATE_DIR = join(PKG_ROOT, "templates");

export function readTemplate(templatePath: string): string {
	return readFileSync(join(TEMPLATE_DIR, templatePath), "utf-8");
}
