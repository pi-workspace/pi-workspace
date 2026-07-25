# Railyard rebrand exploration

**Status:** desktop rebrand implementation in progress.
**Explored:** 2026-07-25

## Confirmed brand direction

The supplied `Railyard Logo Assets` selects **The Switch** mark: a rail turnout representing one track branching into two (Brainstorm → Implement, or one Repository → parallel worktrees).

- Product name: **Railyard**
- Mark: `The Switch`
- Primary type: Space Grotesk; labels/code/metadata: IBM Plex Mono
- Ink: `#141210`; cream: `#F6F2EA`; paper: `#EFECE4`
- Amber: `#F2A93B` on dark surfaces, `#E08A1E` on light surfaces
- Supplied source assets: SVG lockups and symbols plus app-icon PNGs at 32, 64, 128, 256, and 512 px.

The supplied README header also offers a candidate positioning statement: “A visual workspace for organising and running AI coding sessions. Built on the Pi Agent SDK.” It claims Windows is “in progress,” which is no longer accurate: this repository releases Windows 11 x64 builds. Treat it as a design reference, not ready-to-copy product copy.

## Implementation progress

Completed in the desktop repository:

- Railyard SVG/PNG assets, generated Linux PNG sizes, Windows ICO, macOS ICNS, and a refreshed product screenshot.
- Space Grotesk and IBM Plex Mono bundled locally, Railyard semantic light/dark tokens, visible product identity, and persisted `pi-workspace` theme normalization.
- New Railyard package/app IDs, executable, desktop entry, artifacts, native icons, release-workflow assertions, documentation, and community copy.
- New `railyard/…` branches for newly created worktrees; existing stored `pi-workspace/…` branch records remain valid.
- A first-launch legacy-data copy that rewrites owned Session and application-database paths without merging an existing Railyard directory.
- Focused theme, settings, worktree, and user-data migration tests. The Linux package was built and manually inspected for Railyard package, desktop-entry, icon, and packaged-asset contracts.

Still required: validate migration from a real `0.5.0-beta.1` installation on all supported platforms, macOS/Windows native packaging, the separate website rebrand, release preparation/versioning, and the final human-operated GitHub rename.

## Current estate

### Desktop application — this repository

At exploration, the default theme was neutral black/white with Inter system fallbacks and its persisted identifier was `pi-workspace`. The table records the original scope; the completed desktop items are summarized above.

| Area                    | Current contract                                                                                                                                                                                                 | Rebrand work                                                                                                                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Renderer identity       | `src/renderer/index.html`, onboarding, navigation, startup, errors, settings, and changelog name Pi Workspace and use `pi-workspace-mark.svg`.                                                                   | Use the Railyard mark/name and update focused tests. Replace regenerated product screenshots that visibly contain the old identity.                                                                                   |
| Default visual language | `src/renderer/style.css` defines `pi-workspace` light/dark semantic tokens; `src/theme.ts` exposes the corresponding selectable theme.                                                                           | Define Railyard light/dark token values from the supplied palette, change the selectable name, and migrate the persisted theme ID. Do not change the other selectable editor themes.                                  |
| Typography              | The renderer has no web-font assets and uses Inter/system sans. CSP allows only self/data fonts.                                                                                                                 | Bundle licensed Space Grotesk and IBM Plex Mono files locally (with only required weights), declare `@font-face`, and add any required licence attribution. Remote Google Fonts will be blocked in production.        |
| Electron window         | `src/main/index.ts` sets the title, dock/window icon, and initial theme background.                                                                                                                              | Replace title, mark path, and default theme ID/background.                                                                                                                                                            |
| Build assets            | Vite copies `assets/` to the renderer, but electron-builder explicitly includes `assets/pi-workspace-mark.png` for the main process.                                                                             | Add the final Railyard assets and update the explicit package file list and release assertions.                                                                                                                       |
| Native icons            | `assets/icons/` has 16–512 PNGs plus `pi-workspace.icns` and `.ico`. The supplied set lacks 16, 24, 48, and 96 px PNGs and has no ICNS/ICO.                                                                      | Generate the missing Linux sizes from the approved master and generate/test macOS ICNS and Windows ICO. Preserve pixel legibility, especially at 16 px.                                                               |
| Release artifacts       | `package.json` and `.github/workflows/release-beta.yml` encode Pi Workspace app names, package names, executable, desktop entry, icon IDs, artifact globs, installer paths, SBOM assertions, and release titles. | Update each selected public identity, then make release verification assert the new contracts instead of the old strings/paths.                                                                                       |
| Documentation/community | `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `NOTICE`, `CODE_OF_CONDUCT.md`, `docs/`, and GitHub issue templates use the old name, URLs, commands, and support addresses.                                      | Rewrite public-facing references, installation commands and artefact examples only after the technical-slug/domain decision below. Retain historic names only where needed for migration or old release verification. |

`PiWorkspaceBridge`, source module paths, IPC types, tests’ temporary-directory prefixes, and the `pi-workspace://` renderer scheme are implementation names. They do not need a mechanical rename merely to ship the visual rebrand. If the protocol scheme changes, update its security boundary and tests as one atomic change.

### Persisted state and Git compatibility — merge gate

This beta already has real persisted data. A name change must not strand it.

- Electron user data contains `application-state.sqlite`, `application-state.json`, backups, `settings.json`, session JSONL files, a session working directory, and quarantined session files. Session JSONL headers embed the owned working-directory path, so copying only the database is insufficient.
- Current documented locations include `~/.config/Pi Workspace` on Linux and `~/Library/Application Support/Pi Workspace` on macOS. A changed Electron application name can select a new default user-data directory.
- The default persisted setting is `{ "theme": "pi-workspace" }`. Renaming its ID without a migration makes valid existing settings invalid and silently falls back to defaults.
- Existing managed worktrees create and record Git branches named `pi-workspace/<worktree-id>/<repository-id>`. Existing branches and their stored names must remain valid. New-branch naming is a separate policy decision, not a search-and-replace.

**Decision:** use new Railyard package/app identities and a new Railyard user-data location. Beta users may need to reinstall rather than receive an in-place package upgrade.

The repository compatibility rule still requires an explicit persisted-data migration for the changed user-data contract. Implement it before application state initializes: it must move/copy the complete user-data tree with private permissions, preserve old data on failure, avoid merging two non-empty installations without an explicit user decision, and verify that existing Workspaces, Sessions, settings, owned JSONL files, and session working-directory paths still resolve. Add focused migration tests for each supported operating system path model.

**Decision:** rename the persisted default-theme ID to `railyard`, with a settings migration that accepts `pi-workspace` and writes the new ID.

### GitHub organization and repositories

The `pi-workspace` organization currently has:

| Repository                  | Visibility | Current role                                                                                      |
| --------------------------- | ---------- | ------------------------------------------------------------------------------------------------- |
| `pi-workspace/pi-workspace` | public     | Desktop application, releases, issues, discussions, projects; homepage `https://pi-workspace.com` |
| `pi-workspace/website`      | public     | Static Next.js marketing site deployed with GitHub Pages; custom domain `pi-workspace.com`        |
| `pi-workspace/workspace`    | private    | Development workspace; its description and homepage still use Pi Workspace language               |

The organization display name and blog URL, public repository description/topics, latest release titles, issue forms, and security-report URL all use the old identity. The website repository has its own package manager (`pnpm`) and is not part of this Bun application repository.

The public website requires a companion rebrand:

- `app/layout.tsx` metadata, Open Graph/Twitter names and images, structured data in `app/page.tsx`, canonical site URL, robots and sitemap.
- Header/footer/hero content and old mark/favicon in `public/`.
- The current dark blue visual system and system fonts in `app/globals.css`; it needs a deliberate Railyard adaptation rather than only a logo swap.
- Website screenshots and the generated Open Graph image contain old product visuals/text and must be recreated after the desktop UI changes.
- **Decision:** retain `pi-workspace.com` and the current email/domain arrangements for now. No DNS, certificate, CNAME, canonical, redirect, or search-console migration is in scope for this rebrand.

## Decisions recorded

1. **Distribution identity:** change the Debian package/executable/desktop ID, Windows installer identity, macOS bundle identifier, artifact names, and Electron `appId` to Railyard. This is an intentional beta upgrade break and may result in a separate installation.
2. **Data location:** use a new Railyard user-data location, with the explicit migration described above to retain existing persisted state.
3. **Git worktree namespace:** new worktrees use `railyard/<worktree-id>/<repository-id>`. Existing `pi-workspace/…` branches and their stored records remain untouched.
4. **Design scope:** this is an identity and default-theme adaptation only: Railyard assets, typography, semantic colors, visible product copy, and updated screenshots. It does **not** rework each screen's information architecture, layout, components, interactions, or product behavior.
5. **Domain and email:** retain the existing domain and email arrangements for now.
6. **Copy approval:** confirm the final tagline and feature claims. The supplied README draft differs from current support/platform wording.

## Suggested delivery sequence

1. Add final source assets, local fonts/licences, icon generation, and asset-size checks.
2. Implement the storage/theme migrations with focused tests before changing Electron/package identity.
3. Rebrand renderer copy, default theme tokens, typography, window title/icon, and targeted tests. Keep semantic color tokens and verify contrast; amber should not become low-contrast body text.
4. Change package metadata and all release-workflow assertions to the Railyard distribution identity. Build each platform package and perform the corresponding install/launch/uninstall checks.
5. Re-capture desktop and web screenshots, update README/docs/community templates/release documentation, and publish a Railyard migration note.
6. Rebrand the website repository while retaining the current domain and canonical URL.
7. Validate clean install and upgrade from `0.5.0-beta.1` on macOS, Debian, and Windows: existing Workspaces, Workstreams, settings, Sessions, owned JSONL history, and Git worktrees must survive.

## Validation checklist

- `bun run format`, focused migration/theme/renderer tests, `bun run typecheck`, `bun run lint`, and `bun run build` in this repository.
- Build each native package and run the release workflow’s installation assertions updated for the approved identity.
- Verify dark/light Railyard default theme contrast, keyboard focus visibility, high-contrast mode, and the mark at 16 px.
- Test old-to-new upgrade and fresh Railyard installation separately; verify no duplicate/unreadable application state.
- In the website repository, use its existing pnpm commands to format, lint, build, and check production metadata, Open Graph image, sitemap, robots, canonical URL, and redirects.
- Verify GitHub Pages continues to serve correctly at the retained domain, then verify GitHub redirects and links after the human-operated organization/repository rename below.

## Final human-operated GitHub rename

After the implementation and release preparation are complete, rename the GitHub organization and repositories to their approved Railyard slugs. GitHub redirects existing repository URLs, but then verify repository metadata, issue/discussion/project links, badges, release links, `NEXT_PUBLIC_GITHUB_URL`, security-report URLs, and any external integrations. Domain and email changes are explicitly deferred.
