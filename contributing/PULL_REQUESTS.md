# Pull Request Guidelines

## Before Creating a PR

1. Create or reference an issue on [GitHub](https://github.com/ryuudotgg/forge/issues)
2. Fork the repository
3. Create a feature branch with an appropriate name
4. Write tests for new functionality
5. Ensure all tests pass
6. Update relevant documentation

## PR Checklist

- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] Code follows style guidelines
- [ ] Branch is up to date with main
- [ ] All checks passing
- [ ] PR description clearly explains the changes

## PR Title Format

We follow [Conventional Commits](https://www.conventionalcommits.org) for PR titles:

```
<type>[(optional scope)][!]: <description>
```

### Types

- `feat`: New Features (MINOR in semver)
- `fix`: Bug Fixes (PATCH in semver)
- `docs`: Documentation Changes
- `style`: Code Style Changes (whitespace, formatting)
- `refactor`: Code Changes (no new features/fixes)
- `perf`: Performance Improvements
- `test`: Adding/Updating Tests
- `build`: Build System/Dependency Changes
- `ci`: CI Configuration Changes
- `chore`: Other Changes (non src/test files)

### Scope

Optional scope providing context:

- `app`: Main Application
- `docs`: Documentation
- `design`: Design System
- `deps`: Dependency Updates

### Breaking Changes

For breaking changes, either:

- Add a `!` before the colon: `feat!: remove legacy API`
- Include `BREAKING CHANGE:` in the PR description

### Examples

```
feat(auth): add social login options
docs: update deployment instructions
feat!: redesign comment system
refactor(design): simplify button component API
```

## PR Description Guidelines

A good PR description should:

1. Reference related issues: `Fixes #123`
2. Explain why this change is necessary
3. Describe how the change addresses the issue
4. Note any important implementation details
5. Mention any testing considerations

## Draft PRs

Use GitHub's Draft PR feature when:

- Your work is not yet ready for review
- You want early feedback on approach
- You're blocked and need assistance

Change to "Ready for Review" when your PR is complete.

## Review Process

1. Automated Checks

   - All CI workflows must pass
   - Style and linting must pass
   - Tests must pass

2. Code Review

   - At least one approval from maintainers required
   - Address all requested changes
   - Respond to all comments

3. Merge Strategy
   - PRs are squashed when merged
   - The PR title becomes the commit message
   - Keep titles clear and descriptive
