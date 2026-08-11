import type { MessageId } from "../i18n/messages";

export type OnboardingMessageId =
  | "root.hint"
  | "root.answer"
  | "root.zoomOutForNodeCreate"
  | "node.edit"
  | "node.createMore"
  | "space.pan"
  | "space.cameraReset"
  | "space.cameraResetMobile"
  | "space.zoom"
  | "space.nodeDrag"
  | "space.childNode"
  | "space.childNodeFallback"
  | "space.complete"
  | "basic.complete"
  | "ai.unlockConfirm"
  | "ai.unlocked"
  | "title.nameUniverse";

export const ONBOARDING_MESSAGE_IDS: Record<OnboardingMessageId, MessageId> = {
  "root.hint": "onboarding.root.hint",
  "root.answer": "onboarding.root.answer",
  "root.zoomOutForNodeCreate": "onboarding.root.zoomOutForNodeCreate",
  "node.edit": "onboarding.practice.editNode",
  "node.createMore": "onboarding.practice.addChild",
  "space.pan": "onboarding.space.pan",
  "space.cameraReset": "onboarding.space.cameraReset",
  "space.cameraResetMobile": "onboarding.space.cameraResetMobile",
  "space.zoom": "onboarding.space.zoom",
  "space.nodeDrag": "onboarding.space.nodeDrag",
  "space.childNode": "onboarding.space.childNode",
  "space.childNodeFallback": "onboarding.space.childNodeFallback",
  "space.complete": "onboarding.space.complete",
  "basic.complete": "onboarding.basic.complete",
  "ai.unlockConfirm": "onboarding.ai.unlockConfirm",
  "ai.unlocked": "onboarding.ai.unlocked",
  "title.nameUniverse": "onboarding.title.nameUniverse",
};
