# Security policy

## Supported versions

Railyard is currently in beta. Security fixes are provided only for the latest published beta release.

| Version                         | Supported |
| ------------------------------- | --------- |
| Latest beta release             | Yes       |
| Earlier beta releases           | No        |
| Unreleased development branches | No        |

A security advisory may instruct users to stop using an affected release while a replacement is prepared. Older versions may also be unsafe to install if they contain a known vulnerability fixed in a newer release.

## Report a vulnerability

Do not disclose a suspected vulnerability in a public issue, discussion, pull request, or social-media post.

When GitHub private vulnerability reporting is available, use the repository's [private vulnerability report](https://github.com/pi-workspace/pi-workspace/security/advisories/new). If that form is unavailable, email **security@pi-workspace.com** with the subject `Railyard security report`.

Include as much of the following as is safe to share:

- The affected Railyard version or commit.
- Operating system and architecture.
- A description of the vulnerability and its potential impact.
- Minimal reproduction steps or a proof of concept.
- Whether exploitation requires a particular Workspace, Repository, Workstream, Session, model provider, link, file,
  or local permission.
- Relevant logs or screenshots with credentials, tokens, personal data, and private repository content removed.
- Any known workaround or mitigation.
- Your preferred name and whether you want public credit.

Do not include live credentials or unnecessary private repository contents. If sensitive supporting material is required, ask the maintainer to agree on a safe transfer method first.

## What to expect

A maintainer will acknowledge and triage credible reports privately as soon as practical. Triage determines affected versions, reachability, severity, release impact, and whether credentials or user data require incident action.

The maintainer may ask for clarification or help validating a fix. Please allow time for investigation and coordinated remediation before public disclosure. After a fix or mitigation is available, the project will coordinate an advisory and credit according to the reporter's preference.

Reports concerning an upstream dependency may need to be coordinated with its maintainers. Railyard will still assess and address the effect on supported Railyard releases.

The project's dependency-update, vulnerability-response, disclosure, release revocation, and rollback practices are documented in [`docs/security-maintenance.md`](./docs/security-maintenance.md) and [`docs/releases.md`](./docs/releases.md).
