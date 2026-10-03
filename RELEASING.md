# Releasing

## Accept-risk ledger

Risks we took on knowingly, with what bounds each one.

| date       | decision                                                                         | bound                                                                       |
| ---------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 2026-10-03 | The manifest records the CLI version that last wrote it in `cliVersion`.        | Stamp only, no telemetry, no network call on any command.                   |

## Activation

Releases are on hold. Lifting the hold is the maintainer's act, done once,
in this order.

1. Write the first change file, `.tegami/<name>.md` naming
   `group:forge: minor`, and merge it to `main`.
2. On a clean checkout of `main`, run `pnpm tegami version` and check that
   `@ryuugg/forge`, `@ryuugg/core` and `@ryuugg/generators` all land on
   `0.1.0`. Without `CI` set it opens nothing. Keep the changes for the next
   two steps.
3. Run `npm login`.
4. Run `pnpm tegami npm pretrust` in that checkout. It publishes a
   placeholder `0.0.0-tegami-trusted-publish-setup` under the `temp`
   dist-tag for each name and trusts `publish.yml` on `ryuudotgg/forge`.
   Then discard the local changes from step 2.
5. Create the `npm` environment on the repository with `ryuudotgg` as
   required reviewer and prevent self review off. The Publish workflow
   refuses to publish without it.
6. Run the Release workflow, merge the `chore: release 0.1.0` pull request
   and approve the `npm` deployment on the Publish run it starts.
7. Confirm `npm view @ryuugg/forge dist.attestations` is non-empty.
