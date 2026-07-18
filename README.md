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
  <a href="https://forge.ryuu.gg">Website</a>
  ·
  <a href="https://forge.ryuu.gg/docs">Documentation</a>
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
pnpm dlx @ryuujs/forge
# or
npx @ryuujs/forge
# or
bunx @ryuujs/forge
```

`create` is the default command, so a bare invocation launches the interactive wizard and walks you through your framework, addons, and tooling.

### Commands

| Command | What it does |
| --- | --- |
| `forge` (`create`) | Forge a new project from a framework, template, and addons. |
| `forge add [addon-id]` | Add an addon to your project. |
| `forge remove [addon-id]` | Remove an addon from your project. |
| `forge update` | Reconcile your installed addons and templates. |

### Non-interactive

Skip the prompts by pointing Forge at a JSON config file:

```bash
pnpm dlx @ryuujs/forge --config forge.json
```

Pass `--no-install` to skip dependency installation and `--no-git` to skip Git initialization.

## ✨ Key Features

- 🧩 **Composable addons** - Mix and match frameworks, ORMs, auth, and tooling instead of settling for one fixed template.
- 🔄 **Lifecycle management** - Add, remove, and update addons in an existing project with `add`, `remove`, and `update`.
- 📦 **Your package manager** - Scaffold with pnpm, npm, Yarn, or Bun.
- 🏗️ **Typed end to end** - Strict TypeScript across the whole monorepo.
- ▲ **Next.js** - A modern React app wired up and ready to go.
- 🗄️ **Database your way** - Drizzle or Prisma over PostgreSQL, MySQL, or SQLite, with providers like PlanetScale, Neon, Supabase, and Turso.
- 🔌 **tRPC** - End-to-end typesafe APIs.
- 🔐 **Better Auth** - Authentication ready out of the box.
- 🎨 **Tailwind CSS** - Styling paired with Base UI or Radix components.
- 🛠️ **Batteries included** - Biome, Turborepo, Vitest, and optional GitHub CI, Lefthook, and commitlint.

## 📚 Documentation

Visit our [Documentation](https://forge.ryuu.gg/docs) to view the full documentation

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

We use [SemVer](http://semver.org) for versioning. For available versions, see the [tags on this repository](https://github.com/ryuudotgg/forge/tags).

## 👥 Authors

- Ryuu ([@ryuudotgg](https://github.com/ryuudotgg))

## 🔒 Security

If you believe you have found a security vulnerability, please report it as described in our [Security Policy](SECURITY.md).

## 📄 License

This project is licensed under the MIT License - see [LICENSE.md](LICENSE.md) for details.
