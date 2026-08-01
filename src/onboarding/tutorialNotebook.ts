import type { MessageId } from "../i18n/messages";
import { deriveAtlasLayoutFrame, stabilizePhyllotaxisPositions } from "../layout/atlasLayout";
import type { AtlasNode } from "../types";

export const TUTORIAL_PRACTICE_ROOT_ID = "tutorial-practice-root";
export const TUTORIAL_PRACTICE_TARGET_ID = "tutorial-practice-answer";

type TutorialMessage = (id: MessageId) => string;

export function createTutorialPracticeNotebook(message: TutorialMessage): AtlasNode {
  const now = new Date().toISOString();
  const root = tutorialNode({
    id: TUTORIAL_PRACTICE_ROOT_ID,
    kind: "root",
    title: message("onboarding.practice.atlasTitle"),
    body: message("onboarding.practice.atlasBody"),
    color: "#d8f56d",
    radius: 56,
    now,
    children: [
      tutorialNode({
        id: TUTORIAL_PRACTICE_TARGET_ID,
        title: message("onboarding.practice.answerTitle"),
        body: message("onboarding.practice.answerBody"),
        color: "#82c9f2",
        status: "needs_review",
        now,
      }),
      tutorialNode({
        id: "tutorial-practice-thought",
        title: message("onboarding.practice.thoughtTitle"),
        body: message("onboarding.practice.thoughtBody"),
        color: "#e8c86a",
        now,
      }),
      tutorialNode({
        id: "tutorial-practice-action",
        title: message("onboarding.practice.actionTitle"),
        body: message("onboarding.practice.actionBody"),
        color: "#7fd6aa",
        now,
      }),
    ],
  });
  return stabilizePhyllotaxisPositions(root);
}

export function getTutorialPracticeOverview(root: AtlasNode) {
  const frame = deriveAtlasLayoutFrame(root, "phyllotaxis");
  const width = frame.bounds.maxX - frame.bounds.minX;
  const height = frame.bounds.maxY - frame.bounds.minY;
  const depth = frame.bounds.maxZ - frame.bounds.minZ;
  return {
    x: (frame.bounds.minX + frame.bounds.maxX) / 2,
    y: (frame.bounds.minY + frame.bounds.maxY) / 2,
    z: (frame.bounds.minZ + frame.bounds.maxZ) / 2,
    diameter: Math.max(width, height, depth * 0.7, 460) + 180,
  };
}

function tutorialNode({
  id,
  kind = "thread",
  title,
  body,
  color,
  status = "waiting",
  radius = 30,
  now,
  children = [],
}: {
  id: string;
  kind?: AtlasNode["kind"];
  title: string;
  body: string;
  color: string;
  status?: AtlasNode["status"];
  radius?: number;
  now: string;
  children?: AtlasNode[];
}): AtlasNode {
  return {
    id,
    kind,
    nodeType: "note",
    title,
    subtitle: title,
    body,
    author: "human",
    status,
    color,
    texture: "mist",
    radius,
    summary: body,
    nextDecision: body,
    tags: ["tutorial-practice"],
    attachments: [],
    createdAt: now,
    updatedAt: now,
    children,
  };
}
