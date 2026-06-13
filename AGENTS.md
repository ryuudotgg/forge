# Agent Guide

Forge is a project-bootstrapper CLI (published as `@ryuujs/forge`). This is
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
- `pnpm test`: full suite. Scope with `--filter`, e.g.
  `pnpm test --filter=@ryuujs/core`.
- `pnpm test:coverage`: coverage with enforced thresholds.
- `pnpm build`: tsdown builds via turbo.

Always finish with the full `pnpm test`, not just the package you touched.

## Conventions

- Effect everywhere: services, typed errors (`Schema.TaggedError`),
  `@effect/platform` for IO. No zod in repo code.
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
