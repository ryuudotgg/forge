import * as schema from "@__SLUG__/db/schema";
import { defineRelations } from "drizzle-orm";

export const relations = defineRelations(schema, (r) => ({
  users: {
    accounts: r.many.accounts({
      from: r.users.id,
      to: r.accounts.userId,
    }),
    sessions: r.many.sessions({
      from: r.users.id,
      to: r.sessions.userId,
    }),
__AUTH_USER_RELATIONS__
  },

  accounts: {
    user: r.one.users({
      from: r.accounts.userId,
      to: r.users.id,
      optional: false,
    }),
  },

  sessions: {
    user: r.one.users({
      from: r.sessions.userId,
      to: r.users.id,
      optional: false,
    }),
  },
__AUTH_TABLE_RELATIONS__
}));
