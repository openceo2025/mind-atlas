# Knowledge galaxy

Production redesign references: `mindatlas_compe/gpt6.1sol` and
`mindatlas_compe/opus5.5`. This design supersedes the earlier galaxy prototype.

Mode impact: shared-core and public UI, with existing AI routing reused
(dangerous-cross-mode verification). Existing dirty changes outside this
work are preserved and excluded from the release.

## Experience

The telescope pulls the Universe camera back into a knowledge web. There is
one R3F Canvas, one camera, and the active notebook uses its existing layout.
Pan, zoom and level-dependent labels operate on the same terrain. Returning
restores the original camera pose. Opening a node in another notebook parks
the outgoing notebook, loads the selected one, and transfers the camera into
the native Universe navigation controller. Screen-space label collision
filtering and bounded cross-space edge aggregation keep the overview legible.

The original note geometry remains mounted and its actual materials dissolve
into stellar points at the same coordinates. The camera eases to a front-facing
pose instead of retaining the native camera's tilt. Left/right drag pans with
damping; scroll and pinch zoom without rotating the plane. Closing returns the
saved native pose. Reduced-motion preference shortens the transition and stops
stellar breathing and edge pulses.

GPU-batched white cores, colored coronas and a nearly black background adopt
the GPT PoC's visual direction. Opus-style concentric arcs show completion,
blocked/error and review counts rolled up through canonical descendants.
Curved filaments carry light pulses; distant views aggregate notebook links
and fade detailed edges. Remote detail stays faint until selected, hovered or
included in a question projection.

The cascading right pane is a bounded spanning forest of actual relations.
Expand branches, hover to illuminate a path, select to move the camera, and
inspect a relation's source and confidence. Cycles and cross-links never cause
recursive duplication. The pane's path anchor survives selection of descendants.

The graph is a derived index above existing notebook trees. It includes real
parent links, saved notebook dependencies, lexical relation candidates, and
optional typed AI classifications. Relations expose origin, confidence, model
and the source note snapshot. Query and dependency/evidence/risk lenses form
temporary cycle-safe projections without rewriting notebook structure. The
management ledger and decision panels remain accessible.

## Automatic maintenance

The index updates after a 750 ms debounce even when the galaxy is closed.
Optional AI maintenance is off by default and requires a usable existing
judge. It classifies at most 12 pairs after a quiet period and then every
30 seconds, serializes its own requests, and pauses on failure. Public mode
uses the hosted decision endpoint and its account/credit checks; local mode
uses the local judge. A source fingerprint invalidates old classifications.
Bounded transitive dependency inference records supporting edges and is
rebuilt, so removed premises retract derived conclusions. Import remaps
space-scoped relation keys. Existing canonical notebooks are never rewritten
by graph maintenance.

This is the first graph adjunct, not a replacement of canonical notebook
storage by a general-purpose graph database. Candidates use lexical and
Japanese bigram overlap, not embeddings. Question intent recognizes bounded
keywords and titles rather than providing unrestricted natural-language QA.
Inference currently implements transitive dependencies, not arbitrary causal
or logical rules. The index has per-space node bounds and reports omissions.

## Local preview

Run `npm run dev:all`. Normal app: http://127.0.0.1:5173/

Storage-free sample:
http://127.0.0.1:5173/?aboutDemo=research&knowledgeDemo=1&locale=ja

The sample is development-only, local-mode-only, visibly marked, and uses the
existing About demo persistence/AI guards. It opens three real sample notebook
trees and does not replace browser notebooks or call an AI provider.

## Verification

- Typecheck, local build and public build with
  `VITE_MIND_ATLAS_PUBLIC_SERVICE=true` passed.
- Existing `verify:galaxy`, `verify:hosted-service` and
  `verify:hosted-public-ui` passed.
- `node --experimental-strip-types scripts/verify-knowledge-graph.ts` checks
  scoped IDs, source invalidation, bounded traversal, deletion, canonical
  status rollups and cascade cycle/filter behavior.
- `node scripts/verify-knowledge-ui.mjs` checks desktop/mobile, the single
  Canvas, intermediate material blend, front-facing camera, drag without
  tilt, cascade navigation, relation evidence, rings, query projection,
  return and cross-notebook entry, and background
  classification with a mocked judge while the galaxy is closed. It runs in
  fresh browser contexts with fixture data. It does not verify a live model's
  semantic quality. Evidence is in `artifacts/screenshots/knowledge/`.
- The broad UI harness waits for DOM and explicit UI readiness, rather than
  `networkidle`: durable agent SSE streams legitimately remain connected.
  Persistence fixtures seed a blank same-origin page before mounting React.
- The full `verify:ui` suite passed on the isolated release checkout against
  the running local bridge, including native focus, persistence, touch, agent
  supervision and camera-scoped rendering. Layout and i18n checks passed.
- The hosted production build also passed desktop/mobile galaxy interaction
  checks with fresh, private fixture notebooks. Signed-out AI maintenance was
  disabled and no classification requests were sent.

Release uses the ConoHa workflow: the exact pushed commit is built on the VPS,
with backup/rollback, service health and deployed/public asset hash checks.
