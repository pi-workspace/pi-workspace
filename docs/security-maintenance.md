# Security maintenance

This policy defines how Railyard maintains dependencies and responds to vulnerability findings.

## Automated checks

- Dependabot checks Bun dependencies and GitHub Actions weekly and opens grouped update pull requests.
- The `Security checks` workflow scans Git history with Gitleaks and `bun.lock` with OSV-Scanner on pull requests, pushes to `main`, a weekly schedule, and manual dispatches.
- The release workflow repeats the verified Gitleaks and OSV-Scanner checks before installing dependencies or building an artifact.
- GitHub dependency review and CodeQL are preconfigured to activate when the repository becomes public.
- Native GitHub secret scanning and private vulnerability reporting must be enabled during the public-repository configuration.

The scanner versions and expected checksums are pinned in [`scripts/security-scan.sh`](../scripts/security-scan.sh). Updating either scanner requires reviewing its release and updating both values together.

## Dependency updates

A dependency update must:

1. Explain whether it is routine maintenance or addresses a known vulnerability.
2. Keep `package.json`, `bun.lock`, and any affected dependency-license records consistent.
3. Pass the quality and security workflows.
4. Review license changes and update [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) when required.
5. Regenerate the production dependency-license inventory when the shipped dependency tree changes.

Automated update pull requests are not merged solely because they are automated. Their release notes, compatibility, transitive changes, and validation results require review.

## Vulnerability response

For every credible vulnerability report or automated finding, a maintainer must:

1. Privately acknowledge and triage the finding without requesting sensitive details in a public issue.
2. Determine the affected dependency or source, versions, reachability, required privileges, exposed data, and whether a released artifact is affected.
3. Treat an exploitable vulnerability in a shipped or release-bound path as release-blocking until it is fixed or explicitly documented as not applicable.
4. Prefer the smallest supported dependency update or focused source fix, then run the complete quality and security gates.
5. Review whether credentials, release artifacts, or user data require additional incident action.
6. Coordinate disclosure with the reporter and publish an advisory after a fix or mitigation is available.
7. Follow the release revocation and rollback procedure in [`docs/releases.md`](./releases.md) when a published artifact cannot remain available safely.

A deferred finding must record its evidence, scope, compensating controls, owner, and review condition. Scanner allowlists must be narrow, documented, and tied to a specific false positive or accepted risk; they must not suppress an entire rule merely to make CI pass.

## Release evidence

Each release must retain or publish:

- The source commit and workflow run.
- The Debian package, macOS DMG, and SHA-256 checksums.
- The SPDX JSON SBOM generated from each unpacked packaged application, including representative JavaScript and native dependencies.
- Successful macOS Developer ID signature, notarization, and stapling verification.
- A successful release-source security scan.
- A keyless GitHub artifact attestation for every package, checksum, and SBOM; verify each downloaded asset with `gh attestation verify "$artifact" --repo pi-workspace/pi-workspace`.
