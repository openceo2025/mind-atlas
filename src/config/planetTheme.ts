import type { PlanetTexture } from "../types";

export const planetPalettes = [
  "#f1d37a",
  "#7ed9b1",
  "#e48aac",
  "#8fb7ff",
  "#caa4ff",
  "#f29d72",
  "#9dd7e7",
  "#c8dc85",
] as const;

export const planetTextures: PlanetTexture[] = ["speckled", "bands", "freckles", "craters", "mist", "cell"];

export function planetColorForSeed(seedText: string) {
  return planetPalettes[hashSeed(seedText) % planetPalettes.length];
}

export function planetTextureForSeed(seedText: string) {
  return planetTextures[hashSeed(`${seedText}:texture`) % planetTextures.length];
}

export function hashSeed(seedText: string) {
  let hash = 2166136261;
  for (let index = 0; index < seedText.length; index += 1) {
    hash ^= seedText.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
