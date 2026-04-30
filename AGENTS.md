# Mind Atlas - Agent Instructions

## Project Identity

Mind Atlas is not a generic AI dashboard, task manager, or chat aggregator.

Mind Atlas is a 2.5D spatial interface for navigating AI-era multitasking. Its core promise is to help a human understand, inspect, and re-enter many parallel AI-assisted work streams without constantly rebuilding context in their head.

The product thesis:

> Convert fragmented AI sessions, artifacts, tools, and project states into a navigable semantic space where the user can zoom, pan, inspect, and intervene.

The first goal is not broad integration. The first goal is to make the user feel:

> "I can navigate my AI work instead of switching between scattered apps, tabs, files, and chats."

## Non-Negotiable Concept

The winning differentiation is the 2.5D cosmic UI.

Do not reduce this project into a conventional dashboard unless explicitly asked. A dashboard/list can support the experience, but it must not become the main product metaphor.

Preserve these principles:

- The main surface is a 2.5D semantic space.
- Orientation is fixed. No free camera rotation.
- Navigation is by pan, zoom, click/tap, hover, and later voice.
- Context is spatially arranged and remembered by position.
- Multiple projects/sessions are handled by navigation, not by tab switching.
- The user can inspect artifacts and send follow-up prompts from the same spatial context.
- The UI should feel like a thought atlas, not an admin console.

## Core User Pain

People who seriously use AI agents are overwhelmed by multitasking:

- Claude Code, Codex, Cline, browser AI tools, local LLMs, and other agents run in parallel.
- Outputs are scattered across text, PDFs, PowerPoint, Excel, code, browser pages, CLI logs, executable apps, screenshots, and generated files.
- The human must repeatedly remember: What was this project? What did I ask? What did the AI change? What needs review?
- The hardest part is often not generation, but verification, context recovery, and re-instruction.
- Developers also need to deploy, run, test, inspect UX, understand code changes, and feed observations back to agents.

Mind Atlas exists to reduce this cost.

## Product Definition

Mind Atlas is:

- A 2.5D AI work-space for parallel projects.
- A semantic navigation UI for prompts, responses, tool events, artifacts, and project state.
- A way to inspect AI-created work and immediately re-prompt in context.
- A foundation for discovering repeated patterns that can later become reusable skills.

Mind Atlas is not:

- A normal kanban board.
- A normal mind map.
- A normal chat app.
- A normal file browser.
- A pure knowledge graph viewer.
- A generic wrapper around multiple AI vendors.

## MVP Experience

The MVP must demonstrate this loop:

1. The user opens a 2.5D space containing several active work areas.
2. Important or unresolved areas are visually obvious through state, glow, pulse, or motion.
3. The user pans/zooms into one work area.
4. The user quickly recovers what the AI was doing.
5. The user previews or opens the relevant artifact.
6. The user sends a follow-up instruction from that exact context.
7. The work area changes state, and the user can zoom out and move elsewhere.

This must feel like spatial navigation, not clicking through a list.

## First Demo Scenario

Use this scenario as the seed demo if no better real data exists:

- Work area A: PowerPoint deck revision.
- Work area B: Python app UI improvement.
- Work area C: Research notes to article draft.

Expected flow:

- The wide view shows all three work areas.
- One area is marked "needs review."
- The user zooms into it.
- Nearby events show the prompt, AI result, generated artifact, and status.
- The user previews the artifact.
- The user enters a new text prompt, with future support for voice input.
- The selected area becomes "running" or "awaiting result."
- The user zooms out and sees a relation or resonance between two other work areas.

## Required Initial UI Elements

Keep the first screen focused. The minimum useful layout has seven elements:

1. Universe View
   - Main 2.5D fixed-orientation space.
   - Supports pan, zoom, select, and hover.

2. Focus Panel
   - Shows selected work area/node details.
   - Include title, current state, short context summary, recent artifacts, and next decision.

3. State Visualization Layer
   - Must make states visible without reading a table.
   - Initial states: running, needs_review, waiting, blocked, error, done.

4. Artifact Preview Area
   - Shows lightweight previews or launch/open actions.
   - Start with text/markdown/image/mock previews if needed.

5. Re-Instruction Input
   - Text input first.
   - Voice input later.
   - Must clearly target the currently focused context.

6. Minimap
   - Shows current viewport, pinned areas, and important unresolved areas.

7. Recent Event Strip
   - Shows the latest relevant events for the focused work area.

## Data Philosophy

The raw history is a primary asset. Do not discard or overwrite it with summaries.

The lowest layer is an append-only event stream. Summaries, tags, embeddings, clusters, and spatial layout are derived layers.

The minimal unit is not a human/AI turn pair. Real AI work includes:

- Human messages.
- AI messages.
- Tool calls.
- Tool results.
- Web searches.
- File creation.
- File updates.
- Artifact generation.
- Status changes.
- Branching.
- Reuse across contexts.

Use events as the base unit.

## Initial Event Model

Start simple and extend only when needed.

```ts
export type EventType =
  | "message"
  | "tool_call"
  | "tool_result"
  | "artifact_create"
  | "artifact_update"
  | "status_change"
  | "branch_create"
  | "link_attach";

export type EventActor = "human" | "ai" | "tool" | "system";

export interface EventNode {
  id: string;
  type: EventType;
  actor: EventActor;
  content: string;
  createdAt: string;
  sessionId?: string;
  branchId?: string;
  causeIds?: string[];
  refIds?: string[];
  artifactIds?: string[];
  modelId?: string;
  labels?: string[];
}
```

Rules:

- Preserve raw `content`.
- Store summaries separately.
- Store spatial layout separately.
- Store semantic links separately.
- Do not make vendor-specific model behavior the core data structure.

## Spatial Model

The UI may look cosmic, but the metaphor must carry meaning:

- Galaxy/work area: a large project or theme.
- Star system: a project sub-area or active session.
- Planet/satellite: event cluster, artifact, branch, or review target.
- Orbit/path: temporal or causal flow.
- Resonance line: semantic overlap, shared artifact, repeated workflow, or reusable skill candidate.

Use 2.5D:

- X/Y positions express stable spatial memory.
- Depth/scale can express hierarchy, activity, recency, or semantic drill-down.
- Camera rotation is forbidden unless the user explicitly changes this direction later.
- Zoom should change semantic detail, not only pixel size.

## Context And Graph Thinking

Use both tree-like and graph-like structures, but for different jobs:

- Tree/branch structure is for following execution, session flow, and local alternatives.
- Graph/resonance structure is for discovering overlap between different work areas.

Important idea:

> Trees are for execution. Graphs are for discovery.

Do not force all contexts under a single root node. Different contexts can later become related through shared artifacts, concepts, people, files, constraints, workflows, or repeated prompt patterns.

Represent those overlaps as links or shared nodes, not as forced parent/child relationships.

## Skills Concept

Skills are not only manually authored procedures.

In Mind Atlas, a skill can emerge from repeated work patterns across sessions:

- Summarize long document -> extract issues -> draft revision.
- Read code -> propose patch -> run tests -> revise.
- Extract PDF/image data -> normalize -> create table.
- Research -> compare options -> recommend decision.
- Generate artifact -> inspect result -> feed back corrections.

Eventually, the UI should help reveal "we keep doing this same operation" and allow that pattern to become reusable.

This is later-stage behavior. Do not block the MVP on it.

## Integrations

Treat integrations as adapters around the core spatial/event model.

Potential future integrations:

- Claude Code / Claude remote control / Claude channels.
- OpenAI Codex / Codex CLI / Codex app.
- VS Code Cline.
- Browser AI services.
- Ollama.
- LM Studio.
- Open WebUI as a reference for local LLM chat, voice, and OpenAI-compatible APIs.
- CUA or similar computer-use harnesses for PC interaction.

Do not make any one vendor or tool the center of the architecture.

If current external API behavior matters, verify current official docs before implementing. Do not rely on stale assumptions.

## PC Operation Layer

The long-term project may use a computer-use layer such as CUA or another harness.

This layer should be treated as "hands and eyes":

- Screenshot / screen state.
- Click.
- Type.
- Focus window.
- Launch app.
- Inspect or open artifacts.

It is not the identity of the product. The identity remains the 2.5D context/navigation UI.

## Voice

Voice is important but not first-principles for the initial UI prototype.

Initial implementation can use text re-instruction.

Design the input area so voice can later become another input method targeting the same focused context.

Future voice loop:

- Speech-to-text.
- Attach transcript to focused context.
- Send prompt to selected AI/agent adapter.
- Read response with text-to-speech when useful.

## Implementation Priorities

If the repository is empty, start with the smallest working app that proves the spatial experience.

Recommended first build order:

1. Create a front-end prototype with seeded demo data.
2. Render the 2.5D universe view with pan and zoom.
3. Render work areas, event clusters, artifacts, states, and resonance hints.
4. Implement selection and focus panel.
5. Implement recent event strip.
6. Implement artifact preview mocks.
7. Implement re-instruction input that appends a new event to the selected context.
8. Persist seeded/local event data.
9. Add real adapters only after the navigation loop feels right.

## Design Constraints

- The universe view is the main screen, not a decorative hero.
- Avoid generic SaaS dashboard composition as the primary experience.
- Avoid overloading the first screen with controls.
- Use motion/state carefully to guide attention.
- Keep text readable and panels compact.
- Do not use free-flying 3D camera controls.
- Do not make the cosmic metaphor merely ornamental.
- Prefer semantic zoom over flat scaling.
- The user must always know where they are.

## First Success Criteria

The first prototype is successful if a user can:

- See several AI work areas at once.
- Identify which one needs attention.
- Navigate to it by pan/zoom.
- Understand what happened there without rereading an entire chat.
- Preview or open the relevant artifact.
- Send a follow-up instruction in context.
- Return to the wider map without feeling lost.

## One-Sentence Summary

Mind Atlas turns fragmented AI multitasking into a navigable 2.5D semantic space where humans can recover context, inspect artifacts, and re-enter work at the exact point where judgment is needed.

## Notebook MVP Requirements

The next phase turns the PoC into a local tree-structured notebook.

Scope for the first notebook MVP:

- Create, edit, and save a tree of notebook nodes.
- Treat one celestial object as one notebook/chat-bubble unit.
- A node represents one human prompt-like message first; later the same unit can represent an AI reply, tool call, tool result, or AI execution step.
- AI execution is out of scope for this phase. All content is created by human input.
- Edit the focused node inside the Focus panel.
- Use plain chat-like text editing, not rich text.
- Support mouse-first operations for adding child nodes and sibling branch nodes.
- Store branches as sibling nodes under the same parent.
- Store shared concepts as `#tags` extracted from node text/title/tags.
- Draw resonance links between nodes that share the same tag.
- Attach images, audio, and video to a node as attachments, not as separate celestial objects.
- Store attachment metadata/path only. Do not export file blobs in the JSON MVP.
- Preview attached image/audio/video files in the Focus panel when the browser has a selected local file object for the current session.
- Save and load the notebook as a single JSON file.
- Keep the current 2.5D fixed-orientation universe as the primary interface.
- Preserve the PoC interaction baseline: pan, zoom, focus, semantic drill-down, mobile layout, and background-star behavior.

Implementation task group:

1. Harden the PoC baseline:
   - Keep build and UI verification passing.
   - Keep `scripts/verify-ui.mjs` as a smoke test for desktop, mobile portrait, and mobile landscape.
   - Avoid unrelated visual rewrites while adding notebook behavior.

2. Evolve the data model:
   - Extend `AtlasNode` with editable notebook fields: `body`, `author`, `nodeType`, `createdAt`, `updatedAt`, `tags`, and `attachments`.
   - Keep `children` as the tree structure.
   - Treat sibling children under the same parent as branches.

3. Editing workflow:
   - Focus panel edits selected node title/body/tags.
   - Add child creates a deeper node.
   - Add sibling branch creates a node under the same parent.
   - Selecting a node focuses the camera and reveals its local children according to semantic zoom.

4. Persistence:
   - Save current notebook into local browser storage.
   - Export current notebook as a single JSON file.
   - Import a JSON notebook file and replace the current notebook.
   - Attachment file objects are not exported; only metadata/path-like names are preserved.

5. Attachments:
   - Allow image/audio/video file selection from the browser.
   - Add attachment metadata to the current node.
   - Preview selected files in the Focus panel when object URLs are available.
   - Gracefully show metadata-only attachments after reload/import.

6. Tags and resonance:
   - Extract `#tags` from title/body/manual tag field.
   - Store normalized tags on each node.
   - Render resonance links for nodes sharing tags.
   - Keep tag links visually secondary to parent-child/orbit structure.

7. Future placeholders:
   - Keep the node model ready for AI replies, tool calls, and tool results as independent node types.
   - Defer AI context packing, summarization, embeddings, sync, and real adapter integration.
