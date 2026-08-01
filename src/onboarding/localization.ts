import type { MessageId } from "../i18n/messages";

export type OnboardingMessageId =
  | "practice.selectNode"
  | "practice.editNode"
  | "practice.addChild"
  | "basic.complete"
  | "title.nameUniverse";

export const ONBOARDING_MESSAGE_IDS: Record<OnboardingMessageId, MessageId> = {
  "practice.selectNode": "onboarding.practice.selectNode",
  "practice.editNode": "onboarding.practice.editNode",
  "practice.addChild": "onboarding.practice.addChild",
  "basic.complete": "onboarding.basic.complete",
  "title.nameUniverse": "onboarding.title.nameUniverse",
};
