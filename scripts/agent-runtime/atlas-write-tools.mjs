// Mind Atlas write tools for agent runs.
//
// Mode: local-only.
//
// An agent records its work in the owner's notebook with these. The tool call
// does not change anything itself: it queues an operation at the bridge
// (`atlas-link.mjs`), and the browser that has Mind Atlas open applies it with
// its own store, so undo and history keep working. The owner decided that
// agents need no approval for any of these, deletes and moves included
// (OpenCEO ADR 0059); every write is logged in the AI Partner log and can be
// undone in Mind Atlas.

const STATUSES = ["running", "needs_review", "waiting", "blocked", "error", "done"];

const nodeDraft = {
  type: "object",
  properties: {
    title: { type: "string" },
    body: { type: "string", description: "Markdown. What was found, decided or done." },
    summary: { type: "string" },
  },
  required: ["body"],
};

export const ATLAS_WRITE_TOOL_DEFINITIONS = [
  {
    name: "add_child_nodes",
    description:
      "Add one or more cards under an existing card. Use this to record what you found, decided or did, under the project card it belongs to. Take parentId from search_nodes or get_atlas_outline.",
    inputSchema: {
      type: "object",
      properties: {
        parentId: { type: "string", description: "The card to add under." },
        nodes: { type: "array", minItems: 1, maxItems: 50, items: nodeDraft },
      },
      required: ["parentId", "nodes"],
    },
  },
  {
    name: "update_node_text",
    description: "Change a card's title, body, summary, next decision or tags. Fields left out stay as they are.",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
        summary: { type: "string" },
        nextDecision: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["nodeId"],
    },
  },
  {
    name: "set_node_status",
    description: "Set a card's status, for example running while you work on it and needs_review or done when you finish.",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string" },
        status: { type: "string", enum: STATUSES },
        nextDecision: { type: "string" },
      },
      required: ["nodeId", "status"],
    },
  },
  {
    name: "delete_node",
    description: "Delete a card and everything under it. The notebook root cannot be deleted.",
    inputSchema: {
      type: "object",
      properties: { nodeId: { type: "string" }, reason: { type: "string" } },
      required: ["nodeId"],
    },
  },
  {
    name: "move_nodes",
    description: "Move cards, with everything under them, to new parent cards. Use this to file or reorganise existing cards instead of copying and deleting them.",
    inputSchema: {
      type: "object",
      properties: {
        moves: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: {
            type: "object",
            properties: {
              node_id: { type: "string" },
              parent_id: { type: "string" },
              index: { type: "number", description: "Position among the new parent's children (0 = first). Default: last." },
            },
            required: ["node_id", "parent_id"],
          },
        },
      },
      required: ["moves"],
    },
  },
  {
    name: "bulk_update_nodes",
    description: "Change text or status on several cards at once.",
    inputSchema: {
      type: "object",
      properties: {
        updates: {
          type: "array",
          minItems: 1,
          maxItems: 50,
          items: {
            type: "object",
            properties: {
              nodeId: { type: "string" },
              title: { type: "string" },
              body: { type: "string" },
              summary: { type: "string" },
              nextDecision: { type: "string" },
              tags: { type: "array", items: { type: "string" } },
              status: { type: "string", enum: STATUSES },
            },
            required: ["nodeId"],
          },
        },
      },
      required: ["updates"],
    },
  },
];

export const ATLAS_WRITE_TOOL_NAMES = ATLAS_WRITE_TOOL_DEFINITIONS.map((tool) => tool.name);

/** What an agent is told about one queued write, from the bridge's answer. */
export function describeWrite(answer) {
  const op = answer?.op;
  if (!op) return { isError: true, content: "Mind Atlas did not accept the write." };
  if (op.status === "done") {
    return { content: { applied: true, message: op.result?.text ?? "Applied.", ...(op.result?.data ? { data: op.result.data } : {}) } };
  }
  if (op.status === "failed") {
    return { isError: true, content: `Mind Atlas could not apply it: ${op.result?.text ?? "unknown reason"}` };
  }
  return {
    content: {
      applied: false,
      queued: true,
      operationId: op.id,
      message: answer?.browserOnline
        ? "Queued. Mind Atlas is open but has not applied it yet; it will shortly."
        : "Queued. Mind Atlas is not open in a browser right now; it will be applied when the owner opens it. Ids of new cards are not known until then.",
    },
  };
}
