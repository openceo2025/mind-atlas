# Board Game Records and Analysis Plan

Status: canonical implementation brief - Phase 1 import/view/edit, native-format persistence, record merge, and mode-aware board layout are implemented in Local Developer Mode and Hosted Public Mode; shogi engine analysis is implemented in Hosted Public Mode; chess and Go analysis remain pending

Phase 1 delivery now covers Shogi KIF/KI2/CSA, Chess PGN, and Go SGF in both
local and hosted modes: records are converted into Atlas nodes, viewed in the
existing preview window, edited by legal board moves, navigated through
variations, and exported back to the canonical format. Hosted mode remains
text-only for ordinary attachments and continues to hide all local developer
and agent surfaces, but board structured content is allowed through a bounded
sanitizer so cloud save/load and public sharing preserve the board mode. Imported notebooks persist a root-level
`standard`/`shogi`/`chess`/`go` mode. Board mode resets the current workspace
before import, restores automatically on cloud/package reload, and uses a
fixed board/editor layout on desktop and mobile. Multi-game selection remains
future work.

Shogi engine analysis is live in Hosted Public Mode: one `AI` button analyzes
the active position with YaneuraOu and Suisho5 on the service host, writes the
evaluation, best move and reading into the node body, and turns the first five
moves of that reading into ordinary record nodes. Chess and Go analysis are not
implemented. Local Developer Mode does not offer analysis, because the engine
is part of the hosted deployment rather than the client.

The persistence and merge follow-up is also complete. Board notebooks use KIF,
PGN, or SGF at every user-visible save boundary, including hosted cloud storage,
public share links, and local bridge storage; legacy JSON records remain readable
and IndexedDB JSON remains an internal crash-recovery representation. A loaded
record can merge a compatible local file, cloud record, browser snapshot, or
pasted native record. Shogi additionally supports copied KIF-like text from
Shogi Wars, Shogi Quest, and Kio, plus exact allowlisted public share URLs from
Shogi Wars and Shogi Quest through a bounded server-side fetcher. Merge matching
is path-aware and position-based, appends only missing variations, deduplicates
title/body text, and preserves edited titles and bodies in native comments.

Last reviewed: 2026-08-23

Target games: shogi, chess, and Go

## 1. Final Decision

Mind Atlas will support board-game records as one optional feature in the main
product. It will not be forked into a separate application and it will not turn
the default Mind Atlas experience into a game application.

The product model is:

1. Import a standard record file.
2. Convert the record and all supported variations into ordinary Atlas nodes.
3. Treat the Atlas tree as the only authoritative variation tree.
4. Render the position associated with the active node in a controlled board
   view.
5. Move through the board view by selecting and focusing the corresponding
   Atlas node.
6. Play a new legal move in the board view to create a new child node, or focus
   the existing child when the same move already exists.
7. Export the current Atlas record tree back to the standard record format.
8. Analyze the active position through a separate engine-analysis service.
   Analysis writes its answer into the record: the evaluation into the analyzed
   node's body, and the engine reading into ordinary move nodes. Undo reverses
   the whole thing in one step. See 11.1 for why this replaced the earlier
   apply-a-candidate-line flow.

Game files are import/export formats. They are not multimedia attachments.
The board is a structured-content viewer. It is not a second notebook and it
must not keep an independent authoritative move tree.

This is the key architectural decision. It preserves the reason to use Mind
Atlas: a move, a comment, an alternative line, and related notes can all be
understood as spatial branches without replacing the general-purpose notebook.

## 2. Product Boundary

### 2.1 In scope

- Shogi import: KIF, KI2, and CSA.
- Shogi export: KIF only.
- Chess import and export: PGN.
- Go import and export: SGF.
- Variations where the input format and parser support them.
- Position replay, previous/next navigation, branch selection, and jump to
  start/end.
- Creating a legal move from the board.
- Creating and selecting the corresponding Atlas node.
- Editable node title and body for every move.
- Cloud save, cloud load, public sharing, local persistence, undo, and normal
  Atlas focusing.
- A mode-aware board-first content view while keeping the Atlas as the primary
  spatial notebook.
- Hosted shogi engine analysis, running as its own service on the service host.

### 2.2 Explicitly out of scope for the first release

- Online matches, clocks, matchmaking, ratings, or game-server integration.
- Replacing ShogiHome, Lichess, OGS, or other full game clients.
- Browser-side engine execution in the first release.
- Automatically asking an LLM to explain every engine result.
- Adding an unbounded engine principal variation to the Atlas. The reading is
  capped at five move nodes; the rest stays in the body text.
- Lossless support for every vendor-specific extension in every record file.
- Importing KI2 or CSA and exporting it again as KI2 or CSA.
- Making game controls visible when the active Atlas has no game record.
- A public plugin marketplace or execution of third-party JavaScript.

### 2.3 Non-negotiable generality rule

Board-specific rendering must remain isolated from the ordinary no-record
experience. The shared core may carry an allowlisted root `notebookMode` and
route a structured-content node to the existing preview surface, but game
  rules and viewers stay under their own feature modules (`src/features/shogi/`,
  `src/features/chess/`, and `src/features/go/`). Hosted public mode preserves
  only the bounded native board record and still strips binary attachments,
  arbitrary multimedia, local filesystem access, and agent execution surfaces.

The default first screen, tutorial, templates, editor, local AI workflow, and
hosted AI workflow must behave exactly as before when no board-game record is
active.

## 3. Why the Attachment Approach Is Rejected

Hosted Mind Atlas intentionally removes attachments through
`createTextOnlyNotebookRoot`. This protects the 10 MB cloud quota and prevents
users from assuming that images or other binary media are stored in the cloud.

Putting SFEN, PGN, SGF, or KIF data into `NodeAttachment` would therefore have
four defects:

- cloud save and public sharing would strip it;
- one attached file would become a second source of truth after node edits;
- node-level branch edits would be difficult to round-trip;
- the preview area would have to understand an opaque file instead of a typed
  position.

The implementation must add a small, text-only, validated structured-content
envelope that survives hosted sanitization. Binary attachment behavior remains
unchanged and remains hidden in hosted mode.

## 4. Source of Truth and Invariants

### 4.1 Authoritative data

The authoritative record is the Atlas hierarchy plus typed metadata on record
and move nodes.

- A record root is an ordinary Atlas node with `role: "record-root"`.
- Each move is an ordinary child node with `role: "move"`.
- The first game-move child is the main line.
- Additional game-move children are variations.
- Ordinary note children may coexist with move children but are ignored when
  replaying or exporting moves.
- Selecting an ordinary note below a move shows the position of its nearest
  game-move ancestor.
- A game move may not be structurally reparented in the first release.
  Spatial dragging remains allowed because it changes position, not ancestry.

The node title is initialized from the game's display notation, but users may
edit it freely. Never parse the title to recover a move. The body stores the
human comment or note and maps to the format's comment field where supported.

### 4.2 Required invariants

1. Every move node belongs to exactly one `recordId`.
2. Every move node has a record-root ancestor with the same `recordId` and
   game.
3. The canonical move is legal from the nearest ancestor move position.
4. `ply` equals the number of canonical moves from the record root.
5. A direct parent cannot contain two move children with the same canonical
   move key.
6. `positionKey` is derived from initial state, rules, and the full canonical
   move path. It is never trusted only because it came from a file or browser.
7. Board navigation changes the active Atlas node; it does not maintain a
   separate current-node identity.
8. Import, new-move creation, analysis-line application, and main-line changes
   each commit as one undoable store transaction.
9. Export validates the entire selected record before producing a file. A
   partially invalid tree is not silently truncated.
10. Hosted sanitation rejects unknown structured-content kinds and invalid or
    oversized payloads instead of preserving arbitrary JSON.

## 5. Core Structured-Content Contract

Phase 1 currently uses the concrete allowlisted union already present in
`src/types.ts`: `ShogiRecordContent`, `ChessRecordContent`, and
`GoRecordContent`. The generic envelope below remains the long-term direction
for adding more board-game families; do not replace the working Phase 1 data
with an unvalidated `payload: unknown` during later refactors.

Add one optional field to `AtlasNode`:

```ts
export interface AtlasNode {
  // Existing fields remain unchanged.
  structuredContent?: AtlasStructuredContent;
}

export type AtlasStructuredContent = BoardGameStructuredContent;

export interface BoardGameStructuredContent {
  kind: "board-game-record";
  schemaVersion: 1;
  payload: BoardGameRecordNodePayload;
}
```

Do not make `payload: unknown` flow through the app without validation. Use a
closed TypeScript union and a small internal registry so another structured
content kind can be added later without teaching the core about games.

```ts
export interface StructuredContentHandler<T extends AtlasStructuredContent> {
  kind: T["kind"];
  validate(value: unknown): T | null;
  sanitizeForHosted(value: T): T;
  estimateBytes(value: T): number;
}
```

This is an internal registry, not a dynamic plugin system. It must never load
code or schemas from notebook data.

### 5.1 Record payload

```ts
export type BoardGame = "shogi" | "chess" | "go";

export interface BoardGameRecordRootPayload {
  role: "record-root";
  recordId: string;
  game: BoardGame;
  sourceFormat: "kif" | "ki2" | "csa" | "pgn" | "sgf" | "new";
  metadata: Record<string, string>;
  initialState: GameInitialState;
  rules: GameRules;
  result?: string;
  importedAt?: string;
  sourceWarnings?: string[];
}
```

### 5.2 Move payload

```ts
export interface BoardGameMovePayload {
  role: "move";
  recordId: string;
  game: BoardGame;
  ply: number;
  move: CanonicalGameMove;
  positionKey: string;
  annotations?: GameMoveAnnotations;
  compactAnalysis?: CompactGameAnalysis;
}
```

Do not invent one untyped universal move string. Use a discriminated union:

```ts
export type CanonicalGameMove =
  | {
      game: "shogi";
      usi: string;
      from?: string;
      to: string;
      dropPiece?: string;
      promote: boolean;
    }
  | {
      game: "chess";
      uci: string;
      san: string;
      from: string;
      to: string;
      promotion?: string;
    }
  | {
      game: "go";
      color: "B" | "W";
      vertex: string | "pass";
    };
```

`positionKey` is a SHA-256 hash over normalized initial state, rules, and the
canonical path. SFEN or FEN alone is insufficient for repetition history, and
Go superko also depends on the path.

### 5.3 Format-specific fidelity

The first release must preserve these fields:

| Format | Required fidelity |
| --- | --- |
| KIF | headers, initial position, moves, variations, comments, elapsed time when present, result/end reason |
| KI2 | headers, initial position, linear moves, comments when parsed; import only |
| CSA | headers, initial position, linear moves, time when parsed, result; import only |
| PGN | tags, starting FEN, moves, recursive annotation variations, comments, NAGs, result |
| SGF | FF[4]/GM[1], root metadata, board size, rules, komi, setup stones, moves/pass, comments, variations, result |

Unsupported safe format properties may be preserved in a bounded
`sourceExtras` property bag. They are never rendered as HTML or executed.
Unknown properties must be capped by property count, value count, and string
length. Import warnings must tell the user when a field cannot be preserved.

## 6. Import and Export UX

### 6.1 Import

Add `Import game record` to the existing import/export menu. It accepts:

- `.kif`, `.kifu`, `.ki2`, `.csa`
- `.pgn`
- `.sgf`

The importer follows this sequence:

1. Read the file as bytes and enforce the size limit before parsing.
2. Detect format from extension and content; conflicting detection requires a
   user-visible error.
3. Decode Shift_JIS KIF/KI2 with `TextDecoder("shift_jis")`; keep UTF-8 paths
   for KIFU/PGN/SGF.
4. Parse into a game-neutral `ParsedGameRecord[]`.
5. Validate node count, depth, comments, rules, and every canonical move.
6. If the file contains multiple games, show a selection list. Default to all,
   but do not import until the user confirms.
7. Convert every selected record into a subtree under the Atlas root.
8. Commit all selected records atomically and focus the first record root.
9. Show non-fatal fidelity warnings after success.

CSA can contain multiple records. The adapter must split records before calling
`tsshogi`, because `tsshogi` imports only the first CSA record in one string.

Initial safety limits, all configurable and covered by tests:

- 8 MiB input file;
- 100 games per file;
- 5,000 generated Atlas nodes per import;
- 10,000 characters per individual comment;
- 100,000 total comment characters per game;
- iterative traversal with a 5,000-level hard depth guard.

Reject over-limit imports before mutating the Atlas. These limits may be raised
after profiling, but hosted cloud data must still fit the existing 10 MB user
quota.

### 6.2 Export

Export operates on the nearest record root of the active node. When no record
is active, game export is disabled with an explanation.

- Shogi always exports KIF.
- Chess exports PGN.
- Go exports SGF.
- Export uses canonical metadata. Edited node titles are encoded in a reserved,
  versioned comment marker and restored on re-import.
- Move-node bodies remain ordinary native comments beside that title marker.
- Ordinary note children are not converted into moves. The first release does
  not export them; it warns when they exist.
- Child order defines main line first, then variations.
- A branch command named `Set as main line` moves the chosen move child to
  index zero in one undoable transaction.
- Invalid records produce a node-specific error list and no file.

### 6.3 Copy, paste, and delete

To protect record validity in the first release:

- normal spatial movement remains allowed;
- deleting a move deletes its variation subtree through existing Atlas undo;
- copying or cutting an individual move subtree into a different parent is
  blocked with a clear message;
- duplicating a whole record root is allowed only through a dedicated action
  that creates a new `recordId` and recomputes every `positionKey`;
- later work may add validated move-subtree grafting behind the game adapter.

## 7. Board Viewer UX

### 7.1 Placement in Mind Atlas

Do not reuse the binary attachment preview gate. Add a structured-content slot
to the existing right-side content area:

- `Editor` remains available for title and body.
- `Board` appears only when the active node resolves to a game record.
- Hosted mode may show `Board` because its data is text-only and cloud-safe.
- Existing attachment controls remain local-only.

Add three presentation modes over time:

1. `Atlas focus`: current default, Atlas large and board in the content panel.
2. `Split`: Atlas and board share the viewport.
3. `Board focus`: board is primary and Atlas becomes a smaller synchronized
   navigator. This is a later milestone, not a prerequisite for import/replay.

The mode is visible only while a game record is active. Leaving the record
restores the normal panel arrangement.

### 7.2 Controls

The controlled board view contains:

- start, previous, next, and end icon buttons;
- current ply and side to move;
- a branch selector only when more than one move child exists;
- board orientation toggle;
- legal move input by tap-tap and drag where the chosen board component
  supports it;
- promotion choice for shogi and chess;
- pass action for Go;
- `Analyze position` action when an analysis backend is available;
- evaluation and candidate overlays only after a result exists.

Keyboard support:

- Left/Right: previous/next move when focus is in the board viewer and not in a
  text input.
- Home/End: record start/end.
- Up/Down or a menu: previous/next sibling variation.
- Escape: cancel an in-progress move or promotion choice.

### 7.3 Synchronization

Board-to-Atlas:

1. Navigation resolves the destination move node ID.
2. One store action sets that node active.
3. Existing camera focus is requested exactly once after the panel layout is
   stable.
4. The Editor shows that move's editable title and body.

Atlas-to-board:

1. Active-node change finds the nearest record root and nearest move ancestor.
2. The adapter reconstructs or loads the cached position for that path.
3. The board updates without firing a synthetic move event.
4. Selecting an unrelated node leaves no stale game controls visible.

New move:

1. The UI proposes a move to the game adapter.
2. The adapter validates and canonicalizes it.
3. If an identical canonical direct child exists, focus it.
4. Otherwise create one child move node, set its generated notation as the
   initial title, calculate `positionKey`, and commit one store transaction.
5. Focus the new node after layout has accepted it.

This flow must not trigger repeated camera fits from board render, panel resize,
and node creation. The store action owns the focus request; render effects do
not.

## 8. OSS Selection

Selection criteria are commercial usability, license compatibility, mobile
input, variation support, TypeScript/React fit, maintained code, and the ability
to keep Atlas as the single source of truth.

### 8.1 Selected stack

| Game | Record/rules layer | Board UI | Decision |
| --- | --- | --- | --- |
| Shogi | `tsshogi` | `shogiground` behind a controlled React adapter | selected |
| Chess | `kokopu` | `react-chessboard` | selected |
| Go | `@sabaki/sgf`, `@sabaki/immutable-gametree`, `@sabaki/go-board` | `@sabaki/shudan` behind a controlled adapter | selected, subject to the Phase 0 React 19/mobile spike |

### 8.2 Shogi rationale

`tsshogi` is MIT-licensed TypeScript with KIF/KI2/CSA/JKF/SFEN/USI support.
Its record is already a move tree and exposes forward/back/goto/branch
operations, legality, position, comments, and times. It is the correct domain
layer.

`shogiground` is a low-level, typed, mobile-oriented board UI with click,
drag/drop, hand pieces, promotion, animation, legal-destination display, and
callbacks. It does not own shogi rules, which is desirable because `tsshogi`
and Atlas remain authoritative.

`shogiground` is GPL-3.0-or-later. Mind Atlas is AGPL-3.0-only and already
publishes its source. GNU GPLv3 and AGPLv3 contain explicit combination terms,
so this is a viable open-source path, including commercial use. Before locking
the dependency, record exact package version, notices, source offer, and asset
licenses in the repository. Use Mind Atlas-owned CSS and piece rendering; do
not copy unverified third-party piece images.

Fallback if the license or integration audit fails: keep `tsshogi` and build a
small controlled React/SVG shogi board. Do not import ShogiHome as an
application.

### 8.3 Chess rationale

`kokopu` is an LGPL-3.0 TypeScript library that combines chess rules with PGN,
FEN, and UCI support, including comments, NAGs, nonstandard initial positions,
and recursive variations. This avoids joining a rules library to a separate
variation parser.

`react-chessboard` is MIT, React 19 compatible, responsive, mobile-capable,
accessible, typed, and provides controlled move events. It is preferable to
embedding Chessground because it fits the existing React stack with a smaller
integration and license surface.

Fallback if Kokopu fails the fixture suite: use BSD-licensed `chess.js` for
rules plus an Apache/MIT PGN parser behind the same adapter. The rest of Mind
Atlas must not know which chess library is used.

### 8.4 Go rationale

The Sabaki libraries are MIT and separate the concerns cleanly:

- `@sabaki/sgf` parses and serializes SGF collections and variations;
- `@sabaki/immutable-gametree` handles immutable tree changes;
- `@sabaki/go-board` handles board state;
- `@sabaki/shudan` is a low-level resizable board with markers, arrows, heat
  maps, and move callbacks.

Shudan uses Preact. Phase 0 must prove that a wrapper can be lazy-loaded beside
React 19, can be controlled from Atlas state, and passes iPhone/Android touch
tests without owning page scroll. If it fails, use the same Sabaki domain
libraries with a minimal Mind Atlas SVG/canvas board.

BesoGo is an excellent MIT SGF editor/viewer and a useful behavior reference,
but it keeps its own editor and game-tree state. Embedding the whole application
would create the exact double-source problem this design forbids. It may be
used as a fixture oracle, not as the production state owner.

### 8.5 Existing `sss4` code

`C:\Users\satof\sato\sss4` is useful as an interaction and visual reference.
Its core code is marked MIT, but it uses old global scripts, Three.js r105,
board snapshots, and does not provide the required standard-format/variation
architecture. It must not become the new domain layer.

Do not copy its fonts or art until each asset's license is verified. Reuse ideas
such as piece readability, depth, and atmosphere; implement them in the new
controlled board adapters.

## 9. Module Architecture

Create these ownership boundaries. Exact filenames may be adjusted only when
an existing equivalent module already exists.

```text
src/
  structuredContent/
    types.ts
    registry.ts
    sanitize.ts
  features/
    boardGames/
      domain/
        types.ts
        adapter.ts
        recordTraversal.ts
        positionKey.ts
        validation.ts
      adapters/
        shogiAdapter.ts
        chessAdapter.ts
        goAdapter.ts
      importExport/
        detectFormat.ts
        importGameRecords.ts
        exportGameRecord.ts
      components/
        BoardGamePanel.tsx
        BoardNavigation.tsx
        BranchSelector.tsx
        AnalysisDialog.tsx
        AnalysisResult.tsx
        boards/
          ShogiBoard.tsx
          ChessBoard.tsx
          GoBoard.tsx
      state/
        boardGameSelectors.ts
        boardGameCommands.ts
      analysis/
        types.ts
        client.ts
        resultMapping.ts
server/
  game-analysis-service.mjs
  game-analysis-db.mjs
scripts/
  game-analysis/
    worker.mjs
    engine-process.mjs
    usi-adapter.mjs
    uci-adapter.mjs
    katago-adapter.mjs
```

`App.tsx`, `UniverseCanvas.tsx`, and `atlasStore.ts` should receive only small
host hooks or extracted commands. Do not place parser, engine, or board logic
inside those already large modules.

### 9.1 Game adapter contract

```ts
export interface BoardGameAdapter {
  game: BoardGame;
  parse(input: DecodedGameFile): ParsedGameRecord[];
  serialize(record: ValidatedAtlasGameRecord): string;
  reconstruct(path: CanonicalGameMove[], root: BoardGameRecordRootPayload): GamePosition;
  legalMoves(position: GamePosition): CanonicalGameMove[];
  canonicalizeMove(position: GamePosition, proposal: GameMoveProposal): CanonicalGameMove | GameMoveError;
  applyMove(position: GamePosition, move: CanonicalGameMove): GamePosition | GameMoveError;
  displayMove(position: GamePosition, move: CanonicalGameMove, locale: string): string;
  positionKey(root: BoardGameRecordRootPayload, path: CanonicalGameMove[]): Promise<string>;
  validateRecord(record: AtlasNode): GameRecordValidationResult;
}
```

The importer may use a library's native tree temporarily, but it must normalize
into this contract before changing Atlas state.

## 10. Performance and Mobile Rules

- Lazy-load each game's parser and board UI only when importing or opening that
  game.
- Do not include engine binaries or neural networks in the browser bundle.
- Reconstruct positions from the canonical path initially. Add a bounded LRU
  cache keyed by `positionKey` only after correctness tests pass.
- Traverse imported trees iteratively to avoid call-stack failure.
- Keep board pointer handling inside the board surface. Do not install global
  touch listeners.
- Set `touch-action` narrowly: allow board gestures required for move input,
  but do not block page/Atlas scrolling outside the board.
- Tap-tap move input is mandatory on mobile even when drag/drop works.
- Promotion selection must fit without moving the board or causing repeated
  camera recentering.
- Test at 390x844 portrait, 844x390 landscape, and a current iPhone Safari
  viewport in addition to desktop.
- A 300-move main line and a 1,000-node variation fixture must navigate without
  a visible full-tree rebuild on every step.
- Imported move-node positions use the existing non-overlap phyllotaxis path;
  the game feature does not invent a second Atlas layout algorithm.

## 11. Engine Analysis Product Contract

### 11.1 User flow

Shipped for shogi in Hosted Public Mode. Chess and Go remain unimplemented and
keep the engine selection in 11.2 as their target.

There is no analysis dialog. The board layout reserves its space for the board
itself, and a modal asking for candidate counts and search budgets before every
question would cost more attention than the answer is worth. Analysis is one
button with fixed settings.

The `AI` button sits at the head of the atlas action cluster, to the left of
share and the menu, using the same control shell so the cluster stays one row.
The same button serves desktop and mobile, because board mode already keeps
that cluster on screen in both layouts.

1. The button appears only in shogi mode, and only in Hosted Public Mode.
2. Pressing it while signed out starts Google sign-in instead of analyzing.
3. Pressing it analyzes the position on the active node. Move nodes and the
   initial position both qualify; a special-move node (resignation, repetition)
   does not.
4. The analyzed node pulses in the universe while the search runs, exactly as
   an agent request does, and the button shows its own running state.
5. Only one analysis may be in flight for the whole app. The button stays
   disabled everywhere until the answer lands, including on other nodes.
6. The user is free to navigate, edit, and work anywhere else meanwhile.
7. On success the answer is appended to the analyzed node's body and the
   engine reading becomes real move nodes, in one undoable step.
8. A completion pulse fires on the analyzed node, so the notification can be
   followed back to the position it belongs to.
9. On failure or timeout no nodes are created; a short failure line is appended
   to the analyzed node's body and the node pulses in the error colour.

Fixed settings: 5 seconds of search, one candidate move (`MultiPV 1`), a 30
second client deadline. The reading is written into the body in full and the
first five moves of it become nodes.

Unlike the earlier draft of this plan, analysis writes into the record without
asking. The record is the product: a reading the user cannot see in the tree is
a reading they have to hold in their head. The nodes it creates are ordinary
move nodes - random colour, human author, same shape as a played move or a
merged variation - so export, merge, navigation and sharing need no concept of
an "engine node". This is a deliberate reversal of the "never edit the record
until the user applies a line" rule; undo is the escape hatch.

Deduplication carries the weight this decision would otherwise cost. Each move
of the reading reuses the existing child when the move is already there, so a
reading that agrees with the game merges into it instead of growing a parallel
copy, and re-analyzing the same position creates nothing the second time.

### 11.2 Engine selection

| Game | Engine | Protocol | License | Hosted decision |
| --- | --- | --- | --- | --- |
| Shogi | YaneuraOu plus an audited evaluation file | USI, MultiPV | GPLv3; evaluation files require separate audit | selected |
| Chess | Stockfish | UCI, MultiPV | GPLv3; bundled network/source obligations apply | selected |
| Go | KataGo plus an audited official network | JSON analysis engine | MIT-style engine and current official network license, with exceptions noted upstream | selected |

Commercial use is allowed by these open-source licenses, but redistribution and
notice/source obligations still apply. Never download a random evaluation file
or neural network during deployment. Pin each binary and model by version and
SHA-256, record its source URL and license, and make notices/source links
available.

### 11.3 Existing external services

No existing service is accepted as the primary three-game analysis backend:

- Lichess Cloud Eval returns cached Stockfish evaluations only when a position
  already exists. Its own API says it is for fetching a few cached positions,
  not arbitrary on-demand computation with a guaranteed requested budget.
- Lichess External Engine is a protocol for connecting a user's engine to
  Lichess, not a Stockfish compute service for Mind Atlas.
- OGS exposes AI reviews associated with OGS games and accounts. It is not a
  stable general arbitrary-position commercial compute contract.
- AI Sensei exposes an end-user KataGo review product, but no verified public
  developer API contract was found for this integration.
- No stable documented shogi position-analysis HTTP service was found with the
  required USI/MultiPV controls and commercial redistribution contract.

The gateway may later add an external provider adapter. Such an adapter must
pass the same contract, disclose third-party data transfer, have written usage
terms, and never become the only way to read saved analysis.

## 12. Analysis API and Data Model

### 12.1 Request

The browser sends one position and nothing else. There is no job identity, no
settings, and no engine selection to negotiate, because the settings are fixed
by the product and the engine is chosen by the deployment.

```ts
// POST /api/board-records/shogi/analyze
{ sfen: string }
```

SFEN is validated against `/^[1-9a-zA-Z+*\/ -]{1,160}$/` by the service and
again by the engine bridge. The charset is a security border, not a formatting
preference: the position is concatenated into a USI command line, so a newline
would let a caller append their own engine commands.

### 12.2 Result

```ts
export interface ShogiAnalysisResult {
  engine: { id: string; name: string; label: string };
  analyzedAt: string;
  sfen: string;
  sideToMove: "sente" | "gote";
  movetimeMs: number;
  depth: number;
  seldepth: number;
  nodes: number;
  nps: number;
  elapsedMs: number;
  terminal: boolean;
  book: boolean;
  score: { kind: "cp" | "mate"; sente: number } | null;
  bestMove: string;
  pv: string[];
}
```

USI reports every score from the mover's point of view. The service normalizes
it to sente-positive once, on the way out, so no consumer has to know whose
turn it was. `terminal` covers `bestmove resign` and `bestmove win`, where
there is an evaluation but no move to play.

The principal variation is capped server-side and replayed client-side against
the real position. Only the legal prefix survives, so a stale or truncated
reading degrades into a shorter line instead of writing impossible moves into
a record.

### 12.3 Route

```text
POST /api/board-records/shogi/analyze
```

One synchronous request, answered or failed within the client's 30 second
deadline. There is no job queue, no polling, and no SSE, because a 5 second
search does not need recovery machinery: if the browser is reloaded mid-flight
the answer is simply lost, and the position can be asked again.

Local developer mode has no route of its own. The engine lives on the hosted
host, and a second local implementation would be a separate feature carrying
its own engine installation, so local mode does not offer analysis at all and
hides the control.

### 12.4 Storage

Analysis is stored in the record, as text and as nodes. There is no separate
analysis table, no cache keyed by position, and no summary object on the node.

This is a deliberate trade. A cache would save real CPU on repeated opening
positions, and a separate store would keep bodies clean. Both were rejected for
the same reason: an analysis the user cannot read in the body, export to KIF,
or carry into a share link is an analysis that lives outside the product's only
durable artifact. The body is what survives export, merge, cloud save and
sharing, so that is where the answer goes.

What is written:

- On the analyzed node: a four-line Japanese block appended to the end of the
  body — the sente-normalized evaluation, the best move, the whole legal
  reading, and last the engine, its budget or `定跡`, and the timestamp.
  Repeated analysis appends another block; nothing is overwritten.
- On each move node the reading created: a one-line stamp naming when and with
  what the line was produced. The evaluation is not repeated there, because it
  belongs to the position that was actually analyzed.
- On failure: an `error:` line with a trimmed, bounded reason, then the same
  closing provenance line.

The evaluation leads and the provenance closes. The block is appended to a body
that may already be long, and on a phone the reader sees its first line or two;
a header naming the engine and the timestamp would spend exactly that space on
what nobody reads first, pushing the answer out of view.

The completion notification points at the node holding the engine's move, not
at the analyzed position. The question was "what is the move here", so
following the notification should land on the answer rather than back where the
question was asked. When the move was already in the record the existing node
is the target; a position with no legal continuation falls back to the analyzed
node. Board notebooks also suppress the snooze prompt that ordinarily follows a
notification: snoozing defers work that waits on a person, and by the time this
notification is read the engine's answer is already in the tree.

Bodies are Japanese regardless of interface language. A body is persisted data
that round-trips through KIF comments; localizing at write time would freeze
whichever language the author happened to be using, and re-reading it later in
another language would be worse than reading it in one fixed language. Blocks
are delimited with ASCII rules rather than box-drawing characters so a KIF
comment survives a Shift_JIS export path.

Raw engine output is never stored or forwarded. The service parses `info` and
`bestmove` lines and emits only the typed result above.

## 13. Local and Hosted Execution

### 13.1 Local developer mode

Local Developer Mode does not run engine analysis and does not show the `AI`
button. The engine, its evaluation file and its resource limits are part of the
hosted deployment; adding a local path would mean a second implementation, a
second installation for the developer, and a second surface to keep aligned.
The Mode Safety Contract cuts both ways here: hosted analysis must not become a
requirement for working locally.

If local analysis is ever added, it belongs behind the existing local bridge
with its own engine discovery, never as a browser-side engine and never as a
hosted dependency that local mode cannot start without.

### 13.2 Hosted service

The engine does not run inside `server/mind-atlas-service.mjs` or its event
loop. It runs as `mind-atlas-shogi-engine.service`, a separate systemd unit on
the same host, and the web service reaches it over localhost.

A position in the opening book is answered from the book, not by searching.
The book (2.25M positions, MIT, published by the YaneuraOu project) holds
evaluations from far deeper analysis than a five second search reaches, and it
answers in about 50 ms, so it is both the better answer and the cheaper one.
Three of its defaults are written for an engine playing a game rather than
answering a question and are overridden: `IgnoreBookPly` (a position is the
question; the move number it was reached at is not), the eval limits that make
an engine refuse to enter an opening it dislikes, and `BookEvalDiff`, whose
default of 30 centipawns exists to give a playing engine variety and would give
an analysis a randomly worse move. A book answer is labelled `定跡` everywhere
it is shown, because its reading is short by nature and it never spent the five
seconds a search would have.

`server/shogi-engine.mjs` owns one long-lived USI process:

- The engine starts once, loads `nn.bin` once, and stays warm. Loading a 64 MB
  evaluation file per request would cost more than the search.
- `FV_SCALE` is set to 24 for Suisho5. The engine default of 16 produces a
  plausible but silently wrong evaluation with this file, so it is configured
  explicitly rather than inherited.
- `NetworkDelay`, `NetworkDelay2` and `MinimumThinkingTime` are set to zero.
  The last one defaults to 2000 ms and exists for real games, not analysis.
- Every request is serialized through one queue. The engine is a single shared
  CPU resource, and this queue is the second line of defence behind the
  per-account single-flight limit.
- A search that overruns its budget is stopped, and an engine that ignores the
  stop is killed and restarted rather than left wedged.

There is no PostgreSQL job queue, no worker pool and no reaper. A 5 second
synchronous search does not need them, and the durable-queue design in earlier
drafts of this plan was sized for a product where analysis was a metered,
long-running, billable job. It is not: it is free, bounded, and fast.

The systemd unit is where the shared host is protected:

```ini
Nice=10
CPUWeight=20
CPUQuota=200%
MemoryHigh=500M
MemoryMax=700M
```

`CPUWeight=20` is the important line. One search saturates its threads for the
whole movetime, and on a 4 vCPU host that would be felt by every visitor. A
weight below the default keeps the engine strictly subordinate: the web service
wins the CPU whenever it wants it, and analysis fills the gaps. `MemoryMax`
means a runaway engine is killed instead of the web service.

Measured budget on the current ConoHa host (4 vCPU Icelake Xeon with AVX-512
VNNI, 3.9 GB RAM): 64 MB of resident evaluation weights, a 128 MB transposition
table, two search threads, roughly 300-400 MB in total. Memory was never the
constraint here; CPU scheduling was.

### 13.3 Hosted abuse and cost controls

Analysis is free and requires Google sign-in. There is no credit reservation,
no entitlement check beyond authentication, and no billing path, so the rate
limit is the only thing between a shared CPU and a busy visitor.

- Google login required; a signed-out press starts sign-in instead.
- Ten analyses per account per minute. No daily cap.
- One concurrent analysis per account, enforced server-side, and one in-flight
  request per browser, enforced by the button.
- One engine-wide queue with a bounded length; a full queue is refused, not
  buffered.
- 30 second client deadline, 30 second service deadline to the engine bridge.
- SFEN validated against a strict charset by both the service and the bridge,
  because it is concatenated into a USI command line.
- The engine bridge listens on localhost only and is never exposed by nginx.
- Engine paths, stderr, and raw USI output never reach the browser. The service
  emits only the typed result.
- Analysis requests are recorded as `ai_request_started` / `succeeded` /
  `failed` product events with `feature: "shogi_analysis"`, so usage is visible
  in admin reporting without storing any position or private node text.

## 14. Licensing and Commercial Release Checklist

This is an engineering checklist, not legal advice.

Before each dependency or engine becomes production-enabled:

1. Pin the exact package/binary/model version and checksum.
2. Save upstream repository, release URL, copyright notice, and license SPDX.
3. Add the license text to `THIRD_PARTY_NOTICES.md` or the existing equivalent.
4. Confirm every bundled image, font, piece set, sound, network, and evaluation
   file separately. Source-code license does not automatically cover assets.
5. For GPL engines/UI, provide the exact corresponding source or a durable
   source link and build information required by the license.
6. Keep Mind Atlas's AGPL source link visible to network users.
7. Mark local modifications and dates where the upstream license requires it.
8. Do not use non-commercial piece sets or textures in the paid service.
9. Re-run the audit on every major dependency/model update.
10. Obtain professional legal review before changing Mind Atlas to a
    proprietary license or distributing a closed desktop build.

## 15. Testing Strategy

### 15.1 Fixture corpus

Commit small, attribution-safe fixtures for every supported case:

- standard opening and full game;
- nonstandard initial position;
- comments and metadata;
- one branch and nested branches;
- promotion/drop/pass;
- result/end reason;
- malformed encoding and illegal move;
- multiple games in one PGN/SGF/CSA file;
- 300-move main line;
- 1,000-node variation tree.

Do not commit copyrighted professional game collections without permission.
Synthetic or public-domain records are sufficient for correctness tests.

### 15.2 Round-trip tests

For each exportable format:

1. import fixture;
2. normalize canonical tree;
3. export;
4. import exported text;
5. compare canonical moves, branch order, comments, metadata, initial state,
   and result.

Edited titles and bodies are included in canonical round-trip equality through
the versioned native comment encoding.

### 15.3 UI tests

- Board next/previous focuses the exact node once.
- Node selection updates the board without creating a move.
- Same move selects an existing child instead of duplicating it.
- Different legal move creates a sibling variation.
- Illegal move creates no node and shows an accessible error.
- Promotion and Go pass work by touch.
- Branch selector and `Set as main line` preserve export order.
- Text editing does not cause repeated board/camera recentering.
- Mobile scrolling outside the board remains smooth.
- Public shared records are viewable without Google login but remain
  read-only until explicitly copied/imported through existing policy.
- Hosted build still hides binary attachments and all local executable paths.

### 15.4 Analysis tests

- Fake USI/UCI/KataGo processes prove parsing deterministically.
- Candidate ranking and perspective normalization.
- mate, no-result, engine crash, malformed output, cancellation, and budget
  exhaustion.
- stale `positionKey` blocks variation application.
- existing moves are reused while applying a PV.
- reservation, settlement, refund, idempotency, concurrency, and stale-job
  cleanup.
- worker outage does not break `/health` or notebook use.
- no engine command/path/secret appears in browser errors.

### 15.5 Existing mode gates

Every shared-core task runs:

```text
npm run typecheck
npm run build
npm run verify:ui
npm run verify:hosted-service
npm run verify:hosted-public-ui
npm run build:hosted
```

Add focused commands as the feature lands:

```text
npm run verify:board-game-core
npm run verify:board-game-import
npm run verify:board-game-ui
npm run verify:game-analysis
```

## 16. Milestones and Bounded Task List

Each task below is one agent goal. A low-effort model must not combine tasks,
skip dependencies, install an unapproved alternative library, commit, push, or
deploy unless the user explicitly asks.

### Milestone 0 - Proof and license lock

#### BG-000: Record the ADR

- Create a short ADR that fixes Atlas as the sole record tree and rejects
  attachment storage and whole-viewer ownership.
- Link this plan.
- Verification: documentation link check only.

#### BG-001: Lock dependency and asset licenses

- Inspect exact current package versions for tsshogi, shogiground, kokopu,
  react-chessboard, Sabaki libraries, Shudan, and transitive runtime deps.
- Create/update third-party notices.
- Prohibit unverified fonts and board/piece art.
- Acceptance: every runtime package and asset has SPDX, source URL, version,
  checksum or lockfile identity, and redistribution note.
- Dependency: BG-000.

#### BG-002: Run UI compatibility spikes

- Render shogiground, react-chessboard, and Shudan in isolated controlled test
  pages using the current React/Vite toolchain.
- Verify resize, tap-tap, drag, promotion/drop/pass hooks, cleanup, lazy loading,
  iPhone Safari, and Android Chrome.
- No Atlas integration yet.
- Acceptance: written pass/fail evidence. A failed Shudan spike selects the
  custom Go board fallback; a failed shogiground spike selects the custom shogi
  board fallback.
- Dependency: BG-001.

### Milestone 1 - Generic structured content

#### BG-010: Add the closed structured-content type and registry

- Add optional `AtlasNode.structuredContent`.
- Add validator registry with only `board-game-record` registered.
- No board UI or parser.
- Acceptance: valid payload round-trips in memory; unknown kind is rejected.
- Dependency: BG-000.

#### BG-011: Preserve safe structured content everywhere

- Update notebook validation, IndexedDB snapshots, JSON/package import/export,
  copy/clone helpers, cloud text-only sanitizer, public share load, and size
  accounting.
- Keep binary attachment stripping unchanged.
- Acceptance: one fixture survives local save, cloud sanitizer, share
  serialization, and restore byte-for-byte after normalization; malicious and
  oversized payloads are rejected.
- Dependency: BG-010.

#### BG-012: Add the structured-content panel host

- Add lazy `Board` slot without game implementation.
- Ensure ordinary notebooks have no new visible controls.
- Acceptance: fake handler opens/closes with one active-node transition and
  hosted attachment visibility is unchanged.
- Dependency: BG-011.

### Milestone 2 - Game-neutral domain

#### BG-020: Add game types and adapter contract

- Implement the types and contract from Sections 5 and 9.
- Add a fake deterministic game adapter.
- Dependency: BG-011.

#### BG-021: Add record traversal and validation

- Iterative record-root discovery, nearest move lookup, move-child filtering,
  duplicate detection, branch order, path extraction, and validation errors.
- Acceptance: ordinary note children never enter a move path.
- Dependency: BG-020.

#### BG-022: Add transactional game commands

- Import subtree, create-or-focus move, delete variation, duplicate whole
  record, and set-main-line commands.
- Use existing undo and non-overlap node placement.
- Test only with fake adapter.
- Dependency: BG-021.

### Milestone 3 - Shogi vertical slice

#### BG-100: Implement shogi parse/normalize

- Add tsshogi behind `ShogiAdapter`.
- KIF/KI2/CSA decoding, multi-CSA splitting, canonical USI moves, metadata,
  comments, time, result, and variations.
- Dependency: BG-002, BG-020.

#### BG-101: Implement KIF export and round-trip fixtures

- Export canonical Atlas tree to KIF only.
- Validate branch order and edited body comments.
- Dependency: BG-100, BG-021.

#### BG-102: Implement the controlled shogi board

- Wrap the selected board UI; no independent record tree.
- Navigation, orientation, tap/drag, hand drops, promotion, legal destinations,
  and active-node synchronization.
- Dependency: BG-002, BG-022, BG-100.

#### BG-103: Ship the shogi import/export UI

- Menu action, multi-game selection, warnings, board tab, mobile QA, i18n keys.
- Acceptance: import KIF with a branch, navigate from both surfaces, add a move,
  edit title/body, cloud-sanitize, share-load, export, and re-import.
- Dependency: BG-101, BG-102.

This is the first user-visible release candidate. Do not start chess until this
slice proves the core architecture.

### Milestone 4 - Chess

#### BG-200: Implement PGN adapter

- Kokopu parse/serialize, FEN initial state, canonical UCI/SAN, RAV branches,
  comments, NAGs, tags, and result.
- Dependency: BG-103.

#### BG-201: Implement controlled chess board

- react-chessboard wrapper, touch/click/drag, promotion, orientation, legal
  moves, branch navigation, and node sync.
- Dependency: BG-200.

#### BG-202: Complete chess round-trip and hosted checks

- PGN fixture suite, cloud/share, mobile, large-record performance, i18n.
- Dependency: BG-201.

### Milestone 5 - Go

#### BG-300: Implement SGF adapter

- Parse/stringify SGF collection, setup stones, board size, rules, komi,
  pass, comments, variations, result, bounded source extras, and canonical
  vertex moves.
- Implement ko/superko validation using record history and stored rules.
- Dependency: BG-103 and successful BG-002 Go decision.

#### BG-301: Implement controlled Go board

- Shudan or documented fallback, tap placement, pass, orientation/coordinates,
  last move, variation navigation, and node sync.
- Dependency: BG-300.

#### BG-302: Complete Go round-trip and hosted checks

- SGF fixture suite, collections, cloud/share, mobile, large-record performance,
  i18n.
- Dependency: BG-301.

### Milestone 6 - Presentation modes

#### BG-400: Add split view

- Responsive segmented control and stable panel/camera offsets.
- Dependency: BG-202, BG-302.

#### BG-401: Add board-focus view

- Board becomes primary, Atlas becomes a synchronized secondary navigator.
- Exiting restores the previous general-purpose layout.
- Dependency: BG-400.

### Milestone 7 - Local analysis

#### BG-500: Add engine process abstraction and fake engines

- Durable request IDs, structured stdout parser, cancellation, crash cleanup,
  hard resource ceilings, and no shell composition.
- Dependency: BG-103.

#### BG-501: Add local Stockfish adapter

- UCI handshake, MultiPV, time/nodes/depth, centipawn/mate parsing, PV mapping.
- Dependency: BG-500, BG-202.

#### BG-502: Add local YaneuraOu adapter

- USI handshake, audited eval discovery, MultiPV, limits, score/PV mapping.
- Dependency: BG-500, BG-103.

#### BG-503: Add local KataGo adapter

- JSON analysis engine, visits/time, analysisPVLen, candidate moves, win rate,
  score lead, and model identity.
- Dependency: BG-500, BG-302.

#### BG-504: Add analysis dialog and result preview

- Common primary controls, engine-specific advanced controls, temporary PV
  playback, stale-position guard, and explicit add-as-variation transaction.
- Dependency: BG-501, BG-502, BG-503.

### Milestone 8 - Hosted analysis

#### BG-600: Add database migration and queue contract

- Analysis jobs, events/status, compact results, idempotency, cache key,
  reservation linkage, retention, and indexes.
- No engine process yet.
- Dependency: BG-504.

#### BG-601: Add authenticated hosted analysis routes

- Same-origin, session, entitlement, validation, limits, reservation, SSE/poll,
  cancellation, user ownership, safe errors, and fake worker tests.
- Dependency: BG-600.

#### BG-602: Add isolated CPU worker

- Non-root YaneuraOu/Stockfish process pool, PostgreSQL claim, settlement,
  refund, crash and stale-job recovery, health and admin usage.
- Dependency: BG-601.

#### BG-603: Benchmark and price CPU analysis

- Measure current ConoHa host without enabling public traffic.
- Record p50/p95 latency, CPU, RAM, jobs/hour, worst-case cost, and safe
  concurrency for every preset.
- Go/no-go decides same VPS versus separate worker VPS.
- Dependency: BG-602.

#### BG-604: Add KataGo worker behind a feature flag

- Deploy only after GPU/CPU benchmark, model license lock, pricing, and failure
  isolation pass.
- Dependency: BG-601, BG-603.

#### BG-605: Staged hosted rollout

- Internal account, then a very small user cohort, then general Pro access.
- Monitor queue, failure, settlement, actual cost, abuse, and web-service health.
- Dependency: BG-603 and optional BG-604.

### Milestone 9 - Discovery and promotion

#### BG-700: Add game-specific landing pages

- Separate shogi/chess/Go entry pages may promote the feature.
- They deep-link into the same main application and do not fork product code.
- Show real UI and real import/replay/share behavior.
- Dependency: at least one released vertical slice.

#### BG-701: Add KPI events

- Record import completed, record opened, move navigated, variation created,
  record shared, analysis started/succeeded/failed, and analysis line applied.
- Never record file text, comments, positions, or share tokens in analytics.
- Dependency: BG-700.

## 17. Definition of Done for the Whole Feature

The design is fully implemented only when all of the following are true:

- KIF/KI2/CSA, PGN, and SGF imports create valid Atlas record trees.
- KIF, PGN, and SGF exports preserve supported variations and comments.
- Board and Atlas selection synchronize in both directions without duplicate
  camera work.
- A legal board move creates or focuses exactly one node.
- Normal notebooks show no game UI and have no game bundle startup cost.
- Local, cloud-save, share, copy/load, undo, and hosted text-only boundaries are
  preserved.
- Shogi, chess, and Go pass the fixture, round-trip, mobile, and large-record
  tests.
- Local analysis returns normalized evaluations and explicit candidate lines.
- Hosted analysis is asynchronous, credit-reserved, capped, isolated, and
  proven not to degrade the public notebook service.
- Every source dependency, executable, model, font, image, and piece set has a
  recorded commercial-compatible license and source.
- Analysis never changes the record without explicit user confirmation.
- A separate game landing page can promote the feature without changing the
  generic Mind Atlas first experience.

## 18. Instructions for Future Coding Agents

Before editing:

1. Read `AGENTS.md`, `docs/mode-safety-contract.md`, and this document.
2. State the exact task ID being implemented.
3. Inspect the current code; this document describes ownership and contracts,
   not permission to overwrite newer implementation.
4. Keep hosted/local separation intact.
5. Use only the dependency selected by BG-001/BG-002 evidence.
6. Do not move game logic into `App.tsx`, `UniverseCanvas.tsx`, or the main store
   when an extracted module can own it.
7. Do not treat a title as a move or a file attachment as the record.
8. Do not add a second authoritative variation tree.
9. Do not start a later task when the current task's acceptance criteria fail.
10. Report tests run, remaining risk, and whether any license/asset question is
    unresolved.

## 19. Primary References

Reviewed 2026-08-11:

- tsshogi: https://github.com/sunfish-shogi/tsshogi
- Shogiground: https://github.com/WandererXII/shogiground
- ShogiHome, interaction reference only: https://github.com/sunfish-shogi/shogihome
- Kokopu: https://github.com/yo35/kokopu
- react-chessboard: https://github.com/Clariity/react-chessboard
- Sabaki SGF: https://github.com/SabakiHQ/sgf
- Sabaki immutable game tree: https://github.com/SabakiHQ/immutable-gametree
- Sabaki Go board: https://github.com/SabakiHQ/go-board
- Shudan: https://github.com/SabakiHQ/Shudan
- BesoGo, behavior reference only: https://github.com/yewang/besogo
- YaneuraOu: https://github.com/yaneurao/YaneuraOu
- Stockfish: https://github.com/official-stockfish/Stockfish
- KataGo: https://github.com/lightvector/KataGo
- KataGo analysis protocol: https://github.com/lightvector/KataGo/blob/master/docs/Analysis_Engine.md
- KataGo official network license: https://katagotraining.org/network_license/
- Lichess Cloud Eval contract: https://github.com/lichess-org/api/blob/master/doc/specs/tags/analysis/api-cloud-eval.yaml
- OGS API: https://online-go.com/api-docs/
- GNU GPL/AGPL combination guidance: https://www.gnu.org/licenses/why-affero-gpl.html.en
