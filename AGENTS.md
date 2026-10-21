# Agent Guide

Forge is a project-bootstrapper CLI (published as `@ryuugg/forge`). This is
a pnpm + turbo monorepo. The CLI scaffolds new monorepos from composable
addon definitions.

## Layout

- `packages/cli`: CLI entry, interactive steps, lifecycle commands (add,
  remove, update).
- `packages/core`: planning/apply engine (manifest, lockfile, artifact
  reconciliation) plus sort/merge/format primitives.
- `packages/generators`: addon definitions (frameworks, orm, auth, ui,
  tooling), scaffold templates in `templates/`, and the versions catalog
  shipped to generated projects (`src/versions.ts`).
- `tests/scenarios`: e2e scenarios that build the CLI and run real package
  managers. Excluded from coverage.
- `tooling/temper`: in-house coverage report tool (thresholds in
  `thresholds.ts`).

## Commands (run from the repo root)

- `pnpm check` / `pnpm check:fix`: Biome lint + format (fix mode writes).
- `pnpm typecheck`: per-package tsc.
- `pnpm test:unit`: fast package-only inner loop.
- `pnpm test`: full suite. Scope with `--filter`, e.g.
  `pnpm test --filter=@ryuugg/core`.
- `pnpm test:coverage`: coverage with enforced thresholds.
- `pnpm build`: tsdown builds via turbo.

Always finish with the full `pnpm test`, not just the package you touched.

Never set `FORGE_SMOKE` locally. Smoke runs in CI only, in
`.depot/workflows/smoke.yml`: read both Install Smoke shards on the PR. The
Install Smoke Gate also passes when they are skipped, so it alone proves
nothing.

## Conventions

- Effect everywhere: services (`Context.Service`), typed errors
  (`Schema.TaggedError`), and `FileSystem` from `effect` for IO.
  No zod in repo code.
- Never use `as` casts; prove types instead. Never use `any`.
- Tests live in each package's `tests/` directory, never in `src`.
- User-facing CLI messages are natural sentences; format lists with
  `Intl.ListFormat` (see `packages/cli/src/utils/list.ts`).
- Tooling/infra errors throw a Title Case prefix plus detail, e.g.
  `Addon Not Found: ${id}`.
- Declare devDependencies in the package that uses them; versions flow
  through the catalogs in `pnpm-workspace.yaml`.
- Commits: conventional, single line, under 50 characters, no body.
- Branch off `origin/main` with `--no-track`.

## Releases

Releases go through Tegami (`scripts/tegami.mts`). When to add a change
file, its format and which bump to pick are in the Change files section of
`contributing/DEVELOPMENT.md`.

- Releases are on hold: add no change file under `.tegami/` until the
  maintainer lifts it.
- Never edit a `CHANGELOG.md` or `.tegami/publish-lock.yaml` by hand.
- Never change a package version by hand. The Release workflow bumps it in
  the version pull request.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
