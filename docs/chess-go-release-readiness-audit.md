# Chess and Go Release Readiness Audit

Audit date: 2026-08-30

Status: implementation update on 2026-08-30. The initial audit findings below
were converted into fail-closed behavior and regression checks where the
current product boundary permits it. Remaining items are explicit limits for
future work, not silently accepted input.

## 1. Release decision

| Mode | Current decision | What is already good | Minimum before release |
| --- | --- | --- | --- |
| Chess | **Conditional beta only; no-go for unrestricted general release.** | Standard chess remains delegated to `chessops`; the current implementation also rejects unsupported variants and multi-game PGN, preserves Atlas move-tree safety, supplies the Seven Tag Roster, and shows turn/status information. | Stable release still needs broader archival metadata/state fixtures, localization cleanup, large-record evidence, and a deliberate decision on deeper merge semantics. |
| Go | **Conditional bounded beta only; no-go as a general SGF viewer/editor.** | The current implementation rejects unsupported collections and SGF semantics atomically, preserves compressed setup and `AE`, decodes declared charsets, exports explicit UTF-8/rules/komi/turn metadata, and makes non-Japanese rules plus phone 19x19 editing replay-only. | Stable release still needs broader SGF property coverage, full declared-rules validation, 19x19 precision evidence, localization cleanup, and large-record evidence. |

The decisive distinction is not whether the board can be clicked. Both boards can. The release blockers are silent loss of user data, accepting a file while importing only part of it, and presenting a rule-sensitive SGF editor without preserving the SGF rules and tree semantics.

“Beta” must not mean “may silently discard data.” Every P0 below must either be implemented fully or changed to a clear, atomic rejection before a public beta.

## 2. Product boundary used for this decision

This audit judges Mind Atlas as a record viewer/editor and spatial study tool, not as a replacement for Lichess, OGS, clocks, matchmaking, or an analysis engine. The following are therefore not release blockers by themselves:

- no chess or Go engine analysis;
- no online match or clock;
- no Go scoring/adjudication UI;
- no captured-piece counter;
- no full vendor-specific extension fidelity.

The following are release requirements because the product already claims them:

- one supported native record must import without silent truncation;
- supported moves, variations, comments, initial state, rules, and result must survive a native round trip;
- a legal board edit must follow the stored rules;
- cloud save/share must not lose Atlas data that the same UI allowed the user to create;
- malformed or oversized input must fail before replacing the current workspace;
- unsupported input must produce an explicit warning or rejection, never a plausible but incomplete record.

## 3. Evidence collected

### 3.1 Passing checks

All of these passed on 2026-08-30:

```text
npm run verify:chess
npm run verify:go
npm run verify:board-record-merge

MIND_ATLAS_BOARD_TEST=chess npm run verify:board-ui
MIND_ATLAS_BOARD_TEST=chess-special npm run verify:board-ui
MIND_ATLAS_BOARD_TEST=go npm run verify:board-ui
MIND_ATLAS_BOARD_TEST=go-ko npm run verify:board-ui
MIND_ATLAS_BOARD_TEST=mobile-chess npm run verify:board-ui
MIND_ATLAS_BOARD_TEST=mobile-go npm run verify:board-ui
MIND_ATLAS_BOARD_TEST=light-contrast npm run verify:board-ui

npm run verify:hosted-public-ui
```

The light-theme check reported a worst tested contrast of 5.22:1. Visual inspection used 1440x900 and 390x844 captures. Chess was readable at both sizes. The Go 9x9 fixture was readable; this does not prove 19x19 touch usability.

### 3.2 Reproduced failures and current disposition

These were reproduced without changing repository files:

| Input/action | Initial result |
| --- | --- |
| Add an ordinary Atlas note below a chess or Go move, then native-export | Neither the note title nor body appears in PGN/SGF. The same exporter is used for board cloud save/share. |
| Two valid games in one PGN | `chessops` parses two games; Mind Atlas imports one and exports no trace of the second. |
| Two valid game trees in one SGF collection | Mind Atlas imports one and exports no trace of the second. |
| `(;GM[1]FF[4]SZ[9];C[between];B[dd])` | Import succeeds but produces zero move nodes; the subtree after the comment-only node is gone. |
| `(;GM[1]FF[4]SZ[9]AB[aa:cc];B[dd])` | Import succeeds with zero setup stones instead of the compressed 3x3 block. |
| Shift_JIS SGF with `CA[Shift_JIS]GN[日本]` | Imported title becomes `���{`. |
| Export a new Go record containing Japanese text | UTF-8 Japanese bytes are emitted, but `CA[UTF-8]`, `RU`, and `KM` are absent. SGF's default charset is not UTF-8. |
| `(;GM[3]FF[4]SZ[9];B[dd])` | Accepted as a Go record even though SGF `GM[3]` identifies chess. |
| `RU[NZ]` record containing a legal New Zealand-rules suicide | Rejected as `Illegal SGF move`. |
| Start a new chess record and export immediately | Only an `Event` tag is emitted; the PGN Seven Tag Roster is incomplete. |

Current disposition: ordinary Atlas children are now rejected during native
export, and board-mode insertion blocks unsupported child nodes. Multi-game
PGN/SGF collections, unsupported chess variants, non-move SGF nodes, unknown
Go game types, rectangular boards, and unsupported SGF properties now reject
atomically. Compressed setup and `AE` are preserved, declared SGF charsets are
decoded, Go exports declare UTF-8/rules/komi/player-to-move metadata, and new
Go editing is limited to Japanese rules. Phone 19x19 Go is replay-only. The
bounded byte, node, comment, and depth limits run before workspace replacement.

### 3.3 Why passing tests did not catch these

The current chess fixture contains one standard game with one variation. The Go fixture contains one UTF-8, square-board tree whose non-root nodes are all moves and whose setup does not use compressed points or `AE`. The UI tests use a 9x9 Go board. There are no committed boundary fixtures for collections, alternate SGF charsets, setup nodes, compressed setup, explicit non-Japanese rules, standard-game rejection, 19x19 touch input, import size/depth limits, or ordinary Atlas note survival across cloud/native persistence.

## 4. Severity rules

- **P0 / release blocker:** can silently lose user data, replace a workspace with an incomplete record, or crash/freeze on untrusted public input. Must be fixed or fail closed before beta.
- **P1 / stable-release blocker:** core rules or interoperability are materially wrong, but the issue can be avoided by an explicit beta scope or replay-only restriction.
- **P2 / quality:** visible polish, accessibility, localization, or evidence gap that does not itself corrupt a record.

## 5. Shared P0 findings

### RG-001 — Ordinary Atlas branches disappear from native save/share/export

Severity: **P0**

Evidence:

- `src/App.tsx` permits Add child below record and move nodes.
- `src/App.tsx` routes board export and hosted cloud preparation through `exportNativeBoardRecord()`.
- `src/features/chess/chessRecord.ts::appendPgnChildren()` and `src/features/go/goRecord.ts::appendChildren()` filter for move children and silently ignore every ordinary child subtree.
- `docs/board-game-records-plan.md` says ordinary notes may coexist and should at least produce an export warning. No warning is implemented.

Impact:

A user can create a normal Mind Atlas note in the board workspace, see it persist locally, save/share the board notebook, and later load a PGN/SGF in which that note no longer exists. This defeats the product's main spatial-note value and is direct user-data loss.

Lowest-effort safe patch:

1. Add one iterative scan in `src/features/board/boardRecord.ts` that finds descendants not belonging to the active board record.
2. Call it centrally inside `exportNativeBoardRecord()` so export, cloud save, share, local bridge save, and future callers cannot bypass it.
3. If any unsupported node exists, reject before producing native text. The localized message must include the count and first node title.
4. Until a lossless private-extension design exists, disable Add child/Add sibling/drag-birth/Tab/Enter creation in board mode. Do not delete existing notes.
5. A later, separate design may encode Atlas-only branches in bounded private comments. Do not invent that format inside this safety patch.

Acceptance tests:

- an ordinary note under a move makes native export and cloud preparation fail without mutating the Atlas;
- the error names the unsupported-note count;
- title/body edits on record and move nodes still round-trip;
- a record containing only record/move nodes still exports unchanged.

### RG-002 — Multi-game PGN/SGF input is silently reduced to the first game

Severity: **P0**

Evidence:

- `src/features/chess/chessRecord.ts::importChessRecordText()` uses `parsePgn(text)[0]`.
- `src/features/go/goRecord.ts::importGoRecordText()` uses `sgf.parse(text)[0]`.
- Both PGN and SGF define files/collections containing more than one game.
- The canonical plan admits multi-game selection remains future work, but the UI does not reject or warn about it.

Lowest-effort safe patch:

1. Parse once and inspect the returned array length.
2. Accept exactly one game.
3. Reject zero games with the existing empty-record error.
4. Reject more than one with a localized message such as “This file contains 2 games. Multi-game selection is not supported yet; split the file or import one game.”
5. Do not reset the current workspace until this check passes.

Do not implement a selection dialog in this task. Atomic rejection removes the data-loss bug and keeps the change small.

Acceptance tests:

- two-game PGN and two-tree SGF are both rejected with the detected count;
- the existing workspace id and content are unchanged after rejection;
- a one-game fixture remains unchanged;
- cloud/load and merge entry points use the same check.

### RG-003 — Import has no byte/node/depth/comment bounds and conversion is recursive

Severity: **P0**

Evidence:

- both file adapters call `file.arrayBuffer()` without checking `file.size`;
- text/cloud/merge entry points have no equivalent UTF-8 byte check;
- chess `buildMoveChildren()` / `appendPgnChildren()` and Go `buildChildren()` / `appendChildren()` recurse once per record depth;
- the planned 8 MiB, 5,000-node, comment, and depth limits are not implemented;
- the planned 300-move and 1,000-node fixtures are absent.

Impact:

An untrusted local or hosted user can select a small but deeply nested record that overflows the JavaScript stack, or a large record that freezes the page before any user-visible error. This is a public reliability/denial-of-service problem, even though it is not a server-code-execution issue.

Lowest-effort safe patch:

1. Centralize limits in `src/features/board/boardRecord.ts`: 8 MiB source bytes, one game for now, 5,000 generated nodes, 10,000 characters per comment, and 100,000 comment characters per game.
2. Check `file.size` before `arrayBuffer()`. Check `TextEncoder().encode(text).byteLength` for text/cloud payloads.
3. Walk parsed trees iteratively before Atlas conversion and reject over node/comment limits.
4. While conversion remains recursive, use a conservative preflight depth limit (recommended 512). Do not claim a 5,000-depth limit until conversion/export are iterative.
5. Reject before `resetNotebook()` or any store mutation.

Acceptance tests:

- exact-limit inputs pass and one-over inputs fail;
- a depth-513 synthetic record fails with a controlled message, not `RangeError`;
- a 300-move main line and 1,000-node shallow tree complete within an agreed budget;
- all failures leave the existing workspace untouched.

## 6. Go findings

### GO-001 — A valid non-move SGF node truncates its entire following subtree

Severity: **P0**

Evidence:

`src/features/go/goRecord.ts::buildChildren()` creates an ordinary `Go note` when a child has no `B` or `W`, assigns `children: []`, and returns immediately. SGF explicitly permits comment, setup, markup, and game-info nodes between moves.

Lowest-effort safe patch:

1. Add a parsed-tree preflight.
2. Until setup/note nodes are modeled losslessly, reject any non-root node without `B` or `W` and list its property names and node index.
3. Do not return a plausible partial record.
4. In a later task, add a typed SGF setup/note node representation and export it symmetrically.

Acceptance tests:

- the reproduced comment-node SGF is rejected atomically or imports one preserved note plus `B[dd]`; zero moves after a successful import is forbidden;
- a comment attached to an ordinary move continues to round-trip;
- nested variations after a setup/note node cannot disappear.

### GO-002 — SGF setup semantics are silently lost

Severity: **P0**

Evidence:

- only root `AB` and `AW` are read;
- `AE` is ignored;
- compressed points such as `AB[aa:cc]` are passed to a two-character parser and discarded;
- setup properties on descendant nodes hit `GO-001` and truncate the subtree;
- `@sabaki/sgf` already exposes `parseCompressedVertices()`.

Lowest-effort safe patch:

1. First safety patch: reject `AE`, compressed setup values, and non-root setup nodes with a precise unsupported-feature error.
2. Separate completeness patch: expand compressed points with the Sabaki helper, apply `AB`, `AW`, then `AE` in setup nodes, carry `PL`, and serialize them back to SGF.
3. Add overlap/out-of-range validation and never silently drop a point.

Acceptance tests:

- `AB[aa:cc]` produces nine black setup stones or a clear atomic rejection;
- descendant `AE` changes the displayed board and survives export/re-import once completeness support is enabled;
- root handicap fixtures with `HA`, `AB`, and `PL[W]` choose the correct next player.

### GO-003 — SGF charset handling corrupts Japanese text and exports invalid charset semantics

Severity: **P0**

Evidence:

- `importGoRecordFile()` decodes all bytes as UTF-8 before parsing and ignores root `CA`;
- `readMetadata()` does not preserve `CA`;
- export writes UTF-8 bytes through the browser Blob path but does not emit `CA[UTF-8]`;
- SGF FF[4] defines `CA` and defaults to ISO-8859-1 when it is absent.

Lowest-effort safe patch:

1. Read raw bytes and inspect the ASCII-safe root preamble for `CA` before decoding text values.
2. Support at least `UTF-8`, `ISO-8859-1`, `Shift_JIS`, and `EUC-JP` through `TextDecoder` aliases available in target browsers. Reject an unsupported charset explicitly.
3. Always export `CA[UTF-8]` because Mind Atlas writes a UTF-8 Blob.
4. Preserve the source charset only as provenance; do not re-export non-UTF-8 bytes.

Acceptance tests:

- UTF-8, Shift_JIS, EUC-JP, and default-Latin1 fixtures preserve player names, game name, and comments;
- Japanese export contains `CA[UTF-8]` and reopens correctly in Mind Atlas and one independent SGF reader;
- invalid byte sequences fail visibly rather than becoming replacement characters.

### GO-004 — Import replay and new-move legality do not follow the stored rules

Severity: **P1**, but required before calling Go editing stable

Evidence:

- import rejects overwrite/suicide and calls `makeMove(...preventKo: true)`;
- SGF FF[4] says a reader should execute syntactically valid recorded moves even when they are illegal under normal play, with `KO` available as an annotation;
- editing always prohibits suicide and checks only immediate board repetition;
- `RU` is stored as text but never selects a rule adapter;
- AGA rules require same-position/same-player situational superko; New Zealand rules allow suicide; Japanese handling differs again;
- `boardFromGoContent()` reconstructs stones only, so the Sabaki board's transient ko state is not persisted.

Release-safe staged fix:

1. Separate **record replay** from **new move validation**. Import must reproduce the SGF path or reject the whole file with a precise unsupported-semantics error; it must not silently rewrite it.
2. For the first editable release, explicitly support one ruleset only (recommended product default: `RU[Japanese]`, no suicide, simple ko) and make other recognized `RU` values replay-only.
3. Set new games to explicit `CA[UTF-8]`, `RU[Japanese]`, `KM[6.5]`, and `PL[B]` rather than an unspecified ruleset.
4. In a later isolated task, implement history keys for AGA/NZ superko and ruleset-specific suicide/scoring behavior.

Acceptance tests:

- immediate simple-ko recapture remains blocked under Japanese rules;
- a legal ko recapture after an intervening move is allowed;
- an AGA long-cycle fixture is replayed but cannot accept a superko-illegal new move;
- an NZ suicide fixture is either supported correctly or clearly replay-only;
- the UI always displays the active ruleset and never labels an unchecked move “legal.”

### GO-005 — Format identity, metadata fidelity, and new-game semantics are incomplete

Severity: **P1**

Evidence:

- explicit non-Go `GM` values are accepted;
- `FF` is not validated;
- rectangular `SZ[x:y]` is silently treated as a square using only `x`;
- only `PB`, `PW`, `RE`, `DT`, `EV`, `RO`, `RU`, `KM`, `HA`, and `PL` are kept;
- common `GN`, ranks, place, time control, source, application, game comment, and charset fields are lost without warnings;
- new records have no visible metadata editor and no explicit rules/komi.

Lowest-effort safe patch:

1. Accept missing/default or `GM[1]`; reject explicit `GM` other than `1`.
2. Accept only the SGF versions and square sizes actually supported; reject rectangular sizes instead of changing them.
3. Preserve a bounded allowlist of common root/game-info properties, or return `sourceWarnings` listing every dropped property.
4. Add a compact read-only metadata summary before attempting a full editor.

Acceptance tests:

- `GM[3]` and rectangular `SZ` fail clearly;
- `GN`, `BR`, `WR`, `PC`, `TM`, `OT`, `SO`, `AP`, `GC`, and `RE` either round-trip or appear in an explicit warning;
- no metadata value can exceed the existing hosted bounds.

### GO-006 — Mobile evidence covers 9x9, not normal 19x19 input

Severity: **P1** for phone editing, **P2** for desktop/tablet replay

Evidence and inference:

- the mobile UI fixture is `SZ[9]` at 390x844;
- `.go-board-host` fits the board into roughly the phone panel width and gives every intersection one equal grid cell;
- a normal 19x19 board at that width yields approximately 18-pixel tap cells, with no board zoom, magnifier, coordinate gutter, or tap-confirmation aid;
- the current screenshot also wraps the Go label/ply text vertically in the crowded toolbar.

Lowest-effort safe patch:

1. Treat phone 19x19 as replay-only until there is a precision-input design, or add a two-step tap confirmation/magnifier.
2. Add visible coordinates and keep candidate/last-move markers distinguishable at 19x19.
3. Make toolbar label/ply a nonshrinking single-line unit or move `Pass` to a second compact row.

Acceptance tests:

- real 19x19 fixtures at 390x844 and 375x667;
- corner, edge, and adjacent-point tap accuracy with touch emulation;
- no vertical Japanese/English label wrapping;
- 9x9 and 13x13 remain visually unchanged.

## 7. Chess findings

### CH-001 — Non-standard chess variants can enter through PGN but the viewer/export path assumes standard Chess

Severity: **P1**

Evidence:

`chessops::startingPosition()` can return variant positions from PGN headers, but `ChessViewer.tsx::positionFromFen()` and `chessRecord.ts::positionFromFen()` always reconstruct `Chess`. A Lichess-style Atomic, Antichess, Horde, or other variant PGN can therefore import and then fail during view/export, instead of being rejected as unsupported.

Lowest-effort safe patch:

1. Inspect the normalized variant/rules result before Atlas conversion.
2. Accept standard chess only.
3. Reject every other variant with its detected name and leave the current workspace unchanged.
4. Add Chess960 only in a separate task after castling, FEN, UI, and export fixtures pass.

Acceptance tests:

- standard and custom-FEN standard games pass;
- Atomic, Antichess, Horde, Crazyhouse, and Chess960 each fail with an explicit unsupported-variant message for now;
- no unsupported file reaches React rendering.

### CH-002 — New PGN and game-state presentation are below stable record-client quality

Severity: **P1** for archival export, otherwise **P2**

Evidence:

- a new record initializes only `Event`;
- export therefore omits the PGN Seven Tag Roster fields `Site`, `Date`, `Round`, `White`, `Black`, and header `Result`;
- the board shows ply but not side to move, checkmate, stalemate, dead position, draw-claim state, or imported result;
- imported `Result` is preserved, but adding a continuation does not prompt about a now-stale result.

Lowest-effort safe patch:

1. Initialize the Seven Tag Roster with standard unknown values and `Result "*"`.
2. Show side to move and `check` / `checkmate` / `stalemate` / `draw` / imported result from `chessops` and headers.
3. Treat post-result continuations as study variations and do not silently rewrite the original result.

Acceptance tests:

- immediate new export is accepted by two independent PGN readers;
- Fool's Mate, stalemate, dead-position, threefold/50-move claim metadata, fivefold, and 75-move fixtures show the correct state;
- imported result survives an untouched round trip.

### CH-003 — Deepest-position merge ignores draw history and can splice stale FEN/ply metadata

Severity: **P1**

Evidence:

- chess merge identity uses only the first four FEN fields and drops halfmove/fullmove counters;
- repetition history is not in FEN at all;
- a cloned source subtree keeps the source nodes' stored `fen` and `ply` even when grafted at a destination occurrence reached through different history;
- the UI reads the stored cloned FEN, while PGN export replays UCI moves from the destination path. The displayed internal state and exported path can therefore disagree on counters/history.

Lowest-effort safe patch:

1. Change the default back to non-destructive `record-root` merge until history-aware grafting is complete.
2. Short-term: require exact six-field FEN and equal ply for deepest matching, and label the option as study-only because repetition history is still absent.
3. Complete fix: store a path repetition/history key, recompute cloned `fen`, SAN, and `ply` from the destination anchor, and validate the whole graft before committing.

Acceptance tests:

- same placement with different halfmove clocks does not merge in the short-term implementation;
- repetition fixtures do not inherit a result from the wrong history;
- every merged child FEN equals a fresh replay from the destination root;
- export/re-import canonical FEN and ply match every merged node.

## 8. Cross-cutting P2 quality gaps

### UI-001 — Board UI remains hardcoded and mixed-language

`ChessViewer.tsx`, `GoViewer.tsx`, and several import errors contain hardcoded Japanese or English strings recorded in `i18n/hardcoded-baseline.json`. Examples include `チェス`, `囲碁`, `開始局面`, `一手戻る`, `Pass`, and `ply`. Mind Atlas advertises multiple public locales, so an English or Arabic session can still receive Japanese board controls.

Fix after correctness blockers: move every visible string and accessible name into the existing message catalogue, test `en`, `ja`, one long Latin locale, and RTL, then remove only the corresponding baseline entries.

### TEST-001 — Existing tests are healthy but not a release corpus

Add independent fixtures for:

- collections and atomic rejection;
- ordinary Atlas-note save refusal;
- PGN custom FEN, en passant, nested RAV, result, mate/stalemate/draw, and unsupported variants;
- SGF `CA`, setup/comment nodes, `AE`, compressed points, handicap/`PL`, passes, explicit rulesets, invalid `GM`, and metadata warnings;
- 300-move and 1,000-node performance;
- 19x19 touch at target phone sizes;
- cloud save/load and public share round-trip for each supported bounded record.

## 9. Positive assessment

### Chess

The chess implementation is not a superficial board mock. It has a credible standard-chess core:

- `chessops` validates legal moves and supplies SAN/UCI/FEN;
- custom FEN plus en passant round-tripped in this audit;
- existing tests cover variations/comments, castling, promotion choice, click and drag input, candidate arrows, orientation, body editing, and mobile layout;
- the desktop and phone board is visually readable;
- invalid normal moves do not create nodes.

After the shared data-safety fixes, it is reasonable to ship this as **Standard Chess PGN beta: one game per file** while the P1 items are completed.

### Go

The board surface itself is better than the adapter underneath it:

- stones, grid termination, star points, last move, candidate points, pass, simple capture/ko, branch memory, and 9x9 layout work;
- move-node comments and ordinary move variations round-trip in the narrow supported subset;
- desktop contrast and layout are acceptable.

The adapter still implements a bounded subset of SGF, but unsupported input is
now rejected explicitly instead of being presented as a complete record. The
public boundary is therefore a bounded Go preview/editor, not a claim of full
SGF interoperability.

## 10. Low-effort implementation order and status

Each row is one agent task. Do not combine rows. A task may stop after its listed acceptance tests pass.

Implementation status: `RG-001` through `RG-003`, `GO-001` through `GO-004`,
`CH-001`, and the bounded portions of `GO-005` and `CH-002` are implemented in
the current tree. `CH-003` is handled by keeping the safer record-root merge in
the chess UI. The remaining rows are intentional follow-up work for stable,
unrestricted release rather than hidden behavior in the current beta.

| Order | Task id | Goal | Primary files |
| --- | --- | --- | --- |
| 1 | `RG-001` | Refuse any native save/share/export that would lose ordinary Atlas nodes; block new unsupported nodes in board mode. | `src/features/board/boardRecord.ts`, `src/App.tsx`, i18n, focused tests |
| 2 | `RG-002` | Reject multi-game PGN/SGF atomically with game count. | `chessRecord.ts`, `goRecord.ts`, record tests |
| 3 | `RG-003` | Add byte/node/comment/depth preflight limits before mutation. | `boardRecord.ts`, both adapters, record tests |
| 4 | `GO-001` | Reject non-move SGF nodes atomically; no partial tree. | `goRecord.ts`, `verify-go-record.ts` |
| 5 | `GO-002` | Reject, then separately support, setup-node/`AE`/compressed-point semantics. | `goRecord.ts`, Go types/sanitizers only when full support begins, tests |
| 6 | `GO-003` | Decode `CA` correctly and always export UTF-8 with `CA[UTF-8]`. | `goRecord.ts`, `boardRecord.ts` if byte routing changes, tests |
| 7 | `CH-001` | Fail closed for unsupported chess variants. | `chessRecord.ts`, chess tests |
| 8 | `GO-004` | Make ruleset explicit; first release edits Japanese rules only and makes others replay-only. | `goRecord.ts`, `GoViewer.tsx`, types/sanitizers, tests |
| 9 | `CH-003` | Make deepest merge history-safe or study-only with exact matching. | `boardRecordMerge.ts`, merge tests, dialog copy |
| 10 | `GO-005` / `CH-002` | Complete bounded metadata/defaults and state presentation. | game adapters/viewers, i18n, tests |
| 11 | `GO-006` / `UI-001` | 19x19 phone precision and localization/polish. | viewers, CSS, i18n, UI tests |

## 11. Required verification after implementation

Every individual task should run its focused test first. Before changing a release label, run the complete shared/public gate because these adapters feed local persistence, hosted cloud storage, and public sharing:

```text
npm run typecheck
npm run verify:chess
npm run verify:go
npm run verify:board-record-merge
npm run verify:ui
npm run build
npm run verify:hosted-service
npm run verify:hosted-public-ui
npm run build:hosted
npm run verify:hosted-dist
```

For board UI scopes, use at least `chess`, `chess-special`, `go`, `go-ko`, `mobile-chess`, `mobile-go`, `light-contrast`, and the new 19x19 scope. Passing tests are necessary but the release decision also requires reviewing one generated desktop and mobile screenshot per game.

## 12. Canonical references used

- SGF FF[4] collection/tree grammar and property model: <https://www.red-bean.com/sgf/sgf4.html>
- SGF FF[4] move, setup, charset, result, and rules properties: <https://www.red-bean.com/sgf/properties.html>
- Sabaki SGF parser collection and encoding APIs: <https://github.com/SabakiHQ/sgf>
- AGA summary including situational superko: <https://www.usgo.org/content.aspx?club_id=454497&module_id=563542&page_id=22>
- New Zealand Go Society rules, including self-capture and whole-board repetition: <https://go.org.nz/index.php/about-go/new-zealand-rules-of-go>
- FIDE Laws of Chess: <https://rcc.fide.com/fide-laws-of-chess_fulltexthtml/>
- PGN specification, including sequential game collections, RAV, FEN, and tag rules: <https://www.saremba.de/chessgml/standards/pgn/pgn-complete.htm>

## 13. Final sign-off rule

- **Chess beta go:** `RG-001` through `RG-003` fixed; standard chess only; one game per PGN is enforced; limitations are visible. This implementation gate is now met, subject to the full verification list.
- **Chess stable go:** beta gate plus `CH-001` through `CH-003`, archival metadata/state fixtures, localization, cloud/share, and large-record evidence.
- **Go beta go:** all shared P0 items plus `GO-001` through `GO-004`; unsupported SGF semantics reject atomically; one explicit editable ruleset; 19x19 is replay-only on phones unless precision input passes. This bounded implementation gate is now met, subject to the full verification list.
- **Go stable go:** beta gate plus `GO-005`, `GO-006`, full declared-rules validation, bounded metadata warnings/preservation, localization, cloud/share, and large-record evidence.

Until those gates are met, the honest public wording is “limited record preview/beta,” not “PGN/SGF import, legal editing, and lossless Mind Atlas persistence.”
