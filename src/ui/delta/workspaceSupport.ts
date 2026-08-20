import { useState } from "react";
import type { DeltaEntity, DeltaFinishPacket, DeltaJobTemplate, DeltaLootItem, DeltaMessage } from "../../types";
import { uid } from "../../utils";
import type { DeltaRelationship } from "./display";

export function formatInventoryKg(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  return String(Math.max(0.01, Math.round(value * 100) / 100));
}

export function jobCategories(jobs: DeltaJobTemplate[]) {
  const counts = new Map<string, number>();
  for (const job of jobs) {
    const category = job.category.trim();
    if (!category) continue;
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

export function extractJsonObject(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("No JSON object found.");
  return text.slice(start, end + 1);
}

export function parseDeltaFinishPacket(text: string): DeltaFinishPacket {
  const parsed = JSON.parse(extractJsonObject(text)) as Partial<DeltaFinishPacket>;
  const lootItems = Array.isArray(parsed.lootItems)
    ? parsed.lootItems.map((item, index) => {
        const row = item as Partial<DeltaLootItem>;
        const quantity = Math.max(0, Math.floor(Number(row.quantity) || 0));
        return {
          id: typeof row.id === "string" && row.id.trim() ? row.id : uid(),
          name: typeof row.name === "string" ? row.name.trim() : "",
          quantity,
          pickedQuantity: Math.max(0, Math.min(quantity, Math.floor(Number(row.pickedQuantity) || 0)))
        };
      }).filter((item) => item.name && item.quantity > 0)
    : [];
  return {
    finalEngagementBeat: String(parsed.finalEngagementBeat ?? "").trim(),
    outcomeSummary: String(parsed.outcomeSummary ?? "").trim(),
    lootItems,
    parentChatHandoff: String(parsed.parentChatHandoff ?? "").trim()
  };
}

export function formatLootList(items: Array<{ name: string; quantity: number }>) {
  return items.length
    ? items.map((item) => `${item.name} x${item.quantity}`).join(", ")
    : "Nothing.";
}

export function cleanDeltaToolCallText(text: string) {
  return text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.length > 140 || /["“”]/.test(trimmed)) return true;
      if (/^(?:requesting|calling(?:\s+for)?)\b.*\broll\b/i.test(trimmed)) return false;
      if (/^rolling\b.*(?:\broll\b|\bfor\b)/i.test(trimmed)) return false;
      return true;
    })
    .join("\n")
    .trim();
}

export function deltaInlineRollResultDice(text: string) {
  const dice = new Set<number>();
  const normalized = text.replace(/[*_`]/g, "");
  for (const match of normalized.matchAll(/\b(?:\d+\s*)?d(4|6|8|9|12|20|100)\b[^\n]{0,80}?(?:=|rolled?\s+)\s*-?\d+/gi)) {
    dice.add(Number(match[1]));
  }
  if ((/\broll(?:ed|ing|s)?\b[^\n]{0,80}\b-?\d+\s*[+-]\s*-?\d+\s*=\s*-?\d+/i.test(normalized)
    || /\broll(?:ed|s)\s+(?:a\s+)?-?\d+\b/i.test(normalized)
    || /\b(?:attack|damage|initiative|reaction|check|save|contest)\s+roll\b[^\n:]{0,50}:\s*-?\d+\b/i.test(normalized)) && dice.size === 0) {
    dice.add(0);
  }
  return [...dice];
}

export function isDeltaRollNotice(text: string) {
  return /^(Roll\b|[^:\n]{1,80}:\s*Roll\b)/.test(text.trim());
}

export function deltaLogTurnCount(messages: DeltaMessage[]) {
  let legacyTurns = 0;
  let explicitTurnMax = 0;
  let legacyRollPendingResolution = false;
  for (const message of messages) {
    explicitTurnMax = Math.max(explicitTurnMax, message.turnNumber ?? 0);
    if (message.turnNumber !== undefined) continue;
    if (message.role === "system" && isDeltaRollNotice(message.body)) {
      legacyRollPendingResolution = legacyTurns > 0;
      continue;
    }
    if (message.role === "system") continue;
    if (message.role === "assistant" && legacyRollPendingResolution) {
      legacyRollPendingResolution = false;
      continue;
    }
    legacyRollPendingResolution = false;
    legacyTurns += 1;
  }
  return Math.max(explicitTurnMax, legacyTurns);
}

export function fitComposerTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return;
  const styles = window.getComputedStyle(textarea);
  const lineHeight = Number.parseFloat(styles.lineHeight) || 22;
  const padding = Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom);
  const tenLineHeight = Math.ceil(lineHeight * 10 + padding);
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const viewportCap = Math.max(104, Math.floor(viewportHeight * 0.42));
  const maxHeight = Math.min(240, tenLineHeight, viewportCap);
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
}

export function keepComposerVisible(textarea: HTMLTextAreaElement | null) {
  if (!textarea || document.activeElement !== textarea) return;
  window.requestAnimationFrame(() => textarea.scrollIntoView({ block: "center", inline: "nearest" }));
  window.setTimeout(() => {
    if (document.activeElement === textarea) textarea.scrollIntoView({ block: "center", inline: "nearest" });
  }, 180);
}

export function visiblePositionValue(value?: string) {
  if (!value || value.trim().toLowerCase() === "unset") return "";
  return value;
}

export function entityPositionLabel(entity: DeltaEntity) {
  return [visiblePositionValue(entity.distanceFromPlayer), visiblePositionValue(entity.elevation)].filter(Boolean).join(", ");
}

export function visibleDeltaStartContext(context: string) {
  return context
    .replace(/\n\nDELTA CONTINUITY ANCHORS:\n[\s\S]*?(?=\n\nPLAYER CHARACTER:|$)/, "")
    .replace(/\n\nPLAYER CHARACTER ID:\n[\s\S]*$/, "");
}

export function textMentionsName(text: string, name: string) {
  const cleanName = name.trim();
  if (!cleanName) return false;
  const escaped = cleanName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}([^\\p{L}\\p{N}_]|$)`, "iu").test(text);
}

export function isInvalidDeltaEntityName(value: string) {
  const raw = value.trim();
  const name = value
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/[.!?:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const placeholderName = name.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").trim();
  if (!name || /^(none|unknown|n\/a|unnamed entity)$/i.test(name)) return true;
  if (/^(?:<[^>]+>|\[[^\]]+\]|\{[^}]+\})$/.test(raw) && /^(name|character name|npc name|enemy name|creature name)$/i.test(placeholderName)) return true;
  if (/^(situation|location|objective|constraint|map|terrain|scene|status|player|allies?|hostiles?|neutrals?)\s*:/i.test(name)) return true;
  if (/^\d+(?:\.\d+)?\s*m(?:eters?)?(?:\s+away)?$/i.test(name)) return true;
  if (/^(out\s+of|behind|inside|outside|near|beside|under|over|above|below|within|toward|towards|between|around|through|past|at|on)\b/i.test(name)) return true;
  if (/^(in\s+front\s+of|next\s+to|close\s+to|far\s+from)\b/i.test(name)) return true;
  if (/^(melee range|ranged range|cover|full cover|half cover|behind cover|line of sight|high ground|low ground)$/i.test(name)) return true;
  return false;
}

export function deltaRosterParticipants(text: string) {
  const countWords = new Set(["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "a", "an"]);
  const actionWords = /\b(scanning|patrolling|flickering|setting|moving|watching|standing|crouching|aiming|speaking|waiting|emerging|approaching|entering|leaving|combat|engagement|situation|location|objective|terrain|map)\b/i;
  const sideForLabel = (label: string): DeltaRelationship => {
    const clean = label.toLowerCase();
    if (clean.startsWith("hostile") || clean.startsWith("enem")) return "hostile";
    if (clean.startsWith("neutral")) return "neutral";
    return "ally";
  };
  const cleanName = (value: string) =>
    value
      .replace(/\([^)]*\)/g, "")
      .replace(/\[[^\]]*\]/g, "")
      .replace(/\b(player|ally|neutral|hostile|present|known|named)\b/gi, "")
      .replace(/[.!?:]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const participants: { name: string; side: DeltaRelationship }[] = [];
  const anchorsMatch = /DELTA CONTINUITY ANCHORS:\s*\n([\s\S]*?)(?=\n\n(?:PLAYER CHARACTER|MAP SIZE|PLAYER CHARACTER ID):|$)/i.exec(text);
  const anchors = anchorsMatch?.[1] ?? text;
  for (const line of anchors.split(/\r?\n/)) {
    const match = /^\s*(player|your\s+team|team|allies?|ally|neutrals?|neutral|hostiles?|hostile|enemies|enemy)(?:\s+present)?\s*:\s*(.+)$/i.exec(line);
    if (!match) continue;
    const side = sideForLabel(match[1]);
    const chunks = match[2].split(/[|,]/);
    for (const chunk of chunks) {
      if (chunk.includes(":")) continue;
      const name = cleanName(chunk);
      if (isInvalidDeltaEntityName(name) || abstractDeltaRosterName(name)) continue;
      const first = name.split(/\s+/)[0]?.toLowerCase() ?? "";
      if (/^\d+/.test(first) || countWords.has(first) || actionWords.test(name) || /^(situation|location|objective|constraint|map|terrain|scene|status)$/i.test(name)) continue;
      participants.push({ name, side });
    }
  }
  const seen = new Set<string>();
  return participants.filter((participant) => {
    const key = `${participant.side}:${participant.name.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function abstractDeltaRosterName(name: string) {
  return /\b(?:unknown|mysterious|unidentified|indistinct|shadowy)\b/i.test(name);
}

export function useSavedNotice() {
  const [saved, setSaved] = useState(false);
  function showSaved() {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  }
  return [saved, showSaved] as const;
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
