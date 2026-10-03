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

`@ryuugg/core` and `@ryuugg/generators` still pack and publish. The CLI no
longer needs them at runtime, so whether they ship stays an open call for
activation.
