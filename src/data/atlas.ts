import type { Artifact, AtlasEvent, AtlasNode, NotebookNodeType, ResonanceLink, WorkArea } from "../types";

const SEED_CREATED_AT = "2026-04-26T00:00:00.000Z";

export const initialWorkAreas: WorkArea[] = [
  {
    id: "deck-revision",
    title: "Investor Deck",
    subtitle: "PowerPoint narrative revision",
    status: "waiting",
    color: "#f0b44c",
    position: [-190, 95, 6],
    radius: 28,
    summary:
      "Claude rewrote the deck narrative around the new AI operations story. The title slide and problem framing are ready for review.",
    nextDecision: "Check whether the opening message is sharp enough for a non-technical audience.",
    events: [
      {
        id: "deck-e1",
        type: "message",
        actor: "human",
        content: "Tighten the deck around the pain of AI multitasking and make slide 1 less generic.",
        createdAt: "08:22",
        labels: ["prompt", "deck"],
      },
      {
        id: "deck-e2",
        type: "artifact_update",
        actor: "ai",
        content: "Updated the opener, problem slide, and transition into the product concept.",
        createdAt: "08:41",
        modelId: "Claude Code",
      },
      {
        id: "deck-e3",
        type: "status_change",
        actor: "system",
        content: "Waiting for human review of the first five slides.",
        createdAt: "08:42",
      },
    ],
    artifacts: [
      {
        id: "deck-a1",
        title: "mind-atlas-deck-v03.pptx",
        type: "pptx",
        status: "waiting",
        summary: "Revised first five slides with a sharper story arc.",
        preview: ["Slide 1: AI work is scattered", "Slide 2: Context recovery is the hidden cost", "Slide 3: Mind Atlas as spatial re-entry"],
      },
    ],
  },
  {
    id: "python-ui",
    title: "Python App UX",
    subtitle: "Settings screen cleanup",
    status: "needs_review",
    color: "#69d6a4",
    position: [165, 42, 10],
    radius: 34,
    summary:
      "Codex rebuilt the settings layout and generated a runnable preview. The save/cancel area still needs visual inspection.",
    nextDecision: "Launch the preview and decide whether the button spacing is acceptable.",
    events: [
      {
        id: "py-e1",
        type: "message",
        actor: "human",
        content: "Improve the settings screen so the save action is easier to find and the layout feels less cramped.",
        createdAt: "08:10",
        labels: ["prompt", "ux"],
      },
      {
        id: "py-e2",
        type: "tool_call",
        actor: "ai",
        content: "Ran UI layout changes and rebuilt the local preview.",
        createdAt: "08:27",
        modelId: "Codex",
      },
      {
        id: "py-e3",
        type: "artifact_create",
        actor: "tool",
        content: "Created runnable preview build and screenshot for review.",
        createdAt: "08:31",
      },
      {
        id: "py-e4",
        type: "status_change",
        actor: "system",
        content: "Needs human review before the next instruction.",
        createdAt: "08:32",
      },
    ],
    artifacts: [
      {
        id: "py-a1",
        title: "settings-preview.exe",
        type: "app",
        status: "needs_review",
        summary: "Runnable UI preview for the revised settings screen.",
        preview: ["Header is clearer", "Form groups are aligned", "Save button may be too far right"],
      },
      {
        id: "py-a2",
        title: "settings-screen.png",
        type: "image",
        status: "needs_review",
        summary: "Screenshot generated after the local rebuild.",
        preview: ["Canvas: 1440 x 920", "Focus: bottom action row", "Risk: uneven horizontal spacing"],
      },
    ],
  },
  {
    id: "article-draft",
    title: "Article Draft",
    subtitle: "Research notes to long-form essay",
    status: "running",
    color: "#d978a8",
    position: [-92, -128, 4],
    radius: 30,
    summary:
      "A browser AI session is turning research notes into a draft about AI workspaces. The introduction is still weak.",
    nextDecision: "Decide whether the article should open with multitasking pain or the 2.5D atlas metaphor.",
    events: [
      {
        id: "article-e1",
        type: "message",
        actor: "human",
        content: "Use these research notes to draft an article about why AI work needs spatial context.",
        createdAt: "07:58",
      },
      {
        id: "article-e2",
        type: "tool_result",
        actor: "tool",
        content: "Imported three note files and extracted repeated phrases about context switching.",
        createdAt: "08:08",
      },
      {
        id: "article-e3",
        type: "artifact_create",
        actor: "ai",
        content: "Generated a first article draft with a weak opening and strong middle section.",
        createdAt: "08:38",
        modelId: "Gemini",
      },
    ],
    artifacts: [
      {
        id: "article-a1",
        title: "spatial-ai-work.md",
        type: "text",
        status: "running",
        summary: "First draft of the article.",
        preview: ["AI did not remove work.", "It multiplied unfinished contexts.", "The next interface must make those contexts visible."],
      },
      {
        id: "article-a2",
        title: "research-notes.pdf",
        type: "pdf",
        status: "done",
        summary: "Source notes used by both the article and deck.",
        preview: ["Context switching", "Artifact review cost", "Spatial memory as interface"],
      },
    ],
  },
  {
    id: "local-llm",
    title: "Local Voice Lab",
    subtitle: "Ollama and Open WebUI notes",
    status: "blocked",
    color: "#8bb9ff",
    position: [245, -120, 2],
    radius: 24,
    summary:
      "Local voice input options were compared. The UI can reference Open WebUI patterns, but the core product should stay independent.",
    nextDecision: "Choose whether voice is part of the next prototype or remains a later adapter.",
    events: [
      {
        id: "llm-e1",
        type: "message",
        actor: "human",
        content: "Find the local LLM chat interface that handles Ollama, LM Studio, and voice input.",
        createdAt: "08:47",
      },
      {
        id: "llm-e2",
        type: "message",
        actor: "ai",
        content: "Open WebUI is the closest reference, but its license makes direct product reuse risky.",
        createdAt: "08:50",
      },
      {
        id: "llm-e3",
        type: "status_change",
        actor: "system",
        content: "Blocked until the core spatial PoC is working.",
        createdAt: "08:51",
      },
    ],
    artifacts: [
      {
        id: "llm-a1",
        title: "voice-stack-notes.txt",
        type: "text",
        status: "blocked",
        summary: "Notes on local STT, TTS, Ollama, LM Studio, and Open WebUI.",
        preview: ["Open WebUI: good reference", "Ollama: local model runtime", "Voice: defer until spatial loop works"],
      },
    ],
  },
];

export const resonanceLinks: ResonanceLink[] = [
  {
    id: "deck-article-research",
    sourceId: "deck-revision",
    targetId: "article-draft",
    label: "shared research message",
    strength: 0.82,
    color: "#8ff5cf",
  },
  {
    id: "python-local-review",
    sourceId: "python-ui",
    targetId: "local-llm",
    label: "artifact review loop",
    strength: 0.56,
    color: "#d7cb74",
  },
];

function tagsFromText(...parts: string[]) {
  const tags = new Set<string>();
  for (const part of parts) {
    const matches = part.match(/#[\p{L}\p{N}_-]+/gu) ?? [];
    for (const match of matches) tags.add(match.slice(1).toLowerCase());
  }
  return Array.from(tags);
}

function baseNodeFields({
  nodeType,
  body,
  author = "human",
  tags = [],
}: {
  nodeType: NotebookNodeType;
  body: string;
  author?: AtlasNode["author"];
  tags?: string[];
}) {
  return {
    nodeType,
    body,
    author,
    tags: Array.from(new Set([...tags, ...tagsFromText(body)])),
    attachments: [],
    createdAt: SEED_CREATED_AT,
    updatedAt: SEED_CREATED_AT,
  };
}

function artifactToNode(area: WorkArea, artifact: Artifact): AtlasNode {
  const body = `${artifact.summary}\n\n${artifact.preview.join("\n")}`;
  return {
    id: artifact.id,
    kind: "artifact",
    ...baseNodeFields({
      nodeType: "file_context",
      body,
      author: "human",
      tags: [artifact.type, area.id],
    }),
    title: artifact.title,
    subtitle: artifact.type,
    status: artifact.status,
    color: "#8df5cf",
    radius: 5.6,
    summary: artifact.summary,
    nextDecision: artifact.preview[0] ?? "Inspect the next useful breakdown from this artifact.",
    sourceParentId: area.id,
    sourceId: artifact.id,
    children: artifact.preview.map((line, index) => conceptToNode(artifact.id, line, index, artifact.status)),
  };
}

function eventToNode(area: WorkArea, event: AtlasEvent): AtlasNode {
  return {
    id: event.id,
    kind: "event",
    ...baseNodeFields({
      nodeType:
        event.type === "tool_call"
          ? "tool_call"
          : event.type === "tool_result"
            ? "tool_result"
            : event.actor === "ai"
              ? "ai_reply"
              : "human_prompt",
      body: event.content,
      author: event.actor,
      tags: event.labels ?? [],
    }),
    title: event.type,
    subtitle: event.actor,
    status: area.status,
    color: "#d7ead9",
    radius: 3.8,
    summary: event.content,
    nextDecision: event.labels?.[0] ?? event.modelId ?? "Use this event as a local thread anchor.",
    sourceParentId: area.id,
    sourceId: event.id,
    children: eventChildren(event, area.status),
  };
}

function conceptToNode(parentId: string, line: string, index: number, status: WorkArea["status"]): AtlasNode {
  const words = line
    .split(/\s+/)
    .map((word) => word.replace(/[^a-zA-Z0-9_-]/g, ""))
    .filter(Boolean)
    .slice(0, 4);

  return {
    id: `${parentId}-concept-${index}`,
    kind: "concept",
    ...baseNodeFields({
      nodeType: "note",
      body: line,
      tags: tagsFromText(line),
    }),
    title: line,
    subtitle: "concept",
    status,
    color: "#f5df80",
    radius: 2.1,
    summary: `A smaller concept extracted from ${parentId}.`,
    nextDecision: "Zoom further to split this concept into local terms.",
    sourceParentId: parentId,
    children: words.map((word, wordIndex) => ({
      id: `${parentId}-concept-${index}-term-${wordIndex}`,
      kind: "thread",
      ...baseNodeFields({
        nodeType: "note",
        body: `Thread-level handle for "${word}".`,
        tags: [word.toLowerCase()],
      }),
      title: word,
      subtitle: "thread",
      status,
      color: "#b9c8ff",
      radius: 1.15,
      summary: `Thread-level handle for "${word}".`,
      nextDecision: "Attach notes or outputs here when this thread becomes active.",
      sourceParentId: `${parentId}-concept-${index}`,
      children: [],
    })),
  };
}

function eventChildren(event: AtlasEvent, status: WorkArea["status"]): AtlasNode[] {
  const labels = event.labels?.length ? event.labels : [event.actor, event.type];
  return labels.map((label, index) => ({
    id: `${event.id}-thread-${index}`,
    kind: "thread",
    ...baseNodeFields({
      nodeType: "note",
      body: `A thread marker derived from the ${event.type} event.`,
      tags: [label],
    }),
    title: label,
    subtitle: "event thread",
    status,
    color: "#b9c8ff",
    radius: 1.5,
    summary: `A thread marker derived from the ${event.type} event.`,
    nextDecision: "Use this thread as a local follow-up target.",
    sourceParentId: event.id,
    children: [],
  }));
}

export const atlasRoot: AtlasNode = {
  id: "atlas-root",
  kind: "root",
  ...baseNodeFields({
    nodeType: "note",
    body: "The root of this local notebook.",
    tags: ["root"],
  }),
  title: "AI Work Space",
  subtitle: "Mind Atlas",
  status: "running",
  color: "#8df5cf",
  radius: 80,
  summary: "The complete spatial workspace.",
  nextDecision: "Choose a work area and zoom into its local structure.",
  position: [0, 0, 0],
  children: initialWorkAreas.map((area) => ({
    id: area.id,
    kind: "workArea",
    ...baseNodeFields({
      nodeType: "human_prompt",
      body: `${area.summary}\n\nNext decision: ${area.nextDecision}`,
      tags: [area.status, area.id],
    }),
    title: area.title,
    subtitle: area.subtitle,
    status: area.status,
    color: area.color,
    radius: area.radius,
    summary: area.summary,
    nextDecision: area.nextDecision,
    position: area.position,
    sourceId: area.id,
    children: [
      ...area.artifacts.map((artifact) => artifactToNode(area, artifact)),
      ...area.events.slice(-4).map((event) => eventToNode(area, event)),
    ],
  })),
};
