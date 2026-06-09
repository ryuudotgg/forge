import * as schema from "@__SLUG__/db/schema";
import { defineRelations } from "drizzle-orm";

export const relations = defineRelations(schema, () => ({}));
