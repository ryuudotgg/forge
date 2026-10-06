# Releasing

## Accept-risk ledger

Risks we took on knowingly, with what bounds each one.

| date       | decision                                                                                                                                                 | bound                                                            |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 2026-10-03 | The manifest records the CLI version that last wrote it in `cliVersion`, and `add`, `remove` and `update` read it to refuse a downgrade by an older CLI. | Read locally only, no telemetry, no network call on any command. |

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

Releases are on hold. Lifting the hold is the maintainer's act, done once,
in this order.

1. Write the first change file, `.tegami/<name>.md` naming
   `"@ryuugg/forge": minor`, and merge it to `main`.
2. On a clean checkout of `main`, run `pnpm tegami version` and check that
   `@ryuugg/forge` lands on `0.1.0`. Without `CI` set it opens nothing. Keep
   the changes for the next two steps.
3. Run `npm login`.
4. Run `pnpm tegami npm pretrust` in that checkout. It publishes a
   placeholder `0.0.0-tegami-trusted-publish-setup` of `@ryuugg/forge` under
   the `temp` dist-tag and trusts `publish.yml` on `ryuudotgg/forge`.
   Then discard the local changes from step 2.
5. Create the `npm` environment on the repository with `ryuudotgg` as
   required reviewer and prevent self review off. The Publish workflow
   refuses to publish without it.
6. Run the Release workflow, merge the `chore: release 0.1.0` pull request
   and approve the `npm` deployment on the Publish run it starts.
7. Confirm `npm view @ryuugg/forge dist.attestations` is non-empty.
