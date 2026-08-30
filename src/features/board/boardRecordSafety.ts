import type { AtlasNode } from "../../types";

export type BoardRecordSafetyMode = "shogi" | "chess" | "go";

export const BOARD_RECORD_LIMITS = {
  maxSourceBytes: 8 * 1024 * 1024,
  maxNodes: 5_000,
  maxCommentChars: 10_000,
  maxTotalCommentChars: 100_000,
  maxDepth: 512,
} as const;

export function assertBoardRecordTextWithinLimits(text: string, format: string) {
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > BOARD_RECORD_LIMITS.maxSourceBytes) {
    throw new Error(`${format} record exceeds the ${formatBytes(BOARD_RECORD_LIMITS.maxSourceBytes)} source limit.`);
  }
}

export function assertBoardRecordFileWithinLimits(file: File, format: string) {
  if (file.size > BOARD_RECORD_LIMITS.maxSourceBytes) {
    throw new Error(`${format} file exceeds the ${formatBytes(BOARD_RECORD_LIMITS.maxSourceBytes)} source limit.`);
  }
}

export function decodeUtf8BoardRecord(bytes: Uint8Array, format: string) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    throw new Error(`${format} record is not valid UTF-8.`);
  }
}

export function assertParsedRecordTreeWithinLimits<T>(
  roots: readonly T[],
  options: {
    format: string;
    getChildren: (node: T) => readonly T[];
    getCommentText: (node: T) => string;
  },
) {
  const stack = roots.map((node) => ({ node, depth: 0 }));
  let nodeCount = 0;
  let totalCommentChars = 0;
  while (stack.length) {
    const current = stack.pop();
    if (!current) break;
    nodeCount += 1;
    if (nodeCount > BOARD_RECORD_LIMITS.maxNodes) {
      throw new Error(`${options.format} record exceeds the ${BOARD_RECORD_LIMITS.maxNodes.toLocaleString()} node limit.`);
    }
    if (current.depth > BOARD_RECORD_LIMITS.maxDepth) {
      throw new Error(`${options.format} record exceeds the maximum depth of ${BOARD_RECORD_LIMITS.maxDepth}.`);
    }
    const commentChars = options.getCommentText(current.node).length;
    if (commentChars > BOARD_RECORD_LIMITS.maxCommentChars) {
      throw new Error(`${options.format} record contains a comment longer than ${BOARD_RECORD_LIMITS.maxCommentChars.toLocaleString()} characters.`);
    }
    totalCommentChars += commentChars;
    if (totalCommentChars > BOARD_RECORD_LIMITS.maxTotalCommentChars) {
      throw new Error(`${options.format} record exceeds the ${BOARD_RECORD_LIMITS.maxTotalCommentChars.toLocaleString()} total comment-character limit.`);
    }
    const children = options.getChildren(current.node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: children[index], depth: current.depth + 1 });
    }
  }
}

export function assertBoardRecordExportable(root: AtlasNode, mode: BoardRecordSafetyMode) {
  const recordRoot = findRecordRoot(root, mode);
  if (!recordRoot) return;

  const stack = [{ node: recordRoot, depth: 0 }];
  const unsupported: AtlasNode[] = [];
  let nodeCount = 0;
  let totalCommentChars = 0;
  while (stack.length) {
    const current = stack.pop();
    if (!current) break;
    nodeCount += 1;
    if (nodeCount > BOARD_RECORD_LIMITS.maxNodes) {
      throw new Error(`${modeLabel(mode)} record exceeds the ${BOARD_RECORD_LIMITS.maxNodes.toLocaleString()} node limit.`);
    }
    if (current.depth > BOARD_RECORD_LIMITS.maxDepth) {
      throw new Error(`${modeLabel(mode)} record exceeds the maximum depth of ${BOARD_RECORD_LIMITS.maxDepth}.`);
    }
    const commentChars = current.node.title.length + current.node.body.length;
    if (commentChars > BOARD_RECORD_LIMITS.maxCommentChars) {
      throw new Error(`${modeLabel(mode)} record contains a node text value longer than ${BOARD_RECORD_LIMITS.maxCommentChars.toLocaleString()} characters.`);
    }
    totalCommentChars += commentChars;
    if (totalCommentChars > BOARD_RECORD_LIMITS.maxTotalCommentChars) {
      throw new Error(`${modeLabel(mode)} record exceeds the ${BOARD_RECORD_LIMITS.maxTotalCommentChars.toLocaleString()} total node-text limit.`);
    }
    const content = current.node.structuredContent;
    const supported = content?.kind === `${mode}-record`
      && (content.role === "record-root" || content.role === "move");
    if (!supported) unsupported.push(current.node);
    for (let index = current.node.children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: current.node.children[index], depth: current.depth + 1 });
    }
  }

  if (unsupported.length) {
    const first = unsupported[0];
    throw new Error(
      `This ${modeLabel(mode)} record contains ${unsupported.length} unsupported Atlas node${unsupported.length === 1 ? "" : "s"}. `
      + `The first is \"${first.title.trim() || "Untitled"}\". Remove or move these notes before exporting.`,
    );
  }
}

function findRecordRoot(root: AtlasNode, mode: BoardRecordSafetyMode): AtlasNode | null {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node) break;
    const content = node.structuredContent;
    if (content?.kind === `${mode}-record` && content.role === "record-root") return node;
    for (let index = node.children.length - 1; index >= 0; index -= 1) stack.push(node.children[index]);
  }
  return null;
}

function modeLabel(mode: BoardRecordSafetyMode) {
  return mode === "chess" ? "Chess" : mode === "go" ? "Go" : "shogi";
}

function formatBytes(bytes: number) {
  return `${Math.round(bytes / (1024 * 1024))} MiB`;
}
