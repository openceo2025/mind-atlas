# Knowledge galaxy

Production design references: `mindatlas_compe/gpt6.1sol` (stellar glow, dark
sky, seamless planet-to-star entry, damped camera feel) and
`mindatlas_compe/opus5.5` (progress rings, pulsing relation filaments, zoom
dependent granularity, minimap, cascading relation pane). This design
supersedes the earlier galaxy prototype.

Mode impact: shared-core and public UI. Hosted AI routing is reused unchanged
(dangerous-cross-mode verification still applies because the maintenance
judge is shared).

## Experience

The telescope pulls the Universe camera back into the galaxy. There is one R3F
Canvas and one camera. On entry the camera starts pulling back from exactly
where it was; every planet dissolves into a star at its own position, and the
stars then re-form ("再編隊") from their universe positions into the flat
galaxy map while the camera settles head-on over the whole galaxy. The chrome
fades in once the planets have begun to turn into stars. Closing reverses the
glide and lands on the saved universe pose; opening a note in another space
flies down to it, parks the outgoing notebook, loads the target and hands the
camera to the Universe navigation controller.

The map camera always faces the galaxy plane (no inherited tilt). Drag glides
with inertia, the wheel and pinch zoom toward the pointer, double-click zooms
to a note (or into empty space). Input is taken on the universe shell rather
than the canvas, because the universe's HTML overlays still sit above the
canvas while the galaxy is open; map labels hand their pointer-down to the map,
so a drag that starts on a name pans while a tap still selects.

Until the person touches the map, the camera keeps the whole galaxy framed. On
a phone the telescope is usually tapped before the notes index (750 ms
debounce) and the inactive spaces have arrived, so the entry flight is
retargeted without a jump and later changes glide to the new frame; rotating
the screen re-frames too. Any drag, wheel, pinch, selection or focus request
hands control to the person, and the overview button hands it back. On phones
the free area is measured from the real controls above and below the map; a
phone on its side gets a compact layout.

## The map

`src/galaxy/knowledgeMap.ts` keeps two arrangements of the same notes:

- native: the exact universe position of every note, offset by its space's
  anchor, so the dissolve happens in place;
- galaxy: a flat, hierarchical map per space — top-level branches on a ring
  around the root, notes around their branch, finer detail fanning outward
  like dendrites. Each branch keeps the direction it has in the universe, so
  the map reads as the universe unfolded.

The space the person came from sits at the origin. Other spaces are packed
around it (larger first, related spaces drawn closer, shaped to the screen's
aspect) and keep their places for the whole visit. `frameBounds` fits the
overview into the part of the screen the panels leave free
(`knowledgeInsets`, kept in sync with `knowledge.css`).

## What is drawn

`src/components/galaxy/KnowledgeField.tsx` draws the graph in a few calls:

- territories: each space's soft patch of colour, strongest from afar;
- rivers: all relations between two spaces summed into one flowing ribbon,
  visible only when zoomed out far enough that single links would be noise;
- edges: every relation as a curved filament. Parent links carry one quiet
  pulse climbing toward the root; typed relations carry waves flowing from
  source to target; word candidates are dashed. Running work sends sparks up
  its branch. Cross-space detail links appear only once you zoom in;
- points: every note as a white-cored star with a coloured corona (GPT PoC).
  Blocked/error notes carry a pulsing red ring, review requests an amber ring;
- hubs: each space and its top-level branches. The rings come from
  `knowledgeHubSignals` and describe the branch, never a single note:
  a green progress arc (share of descendants done, on a dim full track), a red
  risk arc (blocked work weighs double, plus work that depends on something
  blocked), amber satellites for notes waiting for a person, and a ripple when
  the branch is in trouble. A branch without descendants shows no arc, so no
  ring can only be "0 % or 100 %".

Level of detail is measured in screen pixels per map unit (the median distance
from a note to its parent), so it behaves the same for ten notes or a
thousand. Names follow the same rule (`knowledgeLabels.ts`): space names from
afar, branch names in between, note names up close, detail last; labels are
pooled DOM nodes placed greedily without overlapping each other or the panels.
Branch and space names carry three small bars: progress, judged quality (spaces
only) and risk. Lit links show their relation word (依存, 裏づけ …).

The chrome: search and lenses, the space list with progress, the zoom-level
ladder (whole galaxy / spaces / branches / notes / detail, clickable), the
progress-ring toggle and legend, the minimap (click or drag to move), zoom
buttons, and the cascading relation pane, whose hover lights the path on the
map and whose selection moves the camera.

## Relations and maintenance

The graph is a derived index above the notebook trees: real parent links,
saved notebook dependencies, lexical relation candidates, optional typed AI
classifications and bounded transitive dependency inference. Relations expose
origin, confidence, model and the source note snapshot. The index updates
after a 750 ms debounce even when the galaxy is closed. Optional AI maintenance
is off by default, classifies at most 12 pairs per batch at most every 30
seconds, pauses on failure, and uses the hosted decision endpoint (with its
account and credit checks) or the local judge. A source fingerprint retracts
stale classifications. Notebooks are never rewritten by graph maintenance.

## Local preview

Run `npm run dev:all`. Normal app: http://127.0.0.1:5173/

Storage-free sample:
http://127.0.0.1:5173/?aboutDemo=research&knowledgeDemo=1&locale=ja

## Verification

- `npm run typecheck`, `npm run build`, public build with
  `VITE_MIND_ATLAS_PUBLIC_SERVICE=true`.
- `node --experimental-strip-types scripts/verify-knowledge-graph.ts`: scoped
  IDs, source invalidation, traversal, deletion, inference, cascade, progress
  rings (no arc for leaves, done share, risk, satellites) and the map (origin
  anchored, no overlapping spaces, universe positions kept, stable places,
  overview fits the free area).
- `node scripts/verify-knowledge-ui.mjs`: desktop and phone, single universe
  canvas, in-place dissolve, head-on camera, wheel zoom toward the pointer,
  the phone overview framed even when the telescope is tapped right after load,
  map labels with progress bars, minimap, level ladder, ring toggle, cascade
  navigation, relation evidence, question projection, return, cross-space entry
  and background classification with a mocked judge.
- `npm run verify:galaxy`, `npm run verify:ui`, `npm run verify:hosted-service`,
  `npm run verify:hosted-public-ui`, `npm run verify:hosted-dist`.
