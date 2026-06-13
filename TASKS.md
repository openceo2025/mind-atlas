# Mind Atlas Set 1 Task Board

This task board tracks the first product set: durable Thinking Universe,
shareable context, templates, and the early monetization path. Keep this file
current as implementation progresses. Use ASCII only.

## Working Rules

- Implement in dependency order. T1 -> T2 -> T3 are foundation work, but T3 can
  run in parallel with T2 after T1 is underway.
- Do not start large dependent UI work until its foundation task is merged and
  verified.
- After each task, run the relevant checks and record the result in the task
  notes.
- Prefer small, reviewable patches for T1 and T2 because they touch persistence
  and layout behavior.
- When a task changes product position, update `AGENTS.md` Current Position.

## Dependency Map

```text
T1 -> T2 ----+-> T4 -> T5 ----+-> T9 -> T14
             +-> T6          |
T3 ----------------> T7 -----+
T8 ----------------> T10 ----+

T11 -> T12 -> T13
T13 also depends on T1 and should wait for retention evidence.
```

## Phase 0-A: Foundation, Serial First

### T1. IndexedDB Notebook Persistence And Version History

Status: Implemented on 2026-06-11
Depends on: None
Blocks: T2, T13, serious paid usage

Scope:

- Replace `persistNotebook` in `src/store/atlasStore.ts`, which currently writes
  the full notebook to `localStorage` key `mind-atlas-notebook-v2`, with an
  IndexedDB persistence module.
- Reuse the storage style/patterns from `src/attachmentStorage.ts` where useful.
- On first launch, migrate from the old localStorage key automatically. Keep the
  old key for recovery.
- Add automatic snapshot generation and retention.
- Suggested retention: latest 20 generations plus daily 7 generations.
- Add a capacity limit and predictable pruning behavior.
- Add restore UI from the main menu: "Restore from history".
- Detect write failures and notify the user instead of silently ignoring them.
- Request durable browser storage with `navigator.storage.persist()` where
  supported.

Definition of Done:

- Notebook data survives browser force quit and tab crash scenarios.
- Any retained snapshot generation can be restored from the UI.
- Write failures are visible to the user.
- Existing notebooks migrate from localStorage without data loss.
- `npm run typecheck` passes.
- `npm run build` passes.
- `npm run verify:ui` passes.

Implementation notes:

- Treat this as the data safety foundation for all later schema refactors.
- Avoid deleting the old localStorage payload until a later explicit cleanup
  task.

Implementation result:

- Added `src/notebookPersistence.ts` for IndexedDB notebook storage, automatic
  migration from `mind-atlas-notebook-v2`, snapshot generation, retention of the
  latest 20 generations plus one snapshot for each of the latest 7 days, a 24 MB
  snapshot capacity guard, and best-effort durable storage requests.
- Added store status/error fields, snapshot listing, and snapshot restore.
- Added "Restore from history" to the main menu.
- Verification on 2026-06-11: `npm run typecheck` passed; `npm run build`
  passed with the existing Vite large chunk warning; `npm run verify:ui`
  passed after starting Vite on `127.0.0.1:5173`.
- Follow-up polish on 2026-06-11: IndexedDB saves are now queued and coalesced
  so rapid edits cannot complete out of order and overwrite a newer notebook.

### T2. Derived Coordinate Layout Refactor

Status: Completed on 2026-06-11
Depends on: T1
Blocks: T4, T6

Scope:

- Stop baking creation-time coordinates through
  `getPhyllotaxisStoredChildPosition` in `src/store/atlasStore.ts`.
- Reinterpret `AtlasNode.position` as a compatibility/manual override field.
  New code should conceptually treat this as `manualPosition?: [x, y, z]`.
- Existing persisted `position` values must load as manual overrides for
  compatibility.
- Store only logical tree structure plus manual position overrides.
- Derive display coordinates through a layout engine function.
- Define the layout engine interface:
  `(tree, mode, overrides) -> Map<nodeId, position>`.
- First implementation must faithfully reproduce the current phyllotaxis visual
  output. This task is a refactor, not a visual redesign.
- Remove the current `getPhyllotaxisStoredChildPosition` call sites in
  `atlasStore.ts`.
- Ensure drag movement saves an override rather than changing generated layout
  semantics.

Definition of Done:

- Current visual appearance and core interactions remain unchanged.
- Dragged node positions persist as overrides.
- Existing notebooks load without obvious layout regressions.
- `npm run typecheck` passes.
- `npm run build` passes.
- `npm run verify:ui` passes.

Implementation notes:

- This is the heaviest and riskiest Set 1 task.
- Use T1 snapshots to protect users from schema mistakes.
- Keep the first layout mode intentionally boring: current phyllotaxis parity.

Implementation result:

- Added `src/layout/atlasLayout.ts` with the layout engine interface
  `(tree, mode, overrides) -> Map<nodeId, position>`.
- Moved phyllotaxis-compatible display coordinate derivation out of
  `atlasStore.ts`.
- Reinterpreted `AtlasNode.position` as a persisted manual override field;
  existing positions still load as overrides for compatibility.
- Removed `getPhyllotaxisStoredChildPosition` and its creation-time call sites
  from `atlasStore.ts`.
- Updated `UniverseCanvas` and `Minimap` to read display positions from the
  derived layout map.
- Drag-created and dragged nodes still save explicit overrides through the
  existing `position` field.
- Verification on 2026-06-11: `npm run typecheck` passed; `npm run build`
  passed with the existing Vite large chunk warning; `npm run verify:ui`
  passed after restarting Vite on `127.0.0.1:5173`.
- Follow-up polish on 2026-06-11: added `npm run verify:layout` to compare a
  fixed logical tree against legacy baked phyllotaxis positions and to verify
  manual override behavior.

### T3. Context Assembly Module

Status: Completed on 2026-06-11
Depends on: None
Blocks: T7

Scope:

- Create a pure context assembly module, likely under `src/context/`.
- Build structured Markdown from:
  - root-to-target ancestor chain
  - sibling titles at each level
  - target subtree content
- Reuse the existing `AiContextScope` concepts:
  `minimal`, `focused`, `subtree`, `neighborhood`, and related options.
- Include character count and approximate token count estimates.
- Add overflow behavior that summarizes or omits deepest content first.
- Design the API so later bridge/context sending code can reuse it.

Definition of Done:

- Unit-test-style coverage verifies a book-like tree to selected section to
  expected Markdown output.
- Scope behavior is deterministic and documented in test cases.
- Token/character estimates are available to callers.
- `npm run typecheck` passes.
- `npm run build` passes.

Implementation notes:

- This task is relatively independent and can be done while T2 is in progress.
- Avoid coupling the module to React or browser APIs.

Implementation result:

- Added pure context assembly module `src/context/contextAssembly.ts`.
- Added `assembleAtlasContextMarkdown` for structured Markdown containing the
  ancestor chain, sibling titles, target subtree content, selected-node context,
  character count, approximate token count, and included/omitted node ids.
- Reused existing `AiContextScope` concepts for `minimal`, `focused`,
  `subtree`, `neighborhood`, `selected`, and `custom` scopes.
- Added deepest-content overflow behavior through a `maxCharacters` budget.
- Added `scripts/verify-context-assembly.ts` and `npm run verify:context` for
  book-like tree coverage of Markdown output, scope behavior, stats, and
  overflow handling.
- Verification on 2026-06-11: `npm run verify:context` passed;
  `npm run typecheck` passed; `npm run build` passed with the existing Vite
  large chunk warning.
- Follow-up polish on 2026-06-11: context assembly now builds removable context
  blocks before rendering Markdown, removes deepest blocks for overflow instead
  of using regex on rendered Markdown, and makes metadata options observable in
  output and verification.

## Phase 0-B: Core Experience, Parallel After Foundations

### T4. Layout Modes

Status: Completed on 2026-06-12
Depends on: T2
Blocks: T5, T9

Scope:

- Add tree layout mode for readable hierarchy and sibling order. This is the
  main book/planning use case.
- Add mind-map mode with a root-centered radial 2D layout.
- Add hub-emphasis mode where nodes with more edge/tag resonance influence the
  center of gravity.
- Run hub-emphasis layout computation in a worker if it is expensive.
- Add sibling-order guides to phyllotaxis mode, such as a subtle spiral guide.
- Persist layout mode in `src/uiPersistence.ts`.

Definition of Done:

- Users can switch layout modes.
- Mode choice persists across reloads.
- Layouts are readable on desktop and mobile.
- `npm run typecheck`, `npm run build`, and `npm run verify:ui` pass.

Implementation result:

- Added layout modes to `src/layout/atlasLayout.ts`: `tree`, `mind-map`, and
  `hub-emphasis`, alongside the existing `phyllotaxis` mode.
- Added `deriveAtlasLayoutFrame` so generated modes return positions,
  visible node ids, plane information, and bounds from one layout frame.
- Reworked tree mode as a focus-local flat layout instead of a global leaf-slot
  layout. Desktop keeps the active node near the upper center, ancestors above,
  siblings on the active row, and child branches below. Mobile portrait
  transposes the same structure so children recurse to the right.
- Reworked mind-map mode as a focus-local flat radial layout instead of a
  root-global layout. Children are distributed by visible subtree weight, with
  parent and sibling context kept near the focus.
- Updated hub-emphasis to preserve phyllotaxis angular directions while
  assigning nodes to up to ten rank-distributed depth tiers by child count.
  The active node is rotated to the forward viewing direction, and drag
  coordinate changes are disabled outside phyllotaxis mode.
- Kept hub-emphasis on the main thread because the current deterministic
  computation is cheap and covered by `npm run verify:layout`.
- Persisted `layoutMode` in `src/uiPersistence.ts` and exposed a Layout section
  in the global menu.
- Updated `UniverseCanvas`, `Minimap`, notification pulses, and focus position
  lookup to consume the same active layout frame and visible-node set.
- Removed the phyllotaxis sibling dotted guide after visual review because it
  reduced readability.
- Added node easing for generated layout changes when the active node or layout
  mode changes.
- Locked generated layout camera focus to a front-facing pan/zoom mode so tree
  and mind-map axes align with the browser X/Y axes; phyllotaxis remains the
  orbital free-drag mode.
- Made depth fade use camera-space distance from the visual node position
  instead of layout mode or origin-radius heuristics.
- Extended `npm run verify:layout` to cover all layout modes, manual override
  behavior, focus-aware flat layouts, mobile tree orientation, and
  rank-distributed hub tiers.
- Extended `npm run verify:ui` to click through the layout mode switch path.
- Verification on 2026-06-12: `npm run verify:layout` passed;
  `npm run verify:context` passed; `npm run typecheck` passed;
  `npm run build` passed with the existing Vite large chunk warning;
  `npm run verify:ui` passed after restarting Vite on `127.0.0.1:5173`.

### T5. Reformation Animation And Motion Language

Status: Implemented
Depends on: T4
Blocks: T9, T14

Scope:

- Animate all nodes between layout modes.
- Use an inertial, slightly overshooting easing style that feels controllable.
- Connect camera auto-framing to layout transitions.
- Unify motion language with notification pulses and focus rings.
- Degrade automatically on low-end devices through the existing render quality
  system.

Definition of Done:

- A 10 second layout-mode switch screen recording is good enough for social
  media marketing.
- Low render quality avoids expensive animation work.
- `npm run verify:ui` covers the mode switch path.

Implementation result:

- Replaced generated-layout camera easing with the shared reformation motion
  curve: a short inertial spring with slight overshoot in normal quality and a
  cheaper short ease in low render quality.
- Added generated-layout node reformation motion with focus-distance stagger,
  slight scale breathing, and shared timing with camera auto-framing.
- Low render quality skips per-node reformation animation and uses the shorter
  camera transition path to avoid expensive animation work.
- Updated notification pulses and focus wave rings to use the same spring
  motion character so mode changes, alerts, and focus feedback feel related.
- Verification on 2026-06-13: `npm run typecheck` passed;
  `npm run verify:layout` passed; `npm run build` passed with the existing
  Vite large chunk warning; `npm run verify:ui` passed against
  `https://127.0.0.1:5173`.

### T6. Permanent Bidirectional Outline Editor

Status: Not started
Depends on: T2

Scope:

- Convert `src/components/OutlineEditor.tsx` from draft/save behavior to a
  permanent pane with immediate store updates.
- Integrate outline edits into normal notebook undo/redo history.
- Sync selection, focus, and collapsed state between outline and universe.
- Clicking an outline row should focus/follow the node in the universe view.
- Universe focus should scroll and expand the matching outline branch.
- Integrate mobile UI into the existing `mobilePanelTab` system.

Definition of Done:

- Adding a section in the outline creates a node in the universe immediately.
- Adding or focusing a node in the universe updates the outline immediately.
- Undo/redo works for outline edits.
- Desktop and mobile flows are usable.

### T7. Context-Aware Copy UI

Status: Not started
Depends on: T3

Scope:

- Add "Copy with context" actions to:
  - focus panel
  - outline row
  - node context menu
- Add a keyboard shortcut.
- Provide presets:
  - node only
  - with ancestor context
  - with subtree
- Show approximate token count before copying.
- Use the existing event strip or equivalent feedback for copy success.

Definition of Done:

- Copying one section from a book-like universe into ChatGPT or Claude gives an
  answer that reflects broader book context.
- Record one manual demo example for later marketing material.
- `npm run typecheck`, `npm run build`, and `npm run verify:ui` pass.

## Phase 0-C: Growth Loops, Parallel

### T8. Imports: Markdown, OPML, FreeMind

Status: Not started
Depends on: None
Blocks: T10

Scope:

- Add importers near `src/notebookExport.ts` or a new import/export folder.
- Convert Markdown headings and list hierarchy into a node tree.
- Convert OPML outline hierarchy into a node tree.
- Convert FreeMind maps into a node tree.
- Add drag-and-drop file acceptance.
- Make "expand a book from text" possible for the T7 copy workflow.

Definition of Done:

- Markdown, OPML, and FreeMind sample files import into sensible trees.
- Imported trees can be saved, reloaded, and exported.
- Error messages are clear for invalid files.

### T9. Share Link And Self-Contained HTML Export

Status: Not started
Depends on: T4, T5
Blocks: T14

Scope:

- Export a universe as a single read-only HTML file with an included viewer.
- Reuse `.mindatlaspkg` foundations and `fflate` packaging where practical.
- Include a "Create with Mind Atlas" entry point in the viewer.
- Keep the first version serverless and static-hosting friendly.
- Defer hosted URL sharing until sync/cloud foundations exist.

Definition of Done:

- Exported HTML opens offline or from static hosting.
- The viewer is read-only.
- The exported experience shows the visual strength of T4/T5.

### T10. Template Universes And Onboarding Update

Status: Not started
Depends on: T8

Scope:

- Add 5 to 10 template universes.
- Candidate templates:
  - novel plot
  - TRPG/worldbuilding
  - job-hunting self analysis
  - paper planning
  - book expansion sample
- Store templates in an import-friendly format.
- Extend `src/onboarding/` for first-run template selection.
- Support Japanese and English onboarding copy.

Definition of Done:

- New users can choose a template on first run.
- Templates are maintainable through the same path as imports.
- The onboarding flow works in Japanese and English.

## Phase 1: Monetization And Launch

### T11. License Strategy Switch

Status: Not started
Depends on: None
Blocks: T12

Scope:

- Decide future license approach:
  - MIT core plus proprietary Pro features, or
  - a broader proprietary switch before paid launch.
- Update `LICENSE` and `README.md` as needed.
- Decide Pro code separation:
  - build flag, or
  - separate modules/packages.

Definition of Done:

- License terms match the intended monetization model.
- The repository clearly separates free/core and paid/pro boundaries.

### T12. Pro License Key And Serverless Payment Flow

Status: Not started
Depends on: T11
Blocks: T13

Scope:

- Set up products through Lemon Squeezy or Stripe Payment Links.
- Implement signed license keys with offline verification.
- Bundle the public verification key in the app.
- Gate Pro features:
  - unlimited universes
  - longer version history retention
  - high resolution export
  - PDF/PPTX export
  - theme packs
- Keep the core T4/T5/T7 experience free enough to support sharing and growth.

Definition of Done:

- A valid license unlocks Pro features offline.
- An invalid or expired license fails clearly.
- Free users can still experience the viral core.

### T13. Sync With E2E Encrypted Blob Storage

Status: Not started
Depends on: T1, T12
Recommended timing: after T14 retention evidence

Scope:

- Build Cloudflare Workers plus R2 encrypted blob sync.
- Keep encryption client-side. The server must not hold plaintext.
- Start with simple conflict behavior:
  - latest write wins
  - all generations preserved as snapshots
- Add Stripe subscription billing for recurring sync.

Definition of Done:

- Sync works across at least two browsers/devices.
- The server never receives plaintext notebook data.
- Conflicts preserve recoverable history.

Implementation notes:

- This is the only Set 1 task that creates direct operational burden.
- Do not start until retention evidence justifies the service.

### T14. Marketing Site And Measurement

Status: Not started
Depends on: T5, T9

Scope:

- Change `mind-atlas.org` from app-only entry into:
  - landing page
  - demo video
  - template gallery
  - app entry
- Add privacy-conscious lightweight measurement.
- Measure 30 day retention. This is the Phase 0 validation gate.
- Prepare launch assets for:
  - Product Hunt
  - Hacker News
  - X / Japanese creator and developer audience
- Use T5 reformation animation footage and T7 context-copy demos as launch
  material.

Definition of Done:

- The site explains the Thinking Universe value clearly.
- Retention measurement can answer whether users return after 30 days.
- Launch assets are ready and linked from this file or docs.

## Suggested Work Batches

1. T1 only: data safety, migration, snapshots, restore UI.
2. T2 only: coordinate derivation with visual parity.
3. T3 and T8: independent text/context foundations.
4. T4, T5, T6, T7: the visible product experience.
5. T9 and T10: sharing and onboarding growth loop.
6. T11 and T12: license/payment readiness.
7. T14: launch page and retention measurement.
8. T13: sync only after retention evidence supports the operational cost.

## Verification Checklist Template

Copy this under each task when implementation starts:

```text
Started:
Branch:
Key files changed:
Manual checks:
- [ ] 
Automated checks:
- [ ] npm run typecheck
- [ ] npm run build
- [ ] npm run verify:ui
Result:
Follow-ups:
```
