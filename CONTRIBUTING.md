# Contributing to PDF Palooza

First off, thank you for considering contributing to PDF Palooza! It's people like you that make it such a great tool.

## Branching Strategy

We use GitHub Flow. This means:

1. The `main` branch is always stable and deployable.
2. Any new features or bug fixes should be done on a branch created from `main`.
3. Branch names should be descriptive (e.g., `feature/add-pdf-merge`, `bugfix/fix-upload-crash`).

## Getting Started

1. Create a new branch from `main`:
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feature/your-feature-name
   ```
2. Make your changes in the codebase.
3. Run the development server and check your changes:
   ```bash
   npm run dev
   ```

## Commit Conventions

We follow the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) specification.

- `feat:` for new features
- `fix:` for bug fixes
- `docs:` for documentation changes
- `style:` for formatting, missing semi colons, etc
- `refactor:` for refactoring production code
- `test:` for adding missing tests
- `chore:` for updating grunt tasks etc

## Pull Request Process

1. Ensure your code passes all linting and formatting checks. We use Husky and lint-staged to automate this on commit.
2. Push your branch to GitHub.
3. Open a Pull Request against the `main` branch.
4. Fill out the Pull Request Template.
5. Request a review from at least one other collaborator.
6. Once approved and CI passes, your PR can be squash-merged into `main`.
