# Releasing

## Accept-risk ledger

Risks we took on knowingly, with what bounds each one.

| date       | decision                                                                         | bound                                                                       |
| ---------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 2026-10-03 | The manifest records the CLI version that last wrote it in `cliVersion`.        | Stamp only, no telemetry, no network call on any command.                   |

## Bundle decision

The CLI bundles its runtime. tsdown inlines effect, the platform packages, the
prompts and `@ryuugg/core` and `@ryuugg/generators` into `dist/`, and copies
the generator templates next to it, so `@ryuugg/forge` declares no runtime
dependencies.

Measured on 2026-10-03 by packing all three packages, then running
`pnpm add <forge tarball>` into an empty project (core and generators supplied
as overrides, since they are not on npm), with `du -sh node_modules` and
`find node_modules -type f | wc -l`:

| build                                 | runtime deps | `du -sh node_modules` | files |
| ------------------------------------- | ------------ | --------------------- | ----- |
| merge base 33aae14, deps externalized | 8            | 76M                   | 6156  |
| bundled, this change                  | 0            | 1.1M                  | 162   |

The externalized install also pulled undici, a dependency of
`@effect/platform-node`, and redis, one of its peers. The bundle imports
neither.

A registry package still loads under the bundle. It resolves `effect` from the
project it is installed in, not from the CLI, so a registry that imports
`effect` must declare it as a dependency rather than lean on a copy the CLI
used to hoist. The registry smoke covers this with a fixture that declares its
own `effect` and returns an Effect from its `contribute`, which the bundled CLI
runs. A registry pinned to a different effect version is untested. The
externalized build had the same exposure: it shared the CLI's copy only when
the project happened to dedupe it, and never when Forge ran through npx.

Only `@ryuugg/forge` publishes. `@ryuugg/core` and `@ryuugg/generators` are
private workspace packages: they keep their place in the monorepo and reach
users only inside the CLI bundle. The tarball smoke fails if either loses
`private: true`.

## Activation

Releases are on hold. The Publish workflow in `.depot/workflows/publish.yml`
is disabled by its pending job condition. Do not remove that condition or
write the first change file until the maintainer has completed these steps:

1. Configure npm authentication that works from Depot CI. The previous
   GitHub trusted publisher setup does not authenticate Depot jobs. Do not
   run `pnpm tegami npm pretrust` for this migration.
2. Implement an enforced approval mechanism for publishing in Depot CI.
   Depot does not enforce GitHub deployment environments. Creating the
   GitHub `npm` environment, or checking its reviewer configuration, does
   not require approval before a Depot job publishes.
3. Update the disabled Publish workflow to use that authentication and
   approval mechanism. Remove its GitHub environment configuration check
   and align its provenance settings with the chosen publishing method.
4. Verify that publishing refuses to run without approval and that the
   approved path authenticates to npm. Only then enable the pending job.
5. Configure the Release workflow's `DEPOT_TOKEN` secret so it can dispatch
   CI and Smoke against the version branch.

After these prerequisites are verified, lifting the hold is the
maintainer's act, done once, in this order.

1. Write the first change file, `.tegami/<name>.md` naming
   `"@ryuugg/forge": minor`, and merge it to `main`.
2. On a clean checkout of `main`, run `pnpm tegami version` and check that
   `@ryuugg/forge` lands on `0.1.0`. Without `CI` set it opens nothing. Keep
   the changes for the next two steps.
3. Discard the local version preview from step 2. Dispatch the Release
   workflow on `main` through Depot CI, review and merge the
   `chore: release 0.1.0` pull request, and approve publishing through the
   mechanism verified above.
4. Confirm the published package version and validate provenance according
   to the configured publishing method. Do not assume GitHub trusted
   publishing attestations are available from Depot.
