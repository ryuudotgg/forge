<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cdn.ryuu.gg/DargW5gB3W5Z.png">
    <source media="(prefers-color-scheme: light)" srcset="https://cdn.ryuu.gg/EWwq3GD8sJH3.png">
    <img alt="Ryuu's Forge" src="https://cdn.ryuu.gg/EWwq3GD8sJH3.png" width="160">
  </picture>
</p>

<p align="center">
  An all-in-one starter for your next big thing.
</p>

<p align="center">
  <a href="https://github.com/ryuudotgg/forge">GitHub</a>
  ·
  <a href="https://github.com/ryuudotgg/forge/releases">Releases</a>
  ·
  <a href="https://github.com/ryuudotgg/forge/issues">Issues</a>
</p>

<p align="center">
  <a href="LICENSE.md">
    <img src="https://img.shields.io/github/license/ryuudotgg/forge?style=for-the-badge&labelColor=000000" alt="MIT License">
  </a>
  <a href="https://discord.gg/YaarU42KxQ">
    <img src="https://img.shields.io/discord/1131068064637649048?style=for-the-badge&labelColor=000000&color=5865F2&label=Discord" alt="Discord Community">
  </a>
</p>

> **Note**: This project is still a work in progress. 🚧

## What is Ryuu's Forge?

Ryuu's Forge is a powerful CLI tool designed to kickstart your new project in just a few minutes. It gives you complete control over your project's architecture, allowing you to set up all necessary components quickly, and the right way.

## 🚀 Getting Started

Run Forge with your package manager of choice, no install required:

```bash
pnpm dlx @ryuugg/forge
# or
npx @ryuugg/forge
# or
bunx @ryuugg/forge
```

`create` is the default command, so a bare invocation launches the interactive wizard and walks you through your framework, addons, and tooling.

### Secondary web apps

The wizard can add web apps with separate names and frameworks. For flags, repeat
`--web`: a bare framework selects the primary app at `apps/web`, `name=framework`
adds an app at `apps/<name>`, and `name=framework+client` adds one that calls
your API.

```bash
pnpm dlx @ryuugg/forge --web tanstack-router --web admin=nextjs+client
```

An API client is a secondary app with `client: true` on its `webApps` entry, set
by `+client`, by the wizard's API client question, or by `forge add` with
`--client`. Forge wires it to call the API host:

- An RPC client and its provider for tRPC or oRPC, when you picked one.
- A Better Auth client in the app's `lib/auth-client.ts`, when you picked Better Auth.
- An API URL variable, `NEXT_PUBLIC_SERVER_URL` for Next.js or `VITE_SERVER_URL` for the Vite frameworks, defaulting to the API host's local origin.
- CORS trust: the app's local origin goes into `WEB_URLS`, which the API host's CORS rules and Better Auth's trusted origins read.

Apps without `client: true` get none of this. Forge writes `.env` once and never
edits it, so `forge add nextjs --name admin --client` prints the origin to add to
`WEB_URLS` in `.env` instead, and `forge remove admin` prints the one to drop.

### Commands

| Command | What it does |
| --- | --- |
| `forge` (`create`) | Forge a new project from a framework, template, and addons. |
| `forge init` | Record an existing project's Forge configuration and managed modules. |
| `forge add [addon-id]` | Add an addon to your project. |
| `forge remove [addon-id]` | Remove an addon from your project. |
| `forge update` | Reconcile your installed addons and templates. |
| `forge list [query]` | Browse the Forge catalog. |
| `forge info <id>` | Show details for a catalog entry. |

### Adopt an existing project

Run `forge init` from an existing workspace to record its detected configuration, installed addons, and managed modules. Forge writes project metadata under `.forge` and a `forge.json` marker in each adopted module. Existing project files stay unchanged during this first step.

Preview the adoption or reconcile immediately when you are ready:

```bash
pnpm dlx @ryuugg/forge init --dry-run
pnpm dlx @ryuugg/forge init
pnpm dlx @ryuugg/forge update

# Or adopt and reconcile in one command.
pnpm dlx @ryuugg/forge init --reconcile
```

The default flow is intentionally two steps: `forge init` records the current project, then `forge update` reconciles it with Forge's templates and addons. If conflicts surface in an interactive terminal, Forge guides you through each choice. You can also pass `--keep-user` or `--accept-forge` for one policy across the update.

### Non-interactive

Skip the prompts by pointing Forge at a JSON config file:

```bash
pnpm dlx @ryuugg/forge --config forge.json
```

Pass `--no-install` to skip dependency installation and `--no-git` to skip Git initialization.

Config files accept these top level keys. Unknown keys are rejected. Choice values take an ID or display name unless noted.

| Key | Value |
| --- | --- |
| `name` | Project name, up to 15 characters. |
| `slug` | Lowercase project slug, up to 15 characters. |
| `path` | Directory for the project. |
| `runtime` | Node.js, Bun, or Deno. |
| `packageManager` | pnpm, npm, Yarn, or Bun. |
| `catalogs` | Flat or scoped catalogs, requires pnpm. |
| `linter` | Linter choice. |
| `platforms` | Array of platform IDs: web, mobile, or desktop (unavailable). |
| `web` | Primary web framework choice. |
| `webApps` | Array of objects with name, framework, and optional client boolean and port number. |
| `desktop` | Desktop framework choice, currently unavailable. |
| `mobile` | Mobile framework choice. |
| `backend` | Backend framework choice. |
| `rpc` | RPC provider choice. |
| `database` | MySQL, PostgreSQL, or SQLite. |
| `orm` | Drizzle ORM or Prisma. |
| `databaseProvider` | Hosting provider choice, requires a supported database. |
| `authentication` | Authentication provider choice. |
| `authMethods` | Nonempty array of authentication method IDs, requires Better Auth. |
| `authPlugins` | Array of authentication plugin IDs, requires Better Auth. |
| `authenticationCustomUI` | Boolean for a custom authentication UI. |
| `style` | Web styling framework choice. |
| `nativeStyleFramework` | Mobile styling framework choice. |
| `uiLibrary` | UI library ID. |
| `addons` | Array of optional addon IDs. |
| `emailProvider` | Email provider choice. |
| `installDeps` | Boolean to install dependencies. |
| `gitInit` | Boolean to initialize Git. |

Lifecycle commands support explicit conflict resolution:

| Flag | What it does |
| --- | --- |
| `--keep-user` | Keep your value in each conflicted cell while applying Forge's non-conflicting changes. |
| `--accept-forge` | Take Forge's value in each conflicted cell and overwrite conflicting files. |

## ✨ Key Features

- 🧩 **Composable addons** - Mix and match frameworks, ORMs, auth, and tooling instead of settling for one fixed template.
- 🔄 **Lifecycle management** - Add, remove, and update addons in an existing project with `add`, `remove`, and `update`.
- 📦 **Your package manager** - Scaffold with pnpm, npm, Yarn, or Bun.
- 🏗️ **Typed end to end** - Strict TypeScript across the whole monorepo.
- ▲ **Next.js, React Router, TanStack Router, and TanStack Start** - Modern React apps wired up and ready to go.
- 🔥 **Hono backend** - Run tRPC and Better Auth in a standalone Node.js API app.
- 🗄️ **Database your way** - Drizzle or Prisma over PostgreSQL, MySQL, or SQLite, with providers like PlanetScale, Neon, Supabase, and Turso.
- 🔌 **tRPC** - End-to-end typesafe APIs.
- 🔐 **Better Auth** - Authentication ready out of the box.
- 🎨 **Tailwind CSS** - Styling paired with Base UI or Radix components.
- 🛠️ **Batteries included** - Biome, Turborepo, Vitest, and optional GitHub CI, Lefthook, and commitlint.

## 📚 Documentation

The documentation site is not live yet. Until it is, this README covers usage, and [GitHub Discussions](https://github.com/ryuudotgg/forge/discussions) is the place for questions.

## 🤝 Contributing

We welcome and highly appreciate contributions! However, before you jump right into it, we
would like you to review our [Contributing Guidelines](CONTRIBUTING.md) to make sure you
have a smooth experience.

### Good First Issues

We have a list of [good first issues](https://github.com/ryuudotgg/forge/issues?q=is:open+is:issue+label:%22good+first+issue%22) that have a relatively limited scope. This is a great place for newcomers to start, gain experience, and get familiar with our contribution process.

## 🛡️ Code of Conduct

We have a [Code of Conduct](CODE_OF_CONDUCT.md) in place to ensure a welcoming and inclusive environment for all contributors. You are **highly encouraged** to read and adhere to it.

## 🔧 Support

- 🌟 Star this repo to show support
- 🎯 Report issues on [GitHub](https://github.com/ryuudotgg/forge/issues)
- 💬 Ask questions in [GitHub Discussions](https://github.com/ryuudotgg/forge/discussions)
- 🔊 Join our community on [Discord](https://discord.gg/YaarU42KxQ)

## 📝 Versioning

Forge follows [SemVer](https://semver.org). The CLI and its packages share one version number, and each release will be tagged `vx.y.z`. Once releases are published, every version and its changelog will be listed on the [releases page](https://github.com/ryuudotgg/forge/releases).

## 👥 Authors

- Ryuu ([@ryuudotgg](https://github.com/ryuudotgg))

## 🔒 Security

If you believe you have found a security vulnerability, please report it as described in our [Security Policy](SECURITY.md).

## 📄 License

This project is licensed under the MIT License - see [LICENSE.md](LICENSE.md) for details.
