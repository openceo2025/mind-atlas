# Local cloud file management

Mode impact: local-only. The shared cloud dialog keeps its hosted behavior;
all new file operations run only in the local bridge. No VPS, PostgreSQL,
hosted service code, credentials, or deployment settings are changed.

## Behavior

The local **Cloud save** and **Cloud load** menu items open the same file
manager. Select an existing file, then Load, Rename, or Overwrite. **Save
current as** creates a separate file. Overwrite asks for confirmation. No
historical file is automatically deleted or merged.

Previously every local save selected an unused `-001`, `-002`, etc. filename.
There was no overwrite or rename endpoint. The hosted implementation in
`server/service-db.mjs` separates a stable database ID from its display title
and explicitly updates that ID. The local implementation follows that design:

- The existing filename is the stable identity. Rename updates the display
  title in `.cloud-titles.json`; it leaves the physical filename and bytes
  unchanged. The list shows both display title and physical filename.
- Explicit overwrite replaces that file atomically after preserving its
  previous bytes under `.overwrite-backups/`. Backups stay outside the normal
  cloud list. There is no pruning policy.
- Overwrite accepts only the same file format and requires the modification
  time from the selected list entry. A changed/missing file is rejected;
  refresh and review the list before trying again.
- Live `space-...` trees retain their existing AtlasLink/SpaceStore save path.
  Their display titles can be renamed in the file manager, but replacement
  from this list is disabled and rejected by the bridge. Display rename does
  not change the actual space title used by space lookup tools.
- Root node IDs and titles are not unique file identities. The application
  does not guess an overwrite destination from them.
- Existing noninteractive cloud-save callers retain new-file semantics.
  Space saves already use their stable space filename. This change adds no
  automatic consolidation of historical snapshots.

The bridge accepts the existing multipart POST `/api/cloud/notebooks` with
optional `targetName` and `expectedUpdatedAt` fields for overwrite. POST
`/api/cloud/notebooks/rename` accepts `{ name, title }`. No hosted routes are
added. New-file creation uses exclusive creation to avoid overwriting a file
if concurrent requests select the same free sequence number.

## Data inventory and preservation (2026-10-19)

Before source edits, 204 files totaling 358,445,044 bytes were copied to
`artifacts/local-cloud-backups/2026-10-19T09-46-32-733Z/` and every copied
file's SHA-256 was verified. `inventory.json` contains all physical filenames,
sizes and hashes. `preservation-audit.json` groups the repeated filename
families (95, 60, and 31 historical entries) and compares current files with
the backup. These local artifacts are git-ignored. The backup collects only
files from the notebook directory, with no environment or credential files
collected from elsewhere.

No original file was removed. The project space changes because the work log
is being recorded through Mind Atlas; the other original files remain byte
identical. Existing notes are never used as test fixtures.

## Verification and remaining checks

- `npm run typecheck`: passed.
- `npm run build`: passed, including a separate public-flag build with
  `VITE_MIND_ATLAS_PUBLIC_SERVICE=true`. The last build is local mode.
- `node scripts/verify-local-cloud-files.mjs`: 17 filesystem checks passed
  for package/KIF/PGN/SGF, rename persistence, backup contents, stale/missing
  files, format mismatch, path rejection, concurrent renames, and live-space
  protection.
- `node scripts/verify-local-cloud-ui.mjs`: isolated browser checks at 1280px
  and 390px. Uses an ephemeral fixture bridge and Vite port, never 5173/8787
  or user notebooks. Covers rename, overwrite, cancellation, retained history,
  save-as, reopening the list, local absence of Delete, and space protection.
- `npm run verify:hosted-service` and `npm run verify:hosted-public-ui`: passed
  using the existing offline verifiers.
- `node scripts/verify-local-cloud-ui.mjs --existing-suite`: runs the existing
  `npm run verify:ui` against the isolated Vite/fixture bridge. Desktop,
  locale switching, search, layout switching and calendar passed. The complete
  suite stopped at `verifyLocalDeveloperModeSurface`, waiting for **Bind this
  branch**: the offline bridge does not implement repository/provider APIs.
  Full existing UI-suite success is therefore **not verified**. It was not run
  against the owner's live bridge.

Run the focused regression checks with `npm run verify:local-cloud`.

## Applying the bridge change later

The running local app (5173) and bridge (8787) were not stopped or restarted.
No rename/overwrite operation was run against the real notebook directory.
The source and offline checks are complete; the new bridge routes become
available only after a restart at a time chosen by the owner.

1. Finish current work and save the open space with the existing workflow.
2. In the terminal already running `npm run dev:all`, stop that command with
   Ctrl+C, then run `npm run dev:all` in this repository. If bridge and Vite
   are run separately, restart only the terminal running `npm run dev:bridge`.
3. Refresh the browser. Open Cloud save or Cloud load and select a file.
   Rename should preserve its physical filename; Overwrite should keep the
   same list entry and place the previous bytes in `.overwrite-backups/`.
4. Confirm on a disposable new save before choosing an important old file.

Live verification after that owner-controlled restart remains outstanding.
