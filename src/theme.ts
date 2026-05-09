export type AtlasTheme = "dark" | "light";

export const ATLAS_THEME_STORAGE_KEY = "mind-atlas-theme";

export function loadStoredTheme(): AtlasTheme {
  if (typeof window === "undefined") return "dark";
  return window.localStorage.getItem(ATLAS_THEME_STORAGE_KEY) === "light" ? "light" : "dark";
}

export function persistTheme(theme: AtlasTheme) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ATLAS_THEME_STORAGE_KEY, theme);
}
