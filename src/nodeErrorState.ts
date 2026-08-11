import type { AtlasNode } from "./types";

export function isIntrinsicErrorNode(node: AtlasNode) {
  return (
    node.status === "error" &&
    !node.propagatedErrorSourceId &&
    (node.kind === "event" || node.author === "system" || node.tags.includes("error"))
  );
}

export function acknowledgeNodeError(
  root: AtlasNode,
  nodeId: string,
  updatedAt = new Date().toISOString(),
): { root: AtlasNode; acknowledged: boolean } {
  const result = acknowledgeNodeErrorInTree(root, nodeId, updatedAt);
  return { root: result.node, acknowledged: result.acknowledged };
}

function acknowledgeNodeErrorInTree(
  node: AtlasNode,
  nodeId: string,
  updatedAt: string,
): { node: AtlasNode; acknowledged: boolean; intrinsicErrorSourceId?: string } {
  let acknowledged = node.id === nodeId && isIntrinsicErrorNode(node);
  let nextNode = acknowledged
    ? {
        ...node,
        status: "needs_review" as const,
        updatedAt,
      }
    : node;

  const childResults = nextNode.children.map((child) => acknowledgeNodeErrorInTree(child, nodeId, updatedAt));
  const childrenChanged = childResults.some((result, index) => result.node !== nextNode.children[index]);
  acknowledged = acknowledged || childResults.some((result) => result.acknowledged);
  if (childrenChanged) {
    nextNode = { ...nextNode, children: childResults.map((result) => result.node) };
  }

  const descendantErrorSourceId = childResults.find((result) => result.intrinsicErrorSourceId)?.intrinsicErrorSourceId;
  if (nextNode.propagatedErrorSourceId) {
    if (descendantErrorSourceId) {
      if (nextNode.status !== "error" || nextNode.propagatedErrorSourceId !== descendantErrorSourceId) {
        nextNode = {
          ...nextNode,
          status: "error",
          propagatedErrorSourceId: descendantErrorSourceId,
          updatedAt,
        };
      }
    } else {
      const { propagatedErrorSourceId: _propagatedErrorSourceId, ...rest } = nextNode;
      nextNode = {
        ...rest,
        status: nextNode.status === "error" ? "needs_review" : nextNode.status,
        updatedAt,
      };
    }
  }

  return {
    node: nextNode,
    acknowledged,
    intrinsicErrorSourceId: isIntrinsicErrorNode(nextNode) ? nextNode.id : descendantErrorSourceId,
  };
}
