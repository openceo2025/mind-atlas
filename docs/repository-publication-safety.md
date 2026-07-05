# Repository publication safety

This repository is public. Treat every committed file as visible to users,
forks, competitors, search engines, and future due-diligence reviewers.

## Safe to commit

- Source code for the community edition and the current AGPL hosted-service
  implementation.
- Documentation, tests, verification scripts, and deployment templates.
- Example environment files that use placeholders such as `replace-me`,
  `mock`, `example`, or local-only Docker credentials.
- Static legal pages such as `privacy.html` and `terms.html`.
- Manual preview workflows and non-secret infrastructure templates.

## Never commit

- `.env`, `.env.local`, `.env.service`, `*.local`, or any real environment
  file.
- Google OAuth client secrets, Stripe secret keys, Stripe webhook secrets,
  provider API keys, VPS SSH keys, database passwords, session cookies, JWTs,
  or private certificates.
- PostgreSQL data directories, dumps, backups, exports, or screenshots that
  include user emails, subscription state, AI usage, billing records, or support
  correspondence.
- nginx access logs, application logs, `server-data/`, AI request logs,
  generated screenshots from private notebooks, or local `.mindatlaspkg`
  notebooks.
- Live customer analytics exports or operational incident notes containing
  personal data.

## Before committing hosted-service changes

1. Confirm `git status --short` shows only intended source, docs, templates, or
   tests.
2. Confirm ignored local files stay ignored:

   ```powershell
   git check-ignore -v .env .env.local .env.service AGENTS.md CLAUDE.md server-data/test
   ```

3. Scan candidate files for secret patterns before staging:

   ```powershell
   git ls-files -mo --exclude-standard
   ```

   Then inspect any new file that looks like an environment file, log, export,
   database file, screenshot, archive, or notebook package.

4. Run the relevant checks from
   [mode-safety-contract.md](mode-safety-contract.md).

## Production data boundary

The official `mind-atlas.org` service may store account, subscription, credit,
usage, and access-log data on the VPS and third-party services such as Google,
Stripe, and AI providers. That operational data is not part of the open-source
repository. Public source updates must use templates and migrations, not live
data copies.
