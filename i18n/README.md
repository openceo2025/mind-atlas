# Mind Atlas localization

English is the canonical source language. Runtime UI messages live in
`src/i18n/messages.ts`, while static page source copy lives under
`i18n/pages/en/`. Translators must not edit application or HTML source files.

## Translation workflow

1. Run `npm run i18n:verify` before creating a job.
2. Create one locale job:
   `npm run i18n:job -- --locale es`
3. Give only the generated `i18n/jobs/es.json` and `i18n/glossary.json` to the
   translation model. It may edit only each message's `translation` field.
4. Merge the completed job:
   `npm run i18n:merge -- i18n/jobs/es.json`
5. Run `npm run i18n:verify` again. A merged locale remains a draft until a
   maintainer adds it to `runtimeLocales` and the runtime catalog registry.

Never put provider API keys in this directory or in a translation job. Jobs
contain public UI copy only. Node titles, node bodies, AI answers, filenames,
model IDs, imported documents, and user-created content are not translation
targets.

`privacy` and `terms` translations require human legal review before they are
published, even when the automated ICU and coverage checks pass.

## Pseudo locales

Use `?locale=en-XA` to test expansion and `?locale=ar-XB` to test RTL layout.
Pseudo locales are development tools and are not shown in the public language
selector.

## Hardcoded UI report

`npm run i18n:scan` compares current JSX text and browser-dialog literals with
`i18n/hardcoded-baseline.json`. Existing migration debt is visible, and new
hardcoded UI text fails the check. Remove baseline entries as strings move into
the canonical catalog; never expand the baseline to bypass localization.
