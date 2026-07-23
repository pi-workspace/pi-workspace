# Release Pi Workspace

Pi Workspace beta releases are manually started from GitHub Actions. The workflow reads the version from
`package.json`; there is no version field to enter when starting it.

## Release contract

- The beta supports Debian 12 and Debian 13 on x86_64 (`amd64` in Debian package names), macOS 12 or later on Apple
  silicon and Intel through one universal application, and Windows 11 on x64.
- Each release provides a Debian package, a universal macOS DMG, a Windows x64 installer, a SHA-256 checksum for each
  installable artifact, and an SPDX JSON software bill of materials (SBOM) generated from each packaged application.
  AppImage, Windows 10, and other CPU architectures are not supported.
- The macOS DMG is Developer ID signed, notarized by Apple, and stapled before publication. The Windows installer is
  not code signed. Neither distribution uses an app store and updates are manual.
- Beta versions use semantic prerelease versions such as `0.1.0-beta.1`.
- The core version follows semantic versioning relative to the previous release: major for incompatible changes, minor
  for backward-compatible new functionality, and patch for backward-compatible fixes.
- A core version change resets the beta number to `beta.1`. Another prerelease of the same unchanged core increments
  the beta number instead.
- `package.json` and the latest bundled Release Note in `src/release-notes.ts` are curated together before release.
  Automated validation requires their versions to match.
- The manual workflow must run from the default branch. It creates the `v<package-version>` tag and matching GitHub
  prerelease only after source checks, packaging, and Debian and macOS verification pass.
- A version can be released only once. The workflow stops if its tag already exists.
- Debian packages and beta Git tags are not separately signed. Every installable artifact has a SHA-256 checksum and
  an SPDX JSON SBOM generated from the unpacked packaged application. The release workflow adds a keyless GitHub
  artifact attestation for every package, checksum, and SBOM, binding each to its source commit and workflow.

## Configure macOS signing and notarization

A MacBook is not required. The `Release beta` workflow builds, signs, notarizes, and verifies the macOS application on
GitHub-hosted macOS runners. A paid Apple Developer Program membership is required.

Create a **Developer ID Application** certificate in the Apple Developer portal, export it as a password-protected
`.p12`, then configure these repository secrets:

| Secret                 | Value                                                  |
| ---------------------- | ------------------------------------------------------ |
| `CSC_LINK`             | Base64-encoded Developer ID Application `.p12` file.   |
| `CSC_KEY_PASSWORD`     | The `.p12` export password.                            |
| `APPLE_API_KEY_BASE64` | Base64-encoded App Store Connect API key (`.p8`) file. |
| `APPLE_API_KEY_ID`     | App Store Connect API key ID.                          |
| `APPLE_API_ISSUER`     | App Store Connect issuer ID.                           |

Use an App Store Connect API key with notarization permission. On Linux, a certificate signing request and `.p12` can
be created with OpenSSL; the Apple Developer portal and App Store Connect are browser-based. Never commit a
certificate, private key, `.p12`, or `.p8` file. The workflow fails before packaging if any required secret is absent.

## Prepare a release

1. From a clean branch based on the default branch, start Pi and run `/skill:prepare-release`.
2. Review the release baseline, commit and issue coverage, proposed Release Note, version rationale, and release date.
   Resolve any version or date decisions the skill identifies.
3. Confirm the skill updated `package.json` and prepended a matching Release Note to `bundledReleaseNotes` in
   `src/release-notes.ts` without changing historical Release Notes.
4. Confirm `bun run release:validate` and the normal quality gates passed.
5. Commit the release preparation and merge it into the default branch.

The skill prepares release source only. Do not create the git tag or GitHub Release yourself.

## Start a release

In GitHub, open **Actions**, choose **Release beta**, select **Run workflow**, keep the default branch selected, and
run it.

Alternatively, with the GitHub CLI:

```sh
gh workflow run release-beta.yml --ref main
```

The workflow installs from `bun.lock`, validates the release contract, runs the quality gate, creates the Debian,
macOS, and Windows packages, checksums, and SBOMs from their unpacked applications, then verifies the Debian package
on Debian 12 and 13, the signed and notarized macOS DMG, and Windows installer installation, launch, and removal. It
creates keyless build-provenance attestations for every release asset before creating the version tag and GitHub
prerelease.

## Verify release provenance

Download a release's packages, checksums, and SBOMs, then verify every downloaded asset against this repository:

```sh
for artifact in pi-workspace-*; do
  gh attestation verify "$artifact" --repo pi-workspace/pi-workspace
done
```

GitHub CLI verifies that the attestation was issued by this repository's release workflow for its source commit. Use
this check during release-candidate review and incident response; a checksum from a compromised release alone does not
authenticate its publisher.

Before sharing that prerelease externally, complete this release-candidate checklist with a real Pi configuration on
each supported platform:

1. Install the candidate and verify its checksum.
2. Create a Workspace by selecting a local Git Repository.
3. Create a Workstream and confirm its owned Session is available.
4. Start a Quick Session for a Workspace Repository and submit a message successfully.
5. Reopen an app-owned Session and confirm its history, Model, and Effort are available.
6. Create Brainstorm and Implement Sessions and confirm their Composers are immediately available,
   `workspace_overview` lists every current Workspace Repository and its available working path, configured Pi
   extensions remain available, and Pi's normal filesystem and shell tools work without approval prompts.
7. If the release promises compatibility with the previous beta's application data, upgrade and verify that exact
   compatibility claim. Otherwise, confirm the Release Note states the compatibility limitation before sharing the
   prerelease.
8. Uninstall Pi Workspace and confirm its launcher is removed.

On macOS, launch the application from `/Applications` after dragging it from the mounted DMG. Confirm macOS shows the
expected Pi Workspace icon and does not show an unidentified-developer warning.

On Windows 11 x64, use a local Git Repository whose path has a drive letter and spaces. Confirm Git is available on
`PATH`, Pi Workspace detects the Pi provider configuration created by `pi` and `/login`, Quick Sessions work from both
the current checkout and a dedicated worktree, and Brainstorm and Implement Sessions can run a shell command.

## Revoke a compromised release

A released version, tag, or artifact name is immutable from the project's perspective and must never be silently
replaced or reused. If a published release or release credential may be compromised:

1. Disable the release workflow until the publishing path is trusted again.
2. Revoke the affected Apple certificate or App Store Connect API key and rotate every affected credential before
   restoring publishing.
3. Prefix the GitHub Release title with **[REVOKED]** and put a prominent warning and incident link at the beginning
   of its notes.
4. Delete the downloadable packages, checksums, and SBOMs from the compromised release while retaining the release
   page and tag as an audit record.
5. Determine the affected source, workflow, dependencies, credentials, and release assets. Publish a security
   advisory or repository announcement that identifies the revoked version, impact, removal time, and recommended
   user action.
6. Prepare and publish a new version through the normal release workflow. Never reuse the revoked version or tag.

Checksums hosted with a compromised release cannot establish publisher authenticity. Verify each downloaded artifact
with `gh attestation verify "$artifact" --repo pi-workspace/pi-workspace` and include that command in incident
communications.

## Roll back a release

Do not recommend a downgrade until the candidate rollback has been tested against data created by the revoked version.
The incident advisory must name the exact known-good version and state whether its application-data format is
compatible.

Before publishing rollback instructions:

1. Install the revoked version in an isolated test environment and exercise the affected data path without using real
   credentials.
2. Back up its complete Pi Workspace application-data directory, including its app-owned Session files.
3. Install the proposed known-good package or application and complete the normal release-candidate checklist.
4. Confirm whether restoring the backup is necessary and document that exact process.
5. Publish the verified package or DMG filename, checksum, and rollback instructions in the incident advisory.

If compatibility cannot be demonstrated, instruct users to stop using the revoked version and wait for the replacement
release rather than risking application data through an unverified downgrade.

## Build packages locally

Local packaging is for troubleshooting only and is not a publishing path:

```sh
bun install --frozen-lockfile
bun run release:validate
bun run package:linux
bun run package:mac
bun run package:win
```

macOS packaging requires macOS, a Developer ID certificate, and notarization credentials. Windows packaging requires
Windows. Release artifacts are written to `release/`.
