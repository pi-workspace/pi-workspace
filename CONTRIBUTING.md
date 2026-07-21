# Contributing to Pi Workspace

Thank you for helping improve Pi Workspace. This guide explains the contribution workflow and the checks expected before review.

Participation in this repository is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md). Report vulnerabilities through the private process in [`SECURITY.md`](./SECURITY.md), not a public issue.

## Before you start

- Search existing issues and pull requests before opening a duplicate.
- Use the bug or feature issue form when proposing user-visible work.
- Discuss broad product, terminology, dependency, security, or architecture changes before implementing them.
- Keep changes focused on one resolved problem. Do not add speculative compatibility, migrations, abstractions, or features.
- Read [`AGENTS.md`](./AGENTS.md) for repository engineering standards and [`CONTEXT.md`](./CONTEXT.md) for established domain language. Do not make terminology-wide changes without prior agreement.

## Development setup

Pi Workspace supports development with Bun 1.3.14 on Debian-based Linux and macOS. Release validation also uses GitHub-hosted macOS runners for the signed, notarized macOS beta.

```sh
git clone https://github.com/pi-workspace/pi-workspace.git
cd pi-workspace
bun install --frozen-lockfile
bun run dev
```

The application uses the local Pi configuration supplied by `@earendil-works/pi-coding-agent`. The isolated browser demo uses fictional in-memory data and does not require a model provider:

```sh
bun run demo
```

## Architecture

Pi Workspace is an Electron application with explicit privilege boundaries:

- `src/main/` owns Electron lifecycle, local persistence, Pi Session runtimes, filesystem access, and IPC handlers.
- `src/preload/` exposes the narrow, context-isolated `window.piWorkspace` bridge.
- `src/renderer/` contains the unprivileged React interface.
- Root `src/*.ts` and `src/*-ipc.ts` modules define renderer-safe domain data, bridge contracts, and IPC payload parsing.
- `src/domain/` contains shared domain types.
- `src/demo/` runs the normal renderer against an isolated in-memory bridge.
- `components/ui-kit/` contains the separately licensed Catalyst-derived UI kit described in [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).

Keep privileged implementation details and local paths out of renderer-facing contracts. New IPC operations must validate both their trusted sender and their payload at the main-process boundary.

## Make a change

1. Create a focused branch from the latest `main`.
2. Add or update focused tests when behavior changes.
3. Follow the existing module boundaries and repository naming rules.
4. Format changed files and run the complete quality gate:

   ```sh
   bun run check
   ```

5. On Linux, run the verified secret and dependency scan when changing dependencies, release automation, authentication, IPC, or other security-sensitive code:

   ```sh
   bun run security:scan
   ```

6. Commit using a [Conventional Commit](https://www.conventionalcommits.org/) message.
7. Open a pull request using the repository template and report exact validation commands and results.

Do not commit generated `dist/`, `release/`, dependency, credential, local Pi, or worktree files.

## Tests and validation

Tests are co-located with the behavior they cover. Each test should verify one behavior through a public interface and should not test third-party implementation details. Prefer focused integration-style coverage where it provides value; do not pursue coverage percentages as a goal.

The required quality gate runs:

```text
bun run format:check
bun run lint
bun run typecheck
bun run test
bun run build
```

Pull requests also run Gitleaks and OSV-Scanner. When the repository becomes public, dependency review and CodeQL will join those checks.

## Pull-request review

A pull request should:

- Explain the user or contributor problem and the chosen solution.
- Link its issue when one exists.
- Keep unrelated refactoring out of the diff.
- Include tests for changed behavior where focused automation provides value.
- Update public, contributor, security, or release documentation when its contract changes.
- Identify any new dependency, asset, copied code, generated file, or license implication.
- Pass the quality and security checks.

Review may request changes for correctness, security, accessibility, maintainability, product scope, terminology, tests, documentation, or licensing.

## Contribution licensing

Pi Workspace does not currently require a Contributor License Agreement or Developer Certificate of Origin. Under section 5 of the Apache License, Version 2.0, an intentionally submitted contribution to the Apache-licensed portions of Pi Workspace is provided under Apache-2.0 unless it is conspicuously marked otherwise or covered by a separate agreement.

This does not relicense third-party material. Do not submit copied or adapted code, design assets, fonts, icons, screenshots, or other content unless you have the right to contribute it under terms compatible with this repository and disclose its source and license in the pull request.

Changes to `components/ui-kit/` remain subject to the Tailwind Plus license rather than Apache-2.0. Do not submit changes to those files without prior maintainer approval and confirmation that the contribution complies with the applicable Tailwind Plus terms. Reusable extraction or separate redistribution of that source is not accepted.
