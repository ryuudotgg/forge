import { reservedWebAppNames, type WebAppConfig } from "@ryuugg/generators";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
	adoptedWebConfig,
	adoptionRefusal,
	type ConfirmedModule,
	primaryWebRoot,
	type RequestedWebApps,
	resolveWebAppAdoption,
	rpcProviderRefusal,
	scriptPort,
	secondaryWebAppsSentence,
	type WebAppObservation,
} from "../src/commands/adoption";
import { firstPartyAddonIds } from "../src/steps/platforms/web-apps";

function observed(
	root: string,
	overrides: Partial<WebAppObservation> = {},
): WebAppObservation {
	return {
		root,
		frameworks: ["nextjs"],
		scriptPort:
			root === "apps/web"
				? { kind: "absent" }
				: { kind: "literal", port: 3002 },
		rpcPackages: [],
		...overrides,
	};
}

function web(...roots: ReadonlyArray<string>): ReadonlyArray<ConfirmedModule> {
	return roots.map((root) => ({ kind: "web-app", root }));
}

function resolve(
	observations: ReadonlyArray<WebAppObservation>,
	options: {
		readonly confirmed?: ReadonlyArray<ConfirmedModule>;
		readonly primaryRoot?: string;
		readonly requested?: RequestedWebApps;
	} = {},
) {
	const confirmed =
		options.confirmed ?? web(...observations.map((entry) => entry.root));

	return resolveWebAppAdoption({
		addonIds: firstPartyAddonIds(),
		confirmed,
		observations,
		primaryRoot:
			options.primaryRoot ??
			primaryWebRoot(confirmed.map((module) => module.root)),
		requested: options.requested ?? {},
	});
}

function resolved(...parameters: Parameters<typeof resolve>) {
	return Effect.runPromise(resolve(...parameters));
}

async function refusal(...parameters: Parameters<typeof resolve>) {
	const error = await Effect.runPromise(Effect.flip(resolve(...parameters)));
	expect(error._tag).toBe("AdoptionRefusal");
	return error.message;
}

const sentences: ReadonlyArray<readonly [ReadonlyArray<WebAppConfig>, string]> =
	[
		[
			[{ name: "site", framework: "nextjs", port: 3002 }],
			"We'll adopt site (Next.js, port 3002) as a secondary web app.",
		],
		[
			[
				{ name: "admin", framework: "react-router", port: 3003, client: true },
				{ name: "site", framework: "nextjs", port: 3002 },
			],
			"We'll adopt admin (React Router, port 3003, calls the API) and site (Next.js, port 3002) as secondary web apps.",
		],
		[
			[
				{ name: "admin", framework: "react-router", port: 3003 },
				{ name: "docs", framework: "tanstack-start", port: 3004 },
				{ name: "site", framework: "nextjs", port: 3002 },
			],
			"We'll adopt admin (React Router, port 3003), docs (TanStack Start, port 3004), and site (Next.js, port 3002) as secondary web apps.",
		],
	];

describe("web app adoption", () => {
	it("records the detected primary directory name, not its package suffix", async () => {
		const result = await resolved([
			observed("apps/vault", {
				packageName: "@acme/legacy",
				scriptPort: { kind: "absent" },
			}),
		]);

		expect(result.webName).toBe("vault");
		expect([...result.prototypeRoots]).toEqual([["apps/vault", "apps/vault"]]);
		expect(adoptedWebConfig(result, {})).toEqual({
			web: "nextjs",
			webName: "vault",
			platforms: ["web"],
		});
	});

	it.each(["web", "Vault", "server", "biome"])(
		"keeps the default prototype for primary %s",
		async (name) => {
			const root = `apps/${name}`;
			const result = await resolved([
				observed(root, { scriptPort: { kind: "absent" } }),
			]);

			expect(result).not.toHaveProperty("webName");
			expect([...result.prototypeRoots]).toEqual([[root, "apps/web"]]);
			expect(adoptedWebConfig(result, {})).not.toHaveProperty("webName");
		},
	);

	it("falls back when the primary directory name collides with a secondary", async () => {
		const result = await resolved(
			[
				observed("sites/vault", { scriptPort: { kind: "absent" } }),
				observed("apps/vault", { packageName: "@acme/vault" }),
			],
			{ primaryRoot: "sites/vault" },
		);

		expect(result).not.toHaveProperty("webName");
		expect([...result.prototypeRoots]).toEqual([
			["sites/vault", "apps/web"],
			["apps/vault", "apps/vault"],
		]);
	});

	it("uses the primary's name in observed port conflicts", async () => {
		expect(
			await refusal(
				[
					observed("apps/vault", {
						scriptPort: { kind: "literal", port: 3010 },
					}),
					observed("apps/site", {
						scriptPort: { kind: "literal", port: 3010 },
					}),
				],
				{ primaryRoot: "apps/vault" },
			),
		).toBe(
			"We couldn't adopt these web apps: vault and site both use port 3010. Give each app its own port in its dev script and run forge init again.",
		);
	});

	describe("frameworks", () => {
		it("refuses an app with two framework signatures and names both", async () => {
			expect(
				await refusal([
					observed("apps/web"),
					observed("apps/mixed", { frameworks: ["nextjs", "tanstack-start"] }),
				]),
			).toBe(
				"We couldn't adopt apps/mixed because we found Next.js and TanStack Start in its dependencies, and Forge manages one web framework per app.",
			);
		});

		it("refuses a confirmed web root with no framework evidence", async () => {
			expect(
				await refusal([observed("apps/web")], {
					confirmed: web("apps/web", "packages/shared"),
				}),
			).toBe(
				"We couldn't adopt packages/shared as a web app because we found no supported web framework in its dependencies.",
			);
		});

		it("records a secondary with its own framework when the config omits it", async () => {
			const result = await resolved(
				[
					observed("apps/web"),
					observed("apps/admin", {
						frameworks: ["react-router"],
						scriptPort: { kind: "literal", port: 5174 },
					}),
				],
				{ requested: { webApps: [] } },
			);

			expect(result.web).toBe("nextjs");
			expect(result.webApps).toEqual([
				{ name: "admin", framework: "react-router", port: 5174 },
			]);
		});

		it("refuses a config framework that disagrees with the app on disk", async () => {
			expect(
				await refusal(
					[
						observed("apps/web"),
						observed("apps/admin", { frameworks: ["react-router"] }),
					],
					{
						requested: {
							webApps: [{ name: "admin", framework: "nextjs" }],
						},
					},
				),
			).toBe(
				"We couldn't adopt apps/admin as Next.js because its dependencies say React Router. Fix webApps in your init config and run forge init again.",
			);
		});
	});

	describe("names", () => {
		it.each([
			["apps/Admin_Panel", "@acme/admin", "admin"],
			["apps/marketing", "@acme/site", "site"],
			["apps/console", "console", "console"],
			["apps/admin", undefined, "admin"],
		])("names %s with package %s as %s", async (root, packageName, name) => {
			const result = await resolved([
				observed("apps/web"),
				observed(root, packageName === undefined ? {} : { packageName }),
			]);

			expect(result.webApps.map((app) => app.name)).toEqual([name]);
			expect(result.prototypeRoots.get(root)).toBe(`apps/${name}`);
		});

		it("refuses an invalid package name with a sentence naming the fix", async () => {
			expect(
				await refusal([
					observed("apps/web"),
					observed("apps/Admin_Panel", { packageName: "@acme/Admin_Panel" }),
				]),
			).toBe(
				"We couldn't adopt apps/Admin_Panel: Admin_Panel isn't a valid web app name. Start with a lowercase letter and use only lowercase letters, numbers and hyphens. Forge names a web app after its package, so rename @acme/Admin_Panel and run forge init again.",
			);
		});

		it("refuses an invalid directory name when the app has no package name", async () => {
			expect(
				await refusal([observed("apps/web"), observed("apps/Admin_Panel")]),
			).toBe(
				"We couldn't adopt apps/Admin_Panel: Admin_Panel isn't a valid web app name. Start with a lowercase letter and use only lowercase letters, numbers and hyphens. Forge names a web app after its package, so give apps/Admin_Panel a package name and run forge init again.",
			);
		});

		it.each(reservedWebAppNames)(
			"refuses the reserved name %s",
			async (name) => {
				expect(
					await refusal([
						observed("apps/web"),
						observed(`apps/${name}`, { packageName: `@acme/${name}` }),
					]),
				).toBe(
					`We couldn't adopt apps/${name}: ${name} is reserved. Pick another name for this web app. Forge names a web app after its package, so rename @acme/${name} and run forge init again.`,
				);
			},
		);

		it("refuses a secondary named after a loaded addon", async () => {
			expect(
				await refusal([
					observed("apps/web"),
					observed("apps/biome", { packageName: "@acme/biome" }),
				]),
			).toBe(
				"We couldn't adopt apps/biome: biome is an addon id. Pick another name for this web app. Forge names a web app after its package, so rename @acme/biome and run forge init again.",
			);
		});

		it("refuses two roots that resolve to the same name", async () => {
			expect(
				await refusal([
					observed("apps/admin"),
					observed("apps/web"),
					observed("sites/admin", {
						scriptPort: { kind: "literal", port: 3003 },
					}),
				]),
			).toBe(
				"We couldn't adopt apps/admin and sites/admin because each would be the web app named admin. Rename one package and run forge init again.",
			);
		});
	});

	describe("ports", () => {
		it.each([
			[{ dev: "next dev -p3001" }, 3001],
			[{ dev: "next dev --port=3002" }, 3002],
			[{ dev: "PORT=3003 next dev" }, 3003],
		])("reads %o as port %i", (scripts, port) => {
			expect(scriptPort(scripts)).toEqual({ kind: "literal", port });
		});

		it.each(["next dev --profile 3001", "next dev pre-p3001"])(
			"ignores embedded short flags in %s",
			(dev) => {
				expect(scriptPort({ dev })).toEqual({ kind: "absent" });
			},
		);

		it.each([
			["next dev --port 3002", 3002],
			["pnpm with-env next dev --port=3003", 3003],
			["next dev -p 3004", 3004],
			["PORT=3005 node server.js", 3005],
			["dotenv -e ../../.env -v PORT=3006 -- vite", 3006],
		])("reads %s as port %i", (dev, port) => {
			expect(scriptPort({ dev })).toEqual({ kind: "literal", port });
		});

		it("reads one port shared by dev and start", () => {
			expect(
				scriptPort({
					dev: "next dev --port 3002",
					start: "next start --port 3002",
				}),
			).toEqual({ kind: "literal", port: 3002 });
		});

		it("ignores scripts other than dev and start and variable ports", () => {
			expect(
				scriptPort({ dev: "next dev --port $PORT", preview: "vite -p 4000" }),
			).toEqual({ kind: "absent" });

			expect(scriptPort(undefined)).toEqual({ kind: "absent" });
		});

		it("refuses dev and start scripts that disagree", async () => {
			const conflict = scriptPort({
				dev: "next dev --port 3002",
				start: "next start --port 3003",
			});

			expect(conflict).toEqual({ kind: "conflict", dev: 3002, start: 3003 });
			expect(
				await refusal([
					observed("apps/web"),
					observed("apps/site", { scriptPort: conflict }),
				]),
			).toBe(
				"We couldn't adopt apps/site because its dev script uses port 3002 but its start script uses port 3003. Use one port in both and run forge init again.",
			);
		});

		it.each([
			[
				{ dev: "next dev -p3001 && node proxy.js -p 9000" },
				{ kind: "ambiguous", dev: [3001, 9000], start: [] },
			],
			[
				{ dev: "next dev --port 3002 && node proxy.js --port 9000" },
				{ kind: "ambiguous", dev: [3002, 9000], start: [] },
			],
			[
				{
					dev: "next dev --port 3002 && node proxy.js --port 9000",
					start: "next start --port 3002",
				},
				{ kind: "ambiguous", dev: [3002, 9000], start: [3002] },
			],
			[
				{
					dev: "next dev --port 3002",
					start: "PORT=9000 next start --port 3002",
				},
				{ kind: "ambiguous", dev: [3002], start: [3002, 9000] },
			],
		])("reads %o as ambiguous without inferring a port", (scripts, port) => {
			expect(scriptPort(scripts)).toEqual(port);
		});

		const proxied = "next dev --port 3002 && node proxy.js --port 9000";
		const severalPortsRefusal = (start: string) =>
			`We couldn't adopt apps/site because its dev script names ports 3002 and 9000 and its start script names port ${start}, and Forge can't tell which one the app serves on. Set webApps[].port in the init config to that port and run forge init again.`;

		const singleScriptRefusal =
			"We couldn't adopt apps/site because its dev script names several ports, 3002 and 9000, and Forge can't tell which one the app serves on. Set webApps[].port in the init config to that port and run forge init again.";

		it.each([
			["next start --port 9000", undefined, severalPortsRefusal("9000")],
			["next start --port 9000", 3002, 3002],
			["next start --port 9000", 7000, severalPortsRefusal("9000")],
			["next start --port 3002", undefined, severalPortsRefusal("3002")],
			["next start --port 3002", 3002, 3002],
			["next start --port 3002", 9000, 9000],
			["next start --port 4000", undefined, severalPortsRefusal("4000")],
			["next start --port 4000", 3002, 3002],
			["next start --port 4000", 4000, 4000],
			[undefined, undefined, singleScriptRefusal],
			[undefined, 3002, 3002],
			[undefined, 4000, singleScriptRefusal],
		])(
			"settles a proxied dev script with start %s and config port %s",
			async (start, port, expected) => {
				const effect = resolve(
					[
						observed("apps/web"),
						observed("apps/site", {
							scriptPort: scriptPort({
								dev: proxied,
								...(start === undefined ? {} : { start }),
							}),
						}),
					],
					port === undefined
						? {}
						: {
								requested: {
									webApps: [{ name: "site", framework: "nextjs", port }],
								},
							},
				);

				if (typeof expected === "number")
					expect((await Effect.runPromise(effect)).webApps).toEqual([
						{ name: "site", framework: "nextjs", port: expected },
					]);
				else
					expect((await Effect.runPromise(Effect.flip(effect))).message).toBe(
						expected,
					);
			},
		);

		it("refuses a secondary on the primary's own script port", async () => {
			expect(
				await refusal([
					observed("apps/site", {
						scriptPort: { kind: "literal", port: 4000 },
					}),
					observed("apps/web", { scriptPort: { kind: "literal", port: 4000 } }),
				]),
			).toBe(
				"We couldn't adopt these web apps: web and site both use port 4000. Give each app its own port in its dev script and run forge init again.",
			);
		});

		it("adopts a primary whose script port differs from the default", async () => {
			const result = await resolved([
				observed("apps/site"),
				observed("apps/web", { scriptPort: { kind: "literal", port: 4000 } }),
			]);

			expect(result.webApps).toEqual([
				{ name: "site", framework: "nextjs", port: 3002 },
			]);
		});

		it("refuses an app with no port evidence and names the fix", async () => {
			expect(
				await refusal([
					observed("apps/web"),
					observed("apps/site", { scriptPort: { kind: "absent" } }),
				]),
			).toBe(
				"We couldn't adopt apps/site because its dev and start scripts name no port. Put a literal port in its dev script or set webApps[].port in the init config.",
			);
		});

		it("takes a missing port from the init config", async () => {
			const result = await resolved(
				[
					observed("apps/web"),
					observed("apps/site", { scriptPort: { kind: "absent" } }),
				],
				{
					requested: {
						webApps: [{ name: "site", framework: "nextjs", port: 3010 }],
					},
				},
			);

			expect(result.webApps).toEqual([
				{ name: "site", framework: "nextjs", port: 3010 },
			]);
		});

		it("refuses an init config port that disagrees with the scripts", async () => {
			expect(
				await refusal([observed("apps/web"), observed("apps/site")], {
					requested: {
						webApps: [{ name: "site", framework: "nextjs", port: 3010 }],
					},
				}),
			).toBe(
				"We couldn't adopt apps/site because its scripts use port 3002 but your init config sets port 3010. Make them match and run forge init again.",
			);
		});

		it("keeps each port under a reversed config order", async () => {
			const observations = [
				observed("apps/admin", {
					frameworks: ["react-router"],
					scriptPort: { kind: "literal", port: 3003 },
				}),
				observed("apps/site", { scriptPort: { kind: "literal", port: 3002 } }),
				observed("apps/web", { frameworks: ["tanstack-router"] }),
			];

			const result = await resolved(observations, {
				requested: {
					webApps: [
						{ name: "site", framework: "nextjs" },
						{ name: "admin", framework: "react-router" },
					],
				},
			});

			expect(result.webApps).toEqual([
				{ name: "site", framework: "nextjs", port: 3002 },
				{ name: "admin", framework: "react-router", port: 3003 },
			]);
		});

		it("keeps each port in discovery order without a config", async () => {
			const result = await resolved([
				observed("apps/admin", {
					frameworks: ["react-router"],
					scriptPort: { kind: "literal", port: 3003 },
				}),
				observed("apps/site", { scriptPort: { kind: "literal", port: 3002 } }),
				observed("apps/web", { frameworks: ["tanstack-router"] }),
			]);

			expect(result.webApps).toEqual([
				{ name: "admin", framework: "react-router", port: 3003 },
				{ name: "site", framework: "nextjs", port: 3002 },
			]);
		});

		it.each([
			[
				3000,
				"self",
				"We couldn't adopt apps/site on port 3000 because Forge runs the primary web app on port 3000. Give apps/site another port in its dev script and run forge init again.",
			],
			[
				3001,
				"hono",
				"We couldn't adopt these web apps: site can't use port 3001, which the API server uses. Give each app its own port in its dev script and run forge init again.",
			],
		])(
			"refuses port %i beside a %s backend with a sentence",
			async (port, backend, message) => {
				const result = await resolved([
					observed("apps/web"),
					observed("apps/site", { scriptPort: { kind: "literal", port } }),
				]);

				expect(
					adoptionRefusal(result, { backend, slug: "acme" })?.message,
				).toBe(message);
			},
		);

		it("refuses the Forge primary port regardless of its observed script", async () => {
			const result = await resolved([
				observed("apps/web", { scriptPort: { kind: "literal", port: 4000 } }),
				observed("apps/site", { scriptPort: { kind: "literal", port: 3000 } }),
			]);

			const message = adoptionRefusal(result, { slug: "acme" })?.message;
			expect(message).toBe(
				"We couldn't adopt apps/site on port 3000 because Forge runs the primary web app on port 3000. Give apps/site another port in its dev script and run forge init again.",
			);

			expect(message).not.toContain("both use port");
		});

		it("lets a secondary use port 3001 when no API server runs", async () => {
			const result = await resolved([
				observed("apps/web"),
				observed("apps/docs", { scriptPort: { kind: "literal", port: 3001 } }),
			]);

			expect(result.webApps).toEqual([
				{ name: "docs", framework: "nextjs", port: 3001 },
			]);

			expect(
				adoptionRefusal(result, { backend: "self", slug: "acme" }),
			).toBeUndefined();
		});
	});

	describe("binding on later updates", () => {
		async function unbound(observations: ReadonlyArray<WebAppObservation>) {
			const result = await resolved(observations);
			return adoptionRefusal(result, { slug: "acme" })?.message;
		}

		it("refuses two same-framework apps that match neither folder nor package", async () => {
			expect(
				await unbound([
					observed("apps/console", {
						packageName: "@company/admin",
						scriptPort: { kind: "literal", port: 3003 },
					}),
					observed("apps/marketing", { packageName: "@company/site" }),
					observed("apps/web"),
				]),
			).toBe(
				"We couldn't adopt apps/console and apps/marketing because Forge tells web apps of the same framework apart only by their folder or package, and these match neither. On the next update it would look for admin at apps/admin or as @acme/admin and site at apps/site or as @acme/site. Move each app to apps/<its name> or rename its package to @acme/<its name>, then run forge init again.",
			);
		});

		it("says where to set a slug that Forge guessed", async () => {
			const result = await resolved([
				observed("apps/console", {
					packageName: "@company/admin",
					scriptPort: { kind: "literal", port: 3003 },
				}),
				observed("apps/marketing", { packageName: "@company/site" }),
				observed("apps/web"),
			]);

			expect(
				adoptionRefusal(result, { slug: "acme", slugGuessed: true })?.message,
			).toMatch(
				/ Forge guessed the slug acme\. To use another, set slug in an init config and pass it with --config\.$/,
			);
		});

		it("refuses an app whose apps/<name> folder holds another secondary", async () => {
			expect(
				await refusal([
					observed("apps/admin", { packageName: "@acme/site" }),
					observed("apps/web"),
					observed("sites/console", {
						packageName: "@acme/admin",
						scriptPort: { kind: "literal", port: 3003 },
					}),
				]),
			).toBe(
				"We couldn't adopt sites/console as admin because apps/admin is another app you're adopting, and on the next update Forge would treat apps/admin as admin. Rename the package at sites/console or move each app to apps/<its name>, then run forge init again.",
			);
		});

		it("refuses an app whose apps/<name> folder holds the primary", async () => {
			expect(
				await refusal(
					[
						observed("apps/site", {
							frameworks: ["react-router"],
							packageName: "@acme/main",
						}),
						observed("sites/marketing", { packageName: "@acme/site" }),
					],
					{ primaryRoot: "apps/site" },
				),
			).toBe(
				"We couldn't adopt sites/marketing as site because apps/site is another app you're adopting, and on the next update Forge would treat apps/site as site. Rename the package at sites/marketing or move each app to apps/<its name>, then run forge init again.",
			);
		});

		it("adopts a single app that matches neither", async () => {
			expect(
				await unbound([
					observed("apps/marketing", { packageName: "@company/site" }),
					observed("apps/web"),
				]),
			).toBeUndefined();
		});

		it("adopts two unmatched apps of different frameworks", async () => {
			expect(
				await unbound([
					observed("apps/console", {
						frameworks: ["react-router"],
						packageName: "@company/admin",
						scriptPort: { kind: "literal", port: 3003 },
					}),
					observed("apps/marketing", { packageName: "@company/site" }),
					observed("apps/web"),
				]),
			).toBeUndefined();
		});

		it.each([
			["its folder", "apps/admin", "@company/admin"],
			["its package", "sites/control", "@acme/admin"],
		])(
			"adopts an unmatched app beside one bound by %s",
			async (_label, root, packageName) => {
				expect(
					await unbound([
						observed(root, {
							packageName,
							scriptPort: { kind: "literal", port: 3003 },
						}),
						observed("apps/marketing", { packageName: "@company/site" }),
						observed("apps/web"),
					]),
				).toBeUndefined();
			},
		);
	});

	describe("init config entries", () => {
		it("refuses an entry that names no adopted app and lists the names it could mean", async () => {
			expect(
				await refusal(
					[
						observed("apps/web"),
						observed("apps/marketing", { packageName: "@acme/site" }),
					],
					{
						requested: {
							webApps: [
								{ name: "marketing", framework: "nextjs", client: true },
							],
						},
					},
				),
			).toBe(
				"Your init config lists marketing under webApps, but no web app being adopted has that name. Forge names the adopted secondary web apps site, after their packages. Fix webApps in your init config and run forge init again.",
			);
		});

		it("refuses entries when no web app is adopted at all", async () => {
			expect(
				await refusal([], {
					confirmed: [{ kind: "db", root: "packages/db" }],
					requested: {
						webApps: [{ name: "admin", framework: "nextjs" }],
					},
				}),
			).toBe(
				"Your init config lists admin under webApps, but no web app being adopted has that name. Forge isn't adopting any secondary web app here. Fix webApps in your init config and run forge init again.",
			);
		});

		it("refuses entries when no secondary is adopted", async () => {
			expect(
				await refusal([observed("apps/web")], {
					requested: {
						webApps: [
							{ name: "admin", framework: "nextjs" },
							{ name: "docs", framework: "nextjs" },
						],
					},
				}),
			).toBe(
				"Your init config lists admin and docs under webApps, but no web app being adopted has those names. Forge isn't adopting any secondary web app here. Fix webApps in your init config and run forge init again.",
			);
		});
	});

	describe("RPC providers", () => {
		it("refuses adopting a tRPC and an oRPC package together", () => {
			expect(
				rpcProviderRefusal([
					{ kind: "web-app", root: "apps/web" },
					{ kind: "trpc", root: "packages/trpc" },
					{ kind: "orpc", root: "packages/orpc" },
				])?.message,
			).toBe(
				"We couldn't adopt packages/trpc and packages/orpc together: one uses @trpc/server and the other @orpc/server, and Forge manages one RPC provider. Adopt only one of them, with rpc set to match in an init config, then run forge init again.",
			);

			expect(
				rpcProviderRefusal([{ kind: "trpc", root: "packages/trpc" }]),
			).toBeUndefined();
		});
	});

	describe("clients", () => {
		it("records client when the app depends on a confirmed RPC package", async () => {
			const result = await resolved(
				[
					observed("apps/web"),
					observed("apps/site", { rpcPackages: ["packages/trpc"] }),
				],
				{
					confirmed: [
						...web("apps/web", "apps/site"),
						{ kind: "trpc", root: "packages/trpc" },
					],
				},
			);

			expect(result.webApps).toEqual([
				{ name: "site", framework: "nextjs", port: 3002, client: true },
			]);
		});

		it("records no client when the RPC package it uses isn't adopted", async () => {
			const result = await resolved(
				[
					observed("apps/web"),
					observed("apps/site", { rpcPackages: ["packages/trpc"] }),
				],
				{
					confirmed: [
						...web("apps/web", "apps/site"),
						{ kind: "orpc", root: "packages/orpc" },
					],
				},
			);

			expect(result.webApps[0]?.client).toBeUndefined();
		});

		it("keeps an explicit client from the init config", async () => {
			const result = await resolved(
				[observed("apps/web"), observed("apps/site")],
				{
					requested: {
						webApps: [{ name: "site", framework: "nextjs", client: true }],
					},
				},
			);

			expect(result.webApps[0]?.client).toBe(true);
		});
	});

	describe("primary", () => {
		it.each([
			[["apps/web", "apps/admin"]],
			[["apps/admin", "apps/web"]],
			[["apps/zeta", "apps/web", "apps/alpha"]],
		])("chooses apps/web from %j", (roots) => {
			expect(primaryWebRoot(roots)).toBe("apps/web");
		});

		it("chooses a lone web root and nothing for two without apps/web", () => {
			expect(primaryWebRoot(["apps/site"])).toBe("apps/site");
			expect(primaryWebRoot(["apps/admin", "apps/frontend"])).toBeUndefined();
			expect(primaryWebRoot([])).toBeUndefined();
		});

		it("refuses without a chosen primary", async () => {
			expect(
				await refusal(
					[
						observed("apps/admin", { frameworks: ["react-router"] }),
						observed("apps/frontend"),
					],
					{ primaryRoot: "apps/missing" },
				),
			).toBe(
				"We couldn't choose a primary web app because apps/web isn't being adopted. Run forge init interactively and choose one.",
			);
		});

		it("promotes the chosen root with its own framework", async () => {
			const result = await resolved(
				[
					observed("apps/admin", {
						frameworks: ["react-router"],
						scriptPort: { kind: "absent" },
					}),
					observed("apps/frontend"),
				],
				{ primaryRoot: "apps/admin" },
			);

			expect(result.web).toBe("react-router");
			expect(result.webApps).toEqual([
				{ name: "frontend", framework: "nextjs", port: 3002 },
			]);

			expect([...result.prototypeRoots]).toEqual([
				["apps/admin", "apps/admin"],
				["apps/frontend", "apps/frontend"],
			]);
		});

		it("resolves nothing when no web app is confirmed", async () => {
			const result = await resolved([observed("apps/web")], {
				confirmed: [],
			});

			expect(result).toEqual({
				webApps: [],
				secondaries: [],
				prototypeRoots: new Map(),
			});

			expect(adoptedWebConfig(result, { web: "nextjs" })).toEqual({});
		});
	});

	describe("config", () => {
		it("seeds web, platforms and secondaries", async () => {
			const result = await resolved([
				observed("apps/web"),
				observed("apps/site"),
			]);

			expect(adoptedWebConfig(result, {})).toEqual({
				platforms: ["web"],
				web: "nextjs",
				webApps: [{ name: "site", framework: "nextjs", port: 3002 }],
			});

			expect(
				adoptedWebConfig(result, { platforms: ["web", "mobile"] }),
			).toEqual({
				web: "nextjs",
				webApps: [{ name: "site", framework: "nextjs", port: 3002 }],
			});
		});

		it("omits webApps for a single app unless the config named some", async () => {
			const result = await resolved([observed("apps/web")]);
			expect(adoptedWebConfig(result, {})).toEqual({
				platforms: ["web"],
				web: "nextjs",
			});

			expect(adoptedWebConfig(result, { webApps: [] })).toEqual({
				platforms: ["web"],
				web: "nextjs",
				webApps: [],
			});
		});
	});

	describe("display", () => {
		it.each(sentences)("describes %j in a sentence", (webApps, sentence) => {
			expect(secondaryWebAppsSentence(webApps)).toBe(sentence);
			expect(secondaryWebAppsSentence(webApps)).not.toContain("[object");
		});

		it("says nothing without secondaries", () => {
			expect(secondaryWebAppsSentence([])).toBeUndefined();
			expect(secondaryWebAppsSentence(undefined)).toBeUndefined();
		});
	});
});
