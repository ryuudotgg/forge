# Contributing to Ryuu's Forge

Thanks for your interest in contributing to Ryuu's Forge! This document outlines the process and guidelines for contributing.

## Getting Started

### 1. Fork the Repository

Click the "Fork" button on GitHub to create your own copy of the repository.

### 2. Clone Your Fork

```bash
git clone git@github.com:YOUR_USERNAME/forge.git
cd forge
```

### 3. Install Dependencies

```bash
pnpm install
```

### 4. Create a Branch

Use a descriptive name following our branch naming convention:

```bash
git checkout -b feat/something-awesome
```

Branch prefixes:

- `feat/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation updates
- `chore/` - Maintenance tasks
- `refactor/` - Code refactoring

## Development Workflow

We follow strict development guidelines to maintain code quality and consistency. Please read our [Development Guide](contributing/DEVELOPMENT.md) for detailed information about our coding standards, testing requirements, and development workflow.

## Pull Request Process

For detailed information about our contribution process, including PR guidelines, review process, and merge strategy, please refer to our [Pull Request Guide](contributing/PULL_REQUESTS.md).

## Notable Features

- 🏗️ **Type Safety** - Full type-safety with strict type checking
- 📦 **PNPM** - Fast, disk-efficient package management
- 🏃 **Turborepo** - High-performance build system
- 📝 **Biome** - Fast and consistent code style
- 🧪 **Vitest** - Testing framework
- 🚀 **GitHub Actions** - CI/CD workflows

## Code Style Principles

We prioritize:

- Strong typing with TypeScript
- Modern React patterns
- Clean, readable code over clever solutions
- Proper component typing
- Function components over class components
- Descriptive naming over brevity

## Documentation

For any new features or changes:

1. Update relevant documentation in the `apps/web` directory
2. Add inline code documentation for complex logic
3. Update README if adding new features or changing setup steps

## Need Help?

- **Questions**: [GitHub Discussions](https://github.com/ryuudotgg/forge/discussions)
- **Issues**: [GitHub Issues](https://github.com/ryuudotgg/forge/issues)
- **Documentation**: [Forge Docs](https://forge.ryuu.gg/docs)
- **Community**: [Discord](https://discord.gg/YaarU42KxQ)

## Good First Issues

Looking for a place to start? Check our [good first issues](https://github.com/ryuudotgg/forge/issues?q=is:open+is:issue+label:%22good+first+issue%22) for bugs or features with a relatively limited scope.

## License

By contributing to Ryuu's Forge, you agree that your contributions will be licensed under its [MIT license](LICENSE.md).
