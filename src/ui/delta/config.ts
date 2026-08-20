import type { DeltaMapSize } from "../../types";

export function isDeltaModeRequest(text: string) {
  const clean = text.toLowerCase();
  return /\bdelta(?:\s+mode)?\b/.test(clean) && /\b(open|start|switch|enter|launch|run(?:ning)?|test(?:ing)?|try|use|begin|engage|engagement)\b/.test(clean);
}

export const deltaDiceImages: Record<number, string> = { 4: "dice/d4.png", 6: "dice/d6.png", 8: "dice/d8.png", 9: "dice/d9.png", 12: "dice/d12.png", 20: "dice/d20.png", 100: "dice/d100.png" };

export function normaliseDeltaMapSize(value: unknown): DeltaMapSize {
  const size = typeof value === "string" ? value.trim().toUpperCase() : "";
  return size === "S" || size === "M" || size === "L" || size === "XL" || size === "XXL" ? size : "M";
}
