import { z } from "zod";

import { nameSchema, slugSchema } from "../prompts/1-name";
import { orpcContractsSchema } from "../prompts/10-orpc-contracts";
import { databaseSchema } from "../prompts/11-database";
import { ormSchema } from "../prompts/12-orm";
import { managedMySQLSchema } from "../prompts/13-managed-mysql";
import { managedPostgreSQLSchema } from "../prompts/14-managed-postgresql";
import { managedSQLiteSchema } from "../prompts/15-managed-sqlite";
import { authenticationSchema } from "../prompts/16-authentication";
import { authenticationCustomUISchema } from "../prompts/17-authentication-custom-ui";
import { tailwindEcosystemSchema } from "../prompts/18-tailwind";
import { styleFrameworkSchema } from "../prompts/19-style-framework";
import { pathSchema } from "../prompts/2-path";
import { nativeStyleFrameworkSchema } from "../prompts/20-native-style-framework copy";
import { proceedToAddonsSchema } from "../prompts/21-proceed-to-addons";
import { platformsSchema } from "../prompts/3-platforms";
import { webSchema } from "../prompts/4-web";
import { desktopSchema } from "../prompts/5-desktop";
import { mobileSchema } from "../prompts/6-mobile";
import { backendSchema } from "../prompts/7-backend";
import { rpcSchema } from "../prompts/8-rpc";
import { publicRPCSchema } from "../prompts/9-rpc-public";

const baseSchema = z.object({
	name: nameSchema,
	slug: slugSchema,
	path: pathSchema,

	platforms: platformsSchema,

	web: webSchema.optional(),
	desktop: desktopSchema.optional(),
	mobile: mobileSchema.optional(),

	backend: backendSchema.optional(),

	rpc: rpcSchema.optional(),
	rpcPublic: publicRPCSchema.optional(),
	orpcContracts: orpcContractsSchema.optional(),

	database: databaseSchema.optional(),
	orm: ormSchema.optional(),

	managedMySQL: managedMySQLSchema.optional(),
	managedPostgreSQL: managedPostgreSQLSchema.optional(),
	managedSQLite: managedSQLiteSchema.optional(),

	authentication: authenticationSchema.optional(),
	authenticationCustomUI: authenticationCustomUISchema.optional(),

	tailwindEcosystem: tailwindEcosystemSchema.default(false),

	styleFramework: styleFrameworkSchema.optional(),
	nativeStyleFramework: nativeStyleFrameworkSchema.optional(),

	proceedToAddons: proceedToAddonsSchema.optional(),
});

export const configSchema = baseSchema
	.refine(({ platforms, web, desktop, mobile }) => {
		if (platforms?.includes("Web") && !web)
			return "A web framework wasn't selected.";

		if (platforms?.includes("Desktop") && !desktop)
			return "A desktop framework wasn't selected.";

		if (platforms?.includes("Mobile") && !mobile)
			return "A mobile framework wasn't selected.";

		return true;
	})
	.transform((data): z.infer<typeof baseSchema> => {
		const { mobile, tailwindEcosystem, styleFramework, nativeStyleFramework } =
			data;

		if (tailwindEcosystem === false)
			if (
				(mobile &&
					(!styleFramework || styleFramework === "Tailwind CSS") &&
					nativeStyleFramework === "NativeWind") ||
				(!mobile && styleFramework === "Tailwind CSS")
			)
				return { ...data, tailwindEcosystem: true };

		return data;
	});

export type Config = z.infer<typeof configSchema>;
