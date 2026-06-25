# Contributing to Mind Atlas

Mind Atlas welcomes issues, forks, experiments, documentation improvements,
tests, and pull requests.

## Before starting

- Search existing issues and pull requests.
- Open an issue before a large feature, architectural change, data migration,
  new dependency, or user-facing workflow change.
- Keep changes focused. Avoid combining unrelated refactors and features.
- Do not include API keys, credentials, private notebook data, generated
  builds, logs, screenshots from private work, or local configuration.

## Development

```powershell
npm install
npm run typecheck
npm run build
npm run verify:ui
```

Add targeted tests for behavior changes. A pull request should explain the
user-visible result, implementation tradeoffs, and verification performed.

## Contributor License Agreement

All pull requests must accept [CLA.md](CLA.md) using the checkboxes and GitHub
username field in the pull request template. The automated `CLA` status check
fails until the attestation is complete.

The CLA lets contributors retain copyright while allowing the project to:

- publish contributions in the AGPL community edition;
- offer separate commercial licenses;
- include contributions in future Pro or Team products; and
- transfer the project and its contribution rights in a future business or
  asset transaction.

Do not submit code if you cannot make the representations in the CLA.

## Licensing of contributions

Accepted contributions become part of the repository under
`AGPL-3.0-only`, unless a file is explicitly marked with another license. The
CLA also grants the Project Owner separate relicensing rights.

## Forks and branding

Forking and modification are encouraged under the GNU AGPL. Modified public
distributions and hosted services must follow [TRADEMARKS.md](TRADEMARKS.md):
use a distinct primary name and do not imply that a fork is an official Mind
Atlas release.

## Review

Maintainers may request changes for correctness, scope, accessibility,
performance, security, licensing, product fit, or maintainability. Submission
does not guarantee acceptance.
