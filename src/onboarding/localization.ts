export type OnboardingLocale = "en" | "ja";

export type OnboardingMessageId =
  | "root.hint"
  | "root.answer"
  | "root.zoomOutForNodeCreate"
  | "space.pan"
  | "space.cameraReset"
  | "space.zoom"
  | "space.nodeDrag"
  | "space.childNode"
  | "space.complete"
  | "basic.complete"
  | "ai.unlockConfirm"
  | "ai.unlocked"
  | "title.nameUniverse";

export const ONBOARDING_TEXT: Record<OnboardingLocale, Record<OnboardingMessageId, string>> = {
  en: {
    "root.hint": "Try pressing and holding.",
    "root.answer": "Press and hold the space to create your first node.",
    "root.zoomOutForNodeCreate": "Zoom out before creating a node.",
    "space.pan": "Drag the background to turn the universe.",
    "space.cameraReset": "Click the MindAtlas logo at the top left to return to the initial camera view.",
    "space.zoom": "Scroll or pinch slowly to zoom.",
    "space.nodeDrag": "Drag a node slowly for a moment to move it.",
    "space.childNode": "Quickly drag a node, then keep holding until the creation effect completes.",
    "space.complete": "Congratulations. You have mastered every Space View action.",
    "basic.complete": "Congratulations. You have mastered the basic Mind Atlas controls.",
    "ai.unlockConfirm": "Unlock Mind Atlas AI features?",
    "ai.unlocked":
      "Congratulations. Every Mind Atlas feature is unlocked. Use it as your partner for riding the waves of cognition and judgment in the AI era ahead.",
    "title.nameUniverse": "Name this universe.",
  },
  ja: {
    "root.hint": "長押ししてみましょう。",
    "root.answer": "画面を長押しして最初のノードを作成しましょう。",
    "root.zoomOutForNodeCreate": "nodeの生成はズームアウトした状態で行ってください",
    "space.pan": "背景をドラッグして、視点を動かしてみましょう。",
    "space.cameraReset": "左上のMindAtlasロゴをクリックして、初期カメラ配置に戻してください。",
    "space.zoom": "スクロールまたはピンチで、ゆっくりズームしてみましょう。",
    "space.nodeDrag": "ノードをゆっくりドラッグして、動かしてみましょう。",
    "space.childNode": "ノードを素早くドラッグし、生成エフェクトが完了するまで長押しして子ノードを作りましょう。",
    "space.complete": "おめでとうございます。スペースビューの機能は全てマスターしました。",
    "basic.complete": "おめでとうございます。マインドアトラスの基本操作は全てマスターしました。",
    "ai.unlockConfirm": "マインドアトラスのAI機能を解放しますか？",
    "ai.unlocked":
      "おめでとうございます。マインドアトラスの全ての機能が解放されました。これからのAI時代、認知/判断の波を乗りこなすための、あなたのパートナーとしてお使いください。",
    "title.nameUniverse": "この宇宙に名前を付けてみましょう",
  },
};

export function detectOnboardingLocale(): OnboardingLocale {
  if (typeof navigator === "undefined") return "en";
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  return languages.some((language) => language?.toLowerCase().startsWith("ja")) ? "ja" : "en";
}
