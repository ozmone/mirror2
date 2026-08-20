import type React from "react";
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Dexie from "dexie";
import {
  Archive,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  Edit3,
  Eye,
  Clipboard,
  Folder,
  Image as ImageIcon,
  Info,
  KeyRound,
  Map as MapIcon,
  Menu,
  MessageSquare,
  Pencil,
  Paperclip,
  Pin,
  Plus,
  RefreshCw,
  Share2,
  Save,
  Search,
  Settings,
  Shield,
  ShoppingBag,
  Star,
  Swords,
  Trash2,
  Upload,
  UserRound,
  Zap,
  X
} from "lucide-react";
import { db, ensureSeedData } from "../data/db";
import { createFullBackup, createRecoverySnapshot, installAutomaticRecoverySnapshots, listRecoverySnapshots, mergeFullBackup, parseAndValidateBackup, replaceWithFullBackup, restoreRecoverySnapshot, type RecoverySlot, type RecoverySnapshot } from "../data/backup";
import {
  abilities,
  addMessage,
  addDeltaMessage,
  applyDeltaDamage,
  applyInventoryChange,
  archiveDeltaSession,
  createChat,
  createMemory,
  createProject,
  findCharacters,
  getOrCreateDeltaSession,
  getCharacterBio,
  getCharacterIdentity,
  getCharacterStats,
  normaliseInventoryName,
  messagesForIncrementalCompaction,
  searchMemories,
  generatedDeltaStats,
  generatedStatsPatch,
  formatDeltaTemplateTag,
  characterTemplateStats,
  effectiveDeltaPrefixes,
  effectiveDeltaBases,
  toggleStar,
  upsertDeltaAllyCache,
  validatePointBuy
} from "../data/repositories";
import { defaultDeltaBases, defaultDeltaJobs, defaultDeltaNpcStats, defaultDeltaPrefixes, defaultDeltaSystemPrompt, effectiveDeltaSystemPrompt, defaultMemoryInstruction, defaultSettings } from "../data/defaults";
import { Ability, AbilityModifiers, AbilityScores, AppSettings, Character, CharacterActionMacro, CharacterActionSlot, CharacterBonus, CharacterGearSlot, Chat, DeltaAllyCacheEntry, DeltaBaseTemplate, DeltaBriefRoster, DeltaEffectDefinition, DeltaEffectPolarity, DeltaEntity, DeltaFinishPacket, DeltaIconAsset, DeltaJobTemplate, DeltaLootItem, DeltaMapSize, DeltaMapTile, DeltaMapTileKind, DeltaMessage, DeltaPrefixTemplate, DeltaRollReceipt, DeltaSavingThrowTiming, DeltaSession, GearBodyType, InventoryKind, InventoryItem, InventoryLog, InventoryUpdateRequest, MainChatAuditToolEvent, MainChatMemoryReviewAudit, MainChatRequestAudit, Memory, Message, PendingMemory, Project, RouteName } from "../types";
import { estimateTokens, formatDate, normaliseTag, now, splitTags, uid } from "../utils";
import { ProjectIcon, projectIcons } from "./icons";
import { GearDrawer } from "./gear/GearDrawer";

const accents = [
  { name: "sage", value: "#8fbea8" },
  { name: "violet", value: "#b7a1e8" },
  { name: "blue", value: "#82aee6" },
  { name: "rose", value: "#d993a8" },
  { name: "amber", value: "#d3aa66" },
  { name: "teal", value: "#72bfc2" },
  { name: "clay", value: "#c58f78" },
  { name: "silver", value: "#b9bdc7" },
  { name: "bone", value: "#d8d1c2" },
  { name: "muted blue", value: "#6f8fb8" },
  { name: "dusty rose", value: "#a86373" },
  { name: "dark burgundy", value: "#5a1f2c" },
  { name: "dark violet", value: "#43245f" },
  { name: "plum", value: "#62314f" },
  { name: "deep navy", value: "#1f355c" },
  { name: "deep teal", value: "#1f5a5c" },
  { name: "forest green", value: "#284d34" },
  { name: "dark rust", value: "#74412a" },
  { name: "charcoal/slate", value: "#4b5563" }
] as const;

function hexToRgb(hex: string) {
  const clean = hex.replace("#", "");
  const value = Number.parseInt(clean, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255
  };
}

function rgbToHex({ r, g, b }: { r: number; g: number; b: number }) {
  return `#${[r, g, b].map((part) => Math.round(Math.max(0, Math.min(255, part))).toString(16).padStart(2, "0")).join("")}`;
}

function relativeLuminance(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function mixHex(a: string, b: string, amount: number) {
  const first = hexToRgb(a);
  const second = hexToRgb(b);
  return rgbToHex({
    r: first.r + (second.r - first.r) * amount,
    g: first.g + (second.g - first.g) * amount,
    b: first.b + (second.b - first.b) * amount
  });
}

function formatInventoryKg(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  return String(Math.max(0.01, Math.round(value * 100) / 100));
}

function formatByteSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

function readUnitWeightKg(totalWeightKg: string, quantity: number) {
  const parsed = Number(totalWeightKg);
  if (!Number.isFinite(parsed) || parsed <= 0 || quantity <= 0) return 0;
  return Math.max(0.01, Math.round((parsed / quantity) * 100) / 100);
}

function accentTokens(value: string) {
  const luminance = relativeLuminance(value);
  const isDark = luminance < 0.24;
  return {
    accent: value,
    fill: isDark ? mixHex(value, "#ffffff", 0.24) : value,
    contrast: isDark ? "#f4f6f8" : "#111315"
  };
}

const routeLabels: Record<RouteName, string> = {
  chat: "Chat",
  projects: "Projects",
  projectEdit: "Project Settings",
  stars: "Stars",
  archives: "Archives",
  archiveEntries: "Archive Entries",
  characters: "Characters",
  characterProfile: "Character Profile",
  memories: "Memories",
  compaction: "Compaction Memory",
  sourceFiles: "Source Files",
  api: "API",
  data: "Data",
  settings: "Settings"
};

function fontSizeLabel(size: number) {
  if (size <= 12) return "XS";
  if (size <= 14) return "Small";
  if (size <= 16) return "Standard";
  if (size <= 18) return "Large";
  if (size <= 20) return "XL";
  if (size <= 22) return "XXL";
  return "Huge";
}

function formatMessageDate(timestamp: number) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(timestamp);
}

function optionalNumber(value: string) {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function cleanAbilityScores(value?: AbilityScores): AbilityScores {
  const defaults = defaultDeltaNpcStats();
  return abilities.reduce((scores, ability) => ({ ...scores, [ability]: Number.isFinite(value?.[ability]) ? Number(value?.[ability]) : defaults[ability] }), defaults);
}

function cleanAbilityModifiers(value?: AbilityModifiers): AbilityModifiers {
  return abilities.reduce((modifiers, ability) => {
    const amount = value?.[ability];
    return Number.isFinite(amount) && amount !== 0 ? { ...modifiers, [ability]: Number(amount) } : modifiers;
  }, {} as AbilityModifiers);
}

function isLegacyDefaultTitanBase(item: DeltaBaseTemplate) {
  return item.id.trim().toLowerCase() === "titan" &&
    item.label.trim().toUpperCase() === "TITAN" &&
    Object.keys(cleanAbilityModifiers(item.statModifiers)).length === 0 &&
    !item.hpBonus &&
    !item.notes?.trim();
}

function cleanDeltaPrefixes(value: DeltaPrefixTemplate[]) {
  return value
    .map((item) => ({
      id: item.id.trim() || uid(),
      label: item.label.trim(),
      statModifiers: cleanAbilityModifiers(item.statModifiers),
      notes: item.notes?.trim() || undefined
    }))
    .filter((item) => item.label);
}

function cleanDeltaBases(value: DeltaBaseTemplate[]) {
  return value
    .filter((item) => !isLegacyDefaultTitanBase(item))
    .map((item) => ({
      id: item.id.trim() || uid(),
      label: item.label.trim(),
      statModifiers: cleanAbilityModifiers(item.statModifiers),
      hpBonus: Number.isFinite(item.hpBonus) && item.hpBonus !== 0 ? Number(item.hpBonus) : undefined,
      notes: item.notes?.trim() || undefined
    }))
    .filter((item) => item.label);
}

function deltaBaseDraft(value?: DeltaBaseTemplate[]) {
  const rows = value?.filter((item) => !isLegacyDefaultTitanBase(item));
  return effectiveDeltaBases(rows);
}

function cleanDeltaJobs(value: DeltaJobTemplate[]) {
  return value
    .map((item) => ({
      id: item.id.trim() || uid(),
      label: item.label.trim(),
      category: item.category.trim(),
      statModifiers: cleanAbilityModifiers(item.statModifiers),
      notes: item.notes?.trim() || undefined
    }))
    .filter((item) => item.label && item.category);
}

function categoryFromFilename(filename: string) {
  return filename.replace(/\.txt$/i, "").trim();
}

function jobCategories(jobs: DeltaJobTemplate[]) {
  const counts = new Map<string, number>();
  for (const job of jobs) {
    const category = job.category.trim();
    if (!category) continue;
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

function isDeltaModeRequest(text: string) {
  const clean = text.toLowerCase();
  return /\bdelta(?:\s+mode)?\b/.test(clean) && /\b(open|start|switch|enter|launch|run(?:ning)?|test(?:ing)?|try|use|begin|engage|engagement)\b/.test(clean);
}

const deltaDiceImages: Record<number, string> = {
  4: "dice/d4.png",
  6: "dice/d6.png",
  8: "dice/d8.png",
  9: "dice/d9.png",
  12: "dice/d12.png",
  20: "dice/d20.png",
  100: "dice/d100.png"
};

function extractJsonObject(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("No JSON object found.");
  return text.slice(start, end + 1);
}

function parseDeltaFinishPacket(text: string): DeltaFinishPacket {
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

function formatLootList(items: Array<{ name: string; quantity: number }>) {
  return items.length
    ? items.map((item) => `${item.name} x${item.quantity}`).join(", ")
    : "Nothing.";
}

function normaliseDeltaMapSize(value: unknown): DeltaMapSize {
  const size = typeof value === "string" ? value.trim().toUpperCase() : "";
  return size === "S" || size === "M" || size === "L" || size === "XL" || size === "XXL" ? size : "M";
}

function parseDeltaBriefPacket(text: string) {
  try {
    const parsed = JSON.parse(extractJsonObject(text)) as { brief?: unknown; handoffContext?: unknown; playerCharacterName?: unknown; roster?: unknown; team?: unknown; neutral?: unknown; enemies?: unknown; mapSize?: unknown; avoidLabel?: unknown; avoidPrompt?: unknown };
    return {
      brief: typeof parsed.brief === "string" ? parsed.brief.trim() : "",
      handoffContext: typeof parsed.handoffContext === "string" ? parsed.handoffContext.trim() : "",
      playerCharacterName: typeof parsed.playerCharacterName === "string" ? parsed.playerCharacterName.trim() : "",
      roster: normaliseDeltaBriefRoster(parsed.roster ?? { team: parsed.team, neutral: parsed.neutral, enemies: parsed.enemies }),
      mapSize: normaliseDeltaMapSize(parsed.mapSize),
      avoidLabel: typeof parsed.avoidLabel === "string" ? parsed.avoidLabel.trim() : "",
      avoidPrompt: typeof parsed.avoidPrompt === "string" ? parsed.avoidPrompt.trim() : ""
    };
  } catch {
    return { brief: "", handoffContext: "", playerCharacterName: "", roster: normaliseDeltaBriefRoster(undefined), mapSize: "M" as DeltaMapSize, avoidLabel: "", avoidPrompt: "" };
  }
}

function parseDeltaAvoidPacket(text: string) {
  try {
    const parsed = JSON.parse(extractJsonObject(text)) as { escaped?: unknown; responseText?: unknown };
    return {
      escaped: Boolean(parsed.escaped),
      responseText: typeof parsed.responseText === "string" ? parsed.responseText.trim() : ""
    };
  } catch {
    return { escaped: false, responseText: text.trim() };
  }
}

async function parseJobFiles(files: FileList | null) {
  if (!files?.length) return { jobs: [] as DeltaJobTemplate[], categories: [] as string[], errors: [] as string[] };
  const jobs: DeltaJobTemplate[] = [];
  const categories: string[] = [];
  const errors: string[] = [];
  for (const file of Array.from(files)) {
    const category = categoryFromFilename(file.name);
    if (!category) {
      errors.push(`${file.name}: filename must contain a category name.`);
      continue;
    }
    const text = await file.text();
    const parsedRows: DeltaJobTemplate[] = [];
    text.split(/\r?\n/).forEach((rawLine, lineIndex) => {
      const line = rawLine.trim();
      if (!line) return;
      const fields = line.split(/\s+/);
      if (fields.length !== 7) {
        errors.push(`${file.name}:${lineIndex + 1} expected JOB STR DEX CON INT WIS CHA.`);
        return;
      }
      const [label, ...numbers] = fields;
      const modifiers = numbers.map((value) => Number(value));
      if (modifiers.some((value) => !Number.isFinite(value))) {
        errors.push(`${file.name}:${lineIndex + 1} stat modifiers must be numbers.`);
        return;
      }
      parsedRows.push({
        id: `${category}-${label}`.toLowerCase(),
        label: label.trim().toUpperCase(),
        category,
        statModifiers: {
          STR: modifiers[0],
          DEX: modifiers[1],
          CON: modifiers[2],
          INT: modifiers[3],
          WIS: modifiers[4],
          CHA: modifiers[5]
        },
        notes: ""
      });
    });
    if (!errors.some((error) => error.startsWith(`${file.name}:`))) {
      categories.push(category);
      jobs.push(...parsedRows);
    }
  }
  return { jobs, categories, errors };
}

const memoryStopWords = new Set([
  "about", "after", "again", "against", "also", "because", "before", "being", "between", "could", "every", "from", "have", "into", "just", "like", "more", "much", "need", "only", "over", "really", "should", "some", "that", "their", "them", "then", "there", "these", "thing", "this", "those", "through", "very", "want", "were", "what", "when", "where", "which", "while", "with", "would", "your"
]);

function extractMemoryConcepts(parts: string[], limit = 16) {
  const text = parts.join("\n");
  const properNouns = Array.from(text.matchAll(/\b[A-Z][a-zA-Z0-9'-]{2,}\b/g)).map((match) => match[0].toLowerCase());
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9'-]+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 2 && !memoryStopWords.has(word) && !/^\d+$/.test(word));
  const counts = new Map<string, number>();
  for (const word of [...properNouns, ...words]) {
    counts.set(word, (counts.get(word) ?? 0) + (properNouns.includes(word) ? 2 : 1));
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word]) => word);
}

function entityDisplayNames(entities: DeltaEntity[]) {
  return new Map(entities.map((entity) => [entity.id, entity.name]));
}

function formatEntityNameList(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

type DeltaRelationship = DeltaEntity["side"];

const deltaRelationships: DeltaRelationship[] = ["ally", "neutral", "hostile"];

function normaliseDeltaRelationship(value: string): DeltaRelationship {
  if (value === "ally" || value === "neutral" || value === "hostile") return value;
  if (value === "party") return "ally";
  if (value === "opposition") return "hostile";
  return "neutral";
}

function deltaRelationshipLabel(value: DeltaRelationship) {
  if (value === "ally") return "Ally";
  if (value === "hostile") return "Hostile";
  return "Neutral";
}

function cleanDeltaToolCallText(text: string) {
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

function deltaInlineRollResultDice(text: string) {
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

function isDeltaRollNotice(text: string) {
  return /^(Roll\b|[^:\n]{1,80}:\s*Roll\b)/.test(text.trim());
}

function deltaLogTurnCount(messages: DeltaMessage[]) {
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

function statModifier(value?: number) {
  if (typeof value !== "number") return "";
  const modifier = Math.floor((value - 10) / 2);
  return modifier >= 0 ? `+${modifier}` : `${modifier}`;
}

const deltaRollAbilities = ["STR", "DEX", "CON", "INT", "WIS", "CHA"] as const;
type DeltaRollAbility = typeof deltaRollAbilities[number];

function deltaRollModifier(entity: DeltaEntity | undefined, ability: DeltaRollAbility | undefined) {
  if (!entity || !ability) return 0;
  const score = entity[ability.toLowerCase() as "str" | "dex" | "con" | "int" | "wis" | "cha"] ?? 10;
  return Math.floor((score - 10) / 2);
}

function deltaRollResultText(die: number, results: number[], modifier: number) {
  const diceLabel = results.length > 1 ? `${results.length}d${die}` : `d${die}`;
  const diceMath = results.join(" + ");
  const rawTotal = results.reduce((total, result) => total + result, 0);
  const total = rawTotal + modifier;
  if (modifier === 0) return { text: results.length > 1 ? `${diceLabel} = ${diceMath} = ${total}` : `${diceLabel} = ${diceMath}`, total };
  const modifierMath = modifier > 0 ? ` + ${modifier}` : ` - ${Math.abs(modifier)}`;
  return { text: `${diceLabel} = ${diceMath}${modifierMath} = ${total}`, total };
}

function HpSquares({ current, max, relationship, character = false }: { current: number; max: number; relationship?: DeltaRelationship; character?: boolean }) {
  const total = Math.max(1, Math.floor(max));
  const filled = Math.max(0, Math.min(total, Math.floor(current)));
  return (
    <span className={`hp-squares ${character ? "character" : relationship ?? "ally"}`} aria-label={`${filled} of ${total} HP`}>
      {Array.from({ length: total }, (_, index) => <i className={index < filled ? "filled" : ""} key={index} />)}
    </span>
  );
}

function deltaEntityStats(entity: DeltaEntity) {
  return [
    ["STR", entity.str],
    ["DEX", entity.dex],
    ["CON", entity.con],
    ["INT", entity.int],
    ["WIS", entity.wis],
    ["CHA", entity.cha]
  ] as const;
}

const deltaMapPreviewSizes = {
  S: { metres: 30, cells: 6 },
  M: { metres: 50, cells: 10 },
  L: { metres: 80, cells: 16 },
  XL: { metres: 100, cells: 20 },
  XXL: { metres: 200, cells: 40 }
} as const;

function DeltaMapPrototype({ entities, tiles, size }: { entities: DeltaEntity[]; tiles: DeltaMapTile[]; size: DeltaMapSize }) {
  const { metres, cells } = deltaMapPreviewSizes[size];
  const mapGridWidth = 20 + cells * 22 + Math.max(0, cells - 1);
  const [selectedCell, setSelectedCell] = useState<{ row: number; column: number }>();
  const tilesByCoordinate = new Map(tiles.map((tile) => [`${tile.row}:${tile.column}`, tile]));
  const entitiesByCoordinate = new Map(entities
    .filter((entity) => Number.isInteger(entity.mapRow) && Number.isInteger(entity.mapColumn) && (entity.mapRow ?? 0) >= 1 && (entity.mapRow ?? 0) <= cells && (entity.mapColumn ?? 0) >= 1 && (entity.mapColumn ?? 0) <= cells)
    .map((entity) => [`${entity.mapRow}:${entity.mapColumn}`, entity]));
  const displayNames = entityDisplayNames(entities);
  const selectedTile = selectedCell ? tilesByCoordinate.get(`${selectedCell.row}:${selectedCell.column}`) : undefined;
  const columns = Array.from({ length: cells }, (_, index) => String.fromCharCode(65 + (index % 26)));
  const selectedCoordinate = selectedCell ? `${columns[selectedCell.column - 1]}${selectedCell.row}` : "";
  const selectedTitle = selectedTile
    ? selectedTile.kind === "access"
      ? `${selectedTile.accessState === "locked" ? "Locked" : selectedTile.accessState === "open" ? "Open" : "Closed"} access`
      : selectedTile.kind === "special"
        ? selectedTile.label || "Special terrain"
        : selectedTile.kind === "half"
          ? selectedTile.label || "Half terrain"
          : selectedTile.label || "Solid terrain"
    : "Open tile";
  return (
    <div className="delta-map-prototype" style={{ "--map-grid-width": `${mapGridWidth}px` } as React.CSSProperties}>
      <div className="delta-map-header">
        <div>
          <h2>Map</h2>
          <small>{size} / {metres}m</small>
        </div>
      </div>
      <div className="delta-map-viewport">
        <div className="delta-map-corner" />
        <div className="delta-map-columns" style={{ gridTemplateColumns: `repeat(${cells}, var(--map-cell-size))` }}>
          {columns.map((column) => <span key={column}>{column}</span>)}
        </div>
        <div className="delta-map-rows">
          {Array.from({ length: cells }, (_, index) => <span key={index}>{index + 1}</span>)}
        </div>
        <div className="delta-map-grid" style={{ gridTemplateColumns: `repeat(${cells}, var(--map-cell-size))` }}>
          {Array.from({ length: cells * cells }, (_, index) => {
            const row = Math.floor(index / cells) + 1;
            const column = (index % cells) + 1;
            const tile = tilesByCoordinate.get(`${row}:${column}`);
            const entity = entitiesByCoordinate.get(`${row}:${column}`);
            const relationship = entity ? normaliseDeltaRelationship(entity.side) : "";
            const className = `delta-map-cell ${tile?.kind ?? "open"} ${relationship}${tile?.kind === "access" ? ` ${tile.accessState ?? "closed"}` : ""}${selectedCell?.row === row && selectedCell.column === column ? " selected" : ""}`;
            const style = tile?.kind === "special" && tile.color ? { "--terrain-color": tile.color } as React.CSSProperties : undefined;
            const title = entity ? displayNames.get(entity.id) ?? entity.name : tile?.label || (tile?.kind === "access" ? `${tile.accessState ?? "closed"} access` : tile?.kind ?? "open");
            return <button className={className} style={style} key={`${row}:${column}`} type="button" onClick={() => setSelectedCell({ row, column })} title={title}>{entity && <i>{(displayNames.get(entity.id) ?? entity.name).slice(0, 1).toUpperCase()}</i>}</button>;
          })}
        </div>
      </div>
      {selectedCell && <div className="delta-map-tile-detail">
        <small>{selectedCoordinate}</small>
        <strong>{selectedTitle}</strong>
        {selectedTile?.label && selectedTile.kind !== "special" && <span>{selectedTile.label}</span>}
        {selectedTile?.kind === "special" && <span>Special terrain{selectedTile.color ? ` - ${selectedTile.color}` : ""}</span>}
      </div>}
      <div className="delta-map-key" aria-label="Map preview key">
        <span><i className="open" /> Open</span>
        <span><i className="solid" /> Solid</span>
        <span><i className="half" /> Half</span>
        <span><i className="special" /> Special</span>
        <span><i className="access closed" /> Closed access</span>
        <span><i className="access open" /> Open access</span>
        <span><i className="access locked" /> Locked access</span>
      </div>
    </div>
  );
}

function fitComposerTextarea(textarea: HTMLTextAreaElement | null) {
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

function keepComposerVisible(textarea: HTMLTextAreaElement | null) {
  if (!textarea || document.activeElement !== textarea) return;
  window.requestAnimationFrame(() => textarea.scrollIntoView({ block: "center", inline: "nearest" }));
  window.setTimeout(() => {
    if (document.activeElement === textarea) textarea.scrollIntoView({ block: "center", inline: "nearest" });
  }, 180);
}

function visiblePositionValue(value?: string) {
  if (!value || value.trim().toLowerCase() === "unset") return "";
  return value;
}

function entityPositionLabel(entity: DeltaEntity) {
  return [visiblePositionValue(entity.distanceFromPlayer), visiblePositionValue(entity.elevation)].filter(Boolean).join(", ");
}

function visibleDeltaStartContext(context: string) {
  return context
    .replace(/\n\nDELTA CONTINUITY ANCHORS:\n[\s\S]*?(?=\n\nPLAYER CHARACTER:|$)/, "")
    .replace(/\n\nPLAYER CHARACTER ID:\n[\s\S]*$/, "");
}

function textMentionsName(text: string, name: string) {
  const cleanName = name.trim();
  if (!cleanName) return false;
  const escaped = cleanName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}([^\\p{L}\\p{N}_]|$)`, "iu").test(text);
}

function isInvalidDeltaEntityName(value: string) {
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

function deltaRosterParticipants(text: string) {
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

function abstractDeltaRosterName(name: string) {
  return /\b(?:unknown|mysterious|unidentified|indistinct|shadowy)\b/i.test(name);
}

function normaliseDeltaBriefRoster(value: unknown): DeltaBriefRoster {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const cleanList = (input: unknown) => {
    if (!Array.isArray(input)) return [];
    const seen = new Set<string>();
    return input
      .map((item) => typeof item === "string" ? item.replace(/\s+/g, " ").trim() : "")
      .filter((item) => {
        const key = item.toLowerCase();
        if (!item || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  };
  const team = cleanList(source.team);
  const teamNames = new Set(team.map((name) => name.toLowerCase()));
  const neutral = cleanList(source.neutral).filter((name) => !teamNames.has(name.toLowerCase()));
  const occupied = new Set([...team, ...neutral].map((name) => name.toLowerCase()));
  const enemies = cleanList(source.enemies).filter((name) => !occupied.has(name.toLowerCase()));
  return { team, neutral, enemies };
}

function deltaBriefRosterFromContext(handoffContext = ""): DeltaBriefRoster {
  const roster = { team: [] as string[], neutral: [] as string[], enemies: [] as string[] };
  for (const participant of deltaRosterParticipants(handoffContext)) {
    const target = participant.side === "hostile" ? roster.enemies : participant.side === "neutral" ? roster.neutral : roster.team;
    if (!target.some((name) => name.toLowerCase() === participant.name.toLowerCase())) target.push(participant.name);
  }
  return roster;
}

function deltaBriefRosterLines(roster: DeltaBriefRoster) {
  return [
    ...roster.team.map((name) => `Ally: ${name}`),
    ...roster.neutral.map((name) => `Neutral: ${name}`),
    ...roster.enemies.map((name) => `Hostile: ${name}`)
  ];
}

function deltaContinuityWithoutRosterLines(handoffContext = "") {
  return handoffContext
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:player|your\s+team|team|allies?|ally|neutrals?|neutral|hostiles?|hostile|enemies|enemy)(?:\s+present)?\s*:/i.test(line))
    .join("\n")
    .trim();
}

function openRouterContent(text: string, images: { dataUrl: string; mimeType: string }[]) {
  if (!images.length) return text;
  return [
    { type: "text", text },
    ...images.map((image) => ({ type: "image_url", image_url: { url: image.dataUrl } }))
  ];
}

async function imageForOpenRouter(file: File) {
  if (!file.type.startsWith("image/")) throw new Error(`${file.name} is not an image.`);
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error(`Could not read ${file.name}.`));
      element.src = objectUrl;
    });
    const maxDimension = 1600;
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error(`Could not prepare ${file.name}.`);
    context.drawImage(image, 0, 0, width, height);
    return { dataUrl: canvas.toDataURL("image/jpeg", 0.86), mimeType: "image/jpeg" };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function messageHistoryText(message: Message, useCondensation = true) {
  const source = useCondensation && message.contextCondensation && message.contextCondensationSourceUpdatedAt === message.updatedAt
    ? message.contextCondensation
    : message.body;
  const body = message.role === "user" ? clarifyLeadingOocForModel(source) : source;
  return message.attachmentContext
    ? `${body}\n\n[Attachment context for this message:\n${message.attachmentContext}]`
    : body;
}

function clarifyLeadingOocForModel(text: string) {
  return text.trimStart().startsWith("((")
    ? `[Out-of-character user note. Treat this as real user-authored context/instruction, not as missing content.]\n${text}`
    : text;
}

function chatHistoryContent(history: Message[], currentMessageId: string | undefined, currentImages: { dataUrl: string; mimeType: string }[]) {
  return history.map((message) => ({
    role: (message.role === "system" ? "system" : message.role === "assistant" ? "assistant" : "user") as OpenRouterMessage["role"],
    content: message.id === currentMessageId && currentImages.length ? openRouterContent(clarifyLeadingOocForModel(message.body), currentImages) : messageHistoryText(message, message.id !== currentMessageId)
  }));
}

function auditSafeValue(value: unknown): unknown {
  if (typeof value === "string") {
    if (/^data:image\//i.test(value)) {
      const mimeType = value.slice(5, value.indexOf(";")) || "image";
      return `[${mimeType} attachment bytes omitted from local audit]`;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(auditSafeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, auditSafeValue(item)]));
  }
  return value;
}

async function storedMessageImages(messageId: string) {
  const attachments = await db.attachments.where("[ownerType+ownerId]").equals(["message", messageId]).toArray();
  return Promise.all(attachments.filter((attachment) => attachment.mimeType.startsWith("image/")).map((attachment) => imageForOpenRouter(new File([attachment.blob], attachment.name || "image", { type: attachment.mimeType }))));
}

function canReadChatFile(file: File) {
  return file.type.startsWith("text/") || /\.(txt|md|json|csv|log|yaml|yml|xml)$/i.test(file.name);
}

async function chatFileContext(files: File[]) {
  if (!files.length) return "";
  const unsupported = files.find((file) => !canReadChatFile(file));
  if (unsupported) throw new Error(`${unsupported.name} cannot be sent as chat text. Attach text, Markdown, JSON, CSV, log, YAML, or XML files here.`);
  const oversized = files.find((file) => file.size > 1_000_000);
  if (oversized) throw new Error(`${oversized.name} is too large to include in one chat reply. Keep attached text files under 1 MB.`);
  const contents = await Promise.all(files.map(async (file) => `# Attached file: ${file.name}\n${await file.text()}`));
  return `Attached files for this reply:\n${contents.join("\n\n")}`;
}

function renderInlineMarkdown(text: string, inventoryMarkers = false) {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\(\(.+?\)\)|\*\*\*.+?\*\*\*|\*\*.+?\*\*|\*[^*\n]+?\*|\[i\])/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    const key = `${match.index}-${token}`;
    if (token.startsWith("((") && token.endsWith("))")) {
      nodes.push(<span className="md-ooc" key={key}>{token.slice(2, -2)}</span>);
    } else if (token === "[i]") {
      nodes.push(inventoryMarkers ? <span className="md-inventory-marker" key={key}>[i]</span> : token);
    } else if (token.startsWith("***") && token.endsWith("***")) {
      nodes.push(<strong key={key}><em>{token.slice(3, -3)}</em></strong>);
    } else if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

const MarkdownText = memo(function MarkdownText({ text, emptyText, inventoryMarkers }: { text: string; emptyText?: string; inventoryMarkers?: boolean }) {
  const source = text || emptyText || "";
  if (!source) return null;
  return (
    <div className="markdown-text">
      {source.split(/\r?\n/).map((line, index) => {
        if (/^\s*---\s*$/.test(line)) return <hr key={index} />;
        const quote = /^(>{1,3})\s*(.*)$/.exec(line);
        if (quote) {
          const depth = quote[1].length;
          return <blockquote className={`md-quote depth-${depth}`} key={index}>{quote[2] ? renderInlineMarkdown(quote[2], inventoryMarkers) : "\u00a0"}</blockquote>;
        }
        const header = /^(#{1,3})\s+(.+)$/.exec(line);
        if (header) {
          const level = header[1].length;
          const Tag = (`h${level}` as "h1" | "h2" | "h3");
          return <Tag key={index}>{renderInlineMarkdown(header[2], inventoryMarkers)}</Tag>;
        }
        return <p key={index}>{line ? renderInlineMarkdown(line, inventoryMarkers) : "\u00a0"}</p>;
      })}
    </div>
  );
});

function LoadingSignal() {
  return <div className="lds-ellipsis" aria-label="Thinking" role="status"><div /><div /><div /><div /></div>;
}

const deltaRevealSpeedsMs = [1400, 1200, 1000, 850, 720, 600, 480, 360, 260, 180] as const;

function deltaRevealStepMs(speed?: number) {
  const index = Math.max(0, Math.min(deltaRevealSpeedsMs.length - 1, Math.round(speed ?? 5) - 1));
  return deltaRevealSpeedsMs[index];
}

function deltaRevealLines(text: string) {
  return text
    .split(/\r?\n/)
    .flatMap((line) => line.trim().split(/(?<=[.!?])\s+(?=["'“‘(*A-Z0-9])/))
    .filter((line) => line.trim().length > 0 && !/^---+$/.test(line.trim()));
}

function DeltaTurnText({
  text,
  animate = false,
  startDelayMs = 0,
  stepMs = deltaRevealStepMs(),
  onReveal
}: {
  text: string;
  animate?: boolean;
  startDelayMs?: number;
  stepMs?: number;
  onReveal?: () => void;
}) {
  const lines = deltaRevealLines(text);
  const [visibleLineCount, setVisibleLineCount] = useState(animate ? 0 : lines.length);
  useEffect(() => {
    if (!animate) {
      setVisibleLineCount(lines.length);
      return;
    }
    setVisibleLineCount(0);
    const timers = lines.map((_, index) => window.setTimeout(() => {
      setVisibleLineCount(index + 1);
      onReveal?.();
    }, startDelayMs + index * stepMs));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [text]);
  return (
    <div className="delta-turn-lines">
      {lines.slice(0, visibleLineCount).map((line, index) => (
        <div className="delta-turn-line" key={`${index}:${line}`}>
          <MarkdownText text={line} emptyText=" " inventoryMarkers />
        </div>
      ))}
    </div>
  );
}

function cinematicMarker() {
  return "\ud83c\udf9e\ufe0f";
}

function cleanDeltaCinematic(text: string) {
  return text.replace(/^\ud83c\udf9e\ufe0f\s*/, "");
}

function splitDeltaCinematic(text: string) {
  const lines = text.split(/\r?\n/);
  const cinematic: string[] = [];
  while (lines[0]?.trim().startsWith(cinematicMarker())) cinematic.push(lines.shift() ?? "");
  return { cinematic: cinematic.map(cleanDeltaCinematic).join("\n").trim(), turn: lines.join("\n").trim() };
}

type OpenRouterMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: unknown;
  tool_call_id?: string;
  tool_calls?: OpenRouterToolCall[];
};

type OpenRouterToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

type OpenRouterUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
};

type OpenRouterResponse = {
  choices?: {
    message?: {
      content?: string;
      tool_calls?: OpenRouterToolCall[];
    };
  }[];
  usage?: OpenRouterUsage;
};

type MemoryReviewCandidate = {
  text: string;
  tags: string[];
  reason: string;
  confidence: number;
};

type ContextCondensationCandidate = {
  id: string;
  text: string;
};

const contextCondensationMinimumCharacters = 400;
const contextCondensationRatio = 0.8;

function contextCondensationLimit(message: Message) {
  return Math.max(1, Math.floor(message.body.length * contextCondensationRatio));
}

function parseContextCondensations(text: string): ContextCondensationCandidate[] {
  try {
    const parsed = JSON.parse(extractJsonObject(text)) as { condensedMessages?: unknown };
    if (!Array.isArray(parsed.condensedMessages)) return [];
    return parsed.condensedMessages.map((value) => {
      const row = value as Record<string, unknown>;
      return {
        id: typeof row.id === "string" ? row.id : "",
        text: typeof row.text === "string" ? row.text.trim() : ""
      };
    }).filter((item) => item.id && item.text);
  } catch {
    return [];
  }
}

function parseMemoryReview(text: string): MemoryReviewCandidate[] {
  try {
    const parsed = JSON.parse(extractJsonObject(text)) as { memories?: unknown };
    if (!Array.isArray(parsed.memories)) return [];
    return parsed.memories.slice(0, 3).map((value) => {
      const row = value as Record<string, unknown>;
      return {
        text: typeof row.text === "string" ? row.text.trim() : "",
        tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean) : [],
        reason: typeof row.reason === "string" ? row.reason.trim() : "",
        confidence: Number.isFinite(Number(row.confidence)) ? Math.max(0, Math.min(1, Number(row.confidence))) : 0.5
      };
    }).filter((memory) => memory.text);
  } catch {
    return [];
  }
}

type DeltaImminentProposal = {
  brief: string;
  handoffContext?: string;
  playerCharacterName?: string;
  roster: DeltaBriefRoster;
  mapSize: DeltaMapSize;
  avoidLabel?: string;
  avoidPrompt?: string;
};

const characterTools = [
  {
    type: "function",
    function: {
      name: "find_characters",
      description: "Find character IDs by canonical character name within the active project before requesting a character division.",
      parameters: {
        type: "object",
        properties: {
          nameQuery: { type: "string", description: "Canonical name or partial name of the character to find." }
        },
        required: ["nameQuery"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_character_identity",
      description: "Return only the requested character identity division for a stable character ID.",
      parameters: {
        type: "object",
        properties: {
          characterId: { type: "string", description: "Stable character ID returned by find_characters." }
        },
        required: ["characterId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_character_bio",
      description: "Return only the requested character bio division for a stable character ID.",
      parameters: {
        type: "object",
        properties: {
          characterId: { type: "string", description: "Stable character ID returned by find_characters." }
        },
        required: ["characterId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_character_stats",
      description: "Return only the requested character stats division for a stable character ID.",
      parameters: {
        type: "object",
        properties: {
          characterId: { type: "string", description: "Stable character ID returned by find_characters." }
        },
        required: ["characterId"]
      }
    }
  }
] as const;

const inventoryTools = [
  {
    type: "function",
    function: {
      name: "update_inventory_item",
      description: "Add or subtract a quantity from the current chat inventory. Use a positive delta for gained items and a negative delta for spent/lost/removed items. Subtract only the amount used/lost; do not remove a whole stack unless the full quantity is gone. Item names should be singular stack names where possible.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["inventory", "currency"], description: "Use inventory for carried items/ammo/consumables and currency for the chat currency amount." },
          name: { type: "string", description: "Singular item stack name, or the currency name when kind is currency." },
          delta: { type: "number", description: "Quantity change. Example: -12 when 12 rounds are used, 32 when 32 rounds are picked up." },
          unitWeightKg: { type: "number", description: "Optional estimated weight in KG for one unit of this inventory item. Use only when known or strongly implied. Minimum precision is 0.01kg: never use values below 0.01kg or long decimals." },
          logSentence: { type: "string", description: "One terse narrative sentence explaining this exact inventory change and where it came from or went, such as 'Obtained Admin Key x 1 from Jaeger.' or 'Spent 9mm x 12 during the alley fight.'" }
        },
        required: ["kind", "name", "delta", "logSentence"]
      }
    }
  }
] as const;

const imageContextTools = [
  {
    type: "function",
    function: {
      name: "save_image_context",
      description: "Store a hidden, detailed visual extraction for the image attached to the current user message. Call this exactly once before replying normally. Use dense factual structured lines, not prose: medium/style, subjects and appearance, setting, actions, objects, composition, colours/lighting, visible text, notable details, and uncertainties. Do not include commentary, advice, or claims beyond the image.",
      parameters: {
        type: "object",
        properties: {
          context: { type: "string", description: "Detailed concise visual extraction in structured lines." }
        },
        required: ["context"]
      }
    }
  }
] as const;

const memoryTools = [
  {
    type: "function",
    function: {
      name: "save_memory",
      description: "Save or propose one durable memory using the project's memory instruction. Do not save transient scene actions, minor details, duplicates, or speculation.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "One durable memory fact that will remain useful later." },
          tags: { type: "array", items: { type: "string" }, description: "Relevant names, places, topics, or continuity tags." },
          reason: { type: "string", description: "Brief reason this is worth remembering." },
          confidence: { type: "number", description: "Confidence from 0 to 1." }
        },
        required: ["text", "tags", "reason", "confidence"]
      }
    }
  }
] as const;

const deltaImminentTools = [
  {
    type: "function",
    function: {
      name: "prepare_delta_engagement",
      description: "Create a pending Delta Mode imminent card when the main chat reaches a confrontation, mission commitment, fight, hostile standoff, or structured engagement. Do not use this for ordinary tension or casual disagreement.",
      parameters: {
        type: "object",
        properties: {
          brief: { type: "string", description: "One to three compact third-person sentences continuing the roleplay at the exact immediate place and moment. State what is physically happening and what forces the engagement. Prefer concrete information over atmospheric description. Do not write a cast list, mission synopsis, movie-trailer language, or assistant-facing explanation." },
          handoffContext: { type: "string", description: "Compact exact non-roster continuity anchors for Delta startup. Use separate terse lines beginning with Location:, Objective:, Situation:, or Constraint:. Preserve exact names, item codes, and facts. Participant membership belongs only in team, neutral, and enemies." },
          team: { type: "array", items: { type: "string" }, description: "Every allied participant physically involved, including the likely player character when appropriate. Use a canonical name or a concrete observable identity such as Armed woman or Grey wolf. Never use unknown, mysterious, unidentified, figure, shape, presence, or creature as an abstract identity." },
          neutral: { type: "array", items: { type: "string" }, description: "Concrete neutral participants physically involved. Use an empty list when there are none." },
          enemies: { type: "array", items: { type: "string" }, description: "Every opposing participant physically involved. Use canonical names where known; otherwise use concrete visible identities such as Scarred enforcer, Woman with shotgun, or Grey wolf. Distinguish multiples concretely. Never use unknown, mysterious, unidentified, figure, shape, presence, or creature as an abstract identity." },
          playerCharacterName: { type: "string", description: "Likely player-controlled character name, if known." },
          mapSize: { type: "string", enum: ["S", "M", "L", "XL", "XXL"], description: "Choose the engagement map boundary from the immediate scene: S = 30m, M = 50m, L = 80m, XL = 100m, XXL = 200m. This is the actual scene boundary, not a zoom level. Choose the smallest size that fairly contains the engagement and likely movement." },
          avoidLabel: { type: "string", description: "Button label for avoiding the engagement, usually Escape for danger or Cancel for a proposed mission." },
          avoidPrompt: { type: "string", description: "Short UI question asking what the player does to avoid or cancel the engagement." }
        },
        required: ["brief", "team", "neutral", "enemies", "mapSize"]
      }
    }
  }
] as const;

const deltaEntityTools = [
  {
    type: "function",
    function: {
      name: "set_delta_engagement_name",
      description: "Set the concise, in-world name for this active engagement. Use it once when an engagement begins, based on the location, activity, or case. Never call it Delta Mode, New Engagement, or Untitled Engagement.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "A concise in-world engagement title." }
        },
        required: ["title"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "set_delta_map",
      description: "Stage the active engagement's terrain map once, using only non-open tiles. Coordinates are one-based row/column positions within the fixed map boundary. Do not use this to place entities.",
      parameters: {
        type: "object",
        properties: {
          tiles: {
            type: "array",
            description: "Only terrain/access tiles that differ from open ground.",
            items: {
              type: "object",
              properties: {
                row: { type: "number", description: "One-based grid row." },
                column: { type: "number", description: "One-based grid column." },
                kind: { type: "string", enum: ["solid", "half", "special", "access"] },
                label: { type: "string", description: "Concrete terrain/object label, such as warehouse shelf, flooded channel, or security door." },
                color: { type: "string", description: "For special terrain only: a readable hex color chosen to suit the hazard, such as #3f83c5 for water or #5e9d68 for gas." },
                accessState: { type: "string", enum: ["open", "closed", "locked"], description: "For access only." }
              },
              required: ["row", "column", "kind"]
            }
          }
        },
        required: ["tiles"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_delta_job_categories",
      description: "List available Delta JOB categories for generated entities. Use this before selecting a JOB when categories exist.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "get_delta_jobs_for_category",
      description: "Return the JOB templates for one readable category. Pick a JOB label from this list when it fits the narrative.",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", description: "Readable JOB category name." }
        },
        required: ["category"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_delta_entity",
      description: "Create one current Delta entity only for a person, creature, or active participant. Never create entities from position/range/cover/status phrases; put those details in statusText, distanceFromPlayer, elevation, or map coordinates instead. Use saved characterId for known saved characters; otherwise apply readable PREFIX, BASE, and optional JOB labels from the project templates so generated stats are created. Do not invent hidden template IDs.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          side: { type: "string", enum: ["ally", "neutral", "hostile"] },
          characterId: { type: "string", description: "Optional saved character ID returned by find_characters." },
          prefix: { type: "string", description: "Optional readable PREFIX label, such as DEX." },
          base: { type: "string", description: "Optional readable BASE label, such as LIGHT." },
          job: { type: "string", description: "Optional readable JOB label, such as ROGUE." },
          jobCategory: { type: "string", description: "Optional readable JOB category used only to look up modifiers." },
          statusText: { type: "string" },
          distanceFromPlayer: { type: "string" },
          elevation: { type: "string" },
          mapRow: { type: "number", description: "One-based map row for this entity's current position." },
          mapColumn: { type: "number", description: "One-based map column for this entity's current position." }
        },
        required: ["name", "side"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "finish_delta_engagement",
      description: "Finish the current Delta engagement when its narrative outcome is resolved. This opens the proper finish, loot, archive, and parent-chat handoff flow. Do not write an assistant-style closing message instead.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "set_delta_player_entity",
      description: "Mark the current player-controlled entity for turn ownership. Use this after creating or linking the player character named by the Delta Brief.",
      parameters: {
        type: "object",
        properties: {
          entityId: { type: "string", description: "Entity ID returned by create_delta_entity or already present in the current entity list." }
        },
        required: ["entityId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "request_delta_roll",
      description: "Request authoritative client-generated dice results with the rolling entity's real stat modifier. For player rolls, Delta Mode waits for the user to click the required die. For NPC/ally/hostile/non-player rolls, the client rolls immediately, displays its own verified roll row, and returns the modified total. Never write or repeat a dice-result line in prose.",
      parameters: {
        type: "object",
        properties: {
          die: { type: "number", description: "Required die sides. Use 4, 6, 8, 9, 12, 20, or 100." },
          count: { type: "number", description: "How many of this die must be rolled. Defaults to 1." },
          label: { type: "string", description: "Short roleplay-facing roll label, such as initiative, lockpick, damage, or resist fear." },
          rollerName: { type: "string", description: "Name of the entity rolling, especially for NPC/ally/hostile rolls." },
          ability: { type: "string", enum: ["STR", "DEX", "CON", "INT", "WIS", "CHA", "NONE"], description: "Governing stat whose modifier the client must apply. Use NONE only when this roll genuinely has no stat modifier." }
        },
        required: ["die", "label", "ability"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "request_delta_reaction",
      description: "Check whether an active target can react to an incoming threat outside their turn. Call this after the initiating attack/check roll is known but before resolving damage or the final consequence. The client performs an authoritative 1d8 + DEX check against 6 and enforces one reaction attempt per entity per round. A successful player reaction pauses the current turn for the player's response.",
      parameters: {
        type: "object",
        properties: {
          targetEntityId: { type: "string", description: "Entity ID of the active entity threatened by the current action." },
          trigger: { type: "string", description: "One concise in-world description of the immediate threat being reacted to." }
        },
        required: ["targetEntityId", "trigger"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "request_delta_action",
      description: "Pause Delta Mode for the player's response using a short floating prompt. The prompt is UI state only and is not added to the transcript. Use this instead of writing 'what do you do' into the Delta log.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Short in-world prompt asking for the player's action." }
        },
        required: ["prompt"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "continue_delta_player_turn",
      description: "Post the addressed entity's brief cinematic reply and keep the current player's numbered turn open after a dialogue-only or communication-only entry. Use this only when the player spoke, signalled, or communicated without attempting movement, an attack, an interaction, an item use, a roll-worthy influence attempt, or another turn-consuming action. This is not a new turn.",
      parameters: {
        type: "object",
        properties: {
          cinematicReply: { type: "string", description: "Required concise in-world reply or immediate nonverbal response from the entity the player addressed. Do not include the cinematic marker." },
          prompt: { type: "string", description: "Optional short prompt indicating that the player's turn remains open." }
        },
        required: ["cinematicReply"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "apply_delta_damage",
      description: "Apply damage through the client after request_delta_roll returns a verified damage roll. The client subtracts the amount atomically, clamps HP at zero, and prevents the same roll receipt from damaging the same entity twice. Never calculate or overwrite currentHp yourself.",
      parameters: {
        type: "object",
        properties: {
          entityId: { type: "string", description: "Target entity ID from the current entity list." },
          amount: { type: "number", description: "Final positive whole-number damage amount to subtract." },
          rollReceiptId: { type: "string", description: "Receipt ID returned by the authoritative request_delta_roll result used for this damage." },
          zeroHpOutcome: { type: "string", enum: ["ko", "dead"], description: "State to apply if this damage reduces the target to 0 HP. Choose KO when the target remains alive but unable to act, or DEAD when the fiction establishes death." }
        },
        required: ["entityId", "amount", "rollReceiptId", "zeroHpOutcome"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_delta_entity",
      description: "Update an existing current Delta entity by entityId. Template values are readable labels only.",
      parameters: {
        type: "object",
        properties: {
          entityId: { type: "string" },
          name: { type: "string" },
          side: { type: "string", enum: ["ally", "neutral", "hostile"] },
          engagementState: { type: "string", enum: ["active", "ko", "dead", "escaped"], description: "Whether this entity can still take turns. Use escaped immediately when an entity leaves the engagement." },
          prefix: { type: "string" },
          base: { type: "string" },
          job: { type: "string" },
          jobCategory: { type: "string" },
          statusText: { type: "string" },
          maxHp: { type: "number", description: "Maximum HP only when it must be corrected." },
          initiative: { type: "number", description: "Initiative result used to order the entity list." },
          distanceFromPlayer: { type: "string" },
          elevation: { type: "string" },
          mapRow: { type: "number", description: "One-based map row for this entity's current position." },
          mapColumn: { type: "number", description: "One-based map column for this entity's current position." }
        },
        required: ["entityId"]
      }
    }
  }
] as const;

export function App() {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings());
  const [projects, setProjects] = useState<Project[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>();
  const [selectedChatId, setSelectedChatId] = useState<string>();
  const [route, setRoute] = useState<RouteName>("chat");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string>();
  const [projectEditInitialTab, setProjectEditInitialTab] = useState<"general" | "delta">("general");
  const [profileCharacterId, setProfileCharacterId] = useState<string>();
  const [models, setModels] = useState<{ modelId: string; cosmeticName: string }[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [gearOpen, setGearOpen] = useState(false);
  const [gearEditingCharacterId, setGearEditingCharacterId] = useState<string>();
  const [deltaOpen, setDeltaOpen] = useState(false);
  const [deltaProjectSettingsOpen, setDeltaProjectSettingsOpen] = useState(false);
  const [deltaSession, setDeltaSession] = useState<DeltaSession>();
  const [deltaMessages, setDeltaMessages] = useState<DeltaMessage[]>([]);
  const [deltaEntities, setDeltaEntities] = useState<DeltaEntity[]>([]);
  const [archivedDeltaSessions, setArchivedDeltaSessions] = useState<DeltaSession[]>([]);
  const [deltaAllyCache, setDeltaAllyCache] = useState<DeltaAllyCacheEntry[]>([]);
  const [deltaStartContext, setDeltaStartContext] = useState("");
  const [selectedChatActiveDelta, setSelectedChatActiveDelta] = useState<DeltaSession>();
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const editingProject = projects.find((project) => project.id === (editingProjectId ?? selectedProjectId));
  const selectedChat = chats.find((chat) => chat.id === selectedChatId);

  useEffect(() => {
    setDeltaOpen(false);
    setDeltaProjectSettingsOpen(false);
    setDeltaSession(undefined);
    setDeltaMessages([]);
    setDeltaEntities([]);
    setArchivedDeltaSessions([]);
    setDeltaAllyCache([]);
  }, [selectedChatId]);
  useEffect(() => {
    if (!deltaProjectSettingsOpen) return;
    const closeProjectSettingsFromHistory = (event: PopStateEvent) => {
      if (!(event.state as { mirrorDeltaProjectSettings?: boolean } | null)?.mirrorDeltaProjectSettings) setDeltaProjectSettingsOpen(false);
    };
    window.addEventListener("popstate", closeProjectSettingsFromHistory);
    return () => window.removeEventListener("popstate", closeProjectSettingsFromHistory);
  }, [deltaProjectSettingsOpen]);
  useEffect(() => {
    let alive = true;
    if (!selectedChatId) {
      setSelectedChatActiveDelta(undefined);
      return;
    }
    void db.deltaSessions.where("chatId").equals(selectedChatId).and((session) => session.active).first().then((session) => {
      if (alive) setSelectedChatActiveDelta(session);
    });
    return () => {
      alive = false;
    };
  }, [selectedChatId, deltaOpen, deltaSession?.updatedAt, chats]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (deltaProjectSettingsOpen || deltaOpen) {
        event.preventDefault();
        window.history.back();
      } else if (gearOpen) {
        event.preventDefault();
        setGearOpen(false);
      } else if (inventoryOpen) {
        event.preventDefault();
        setInventoryOpen(false);
      } else if (drawerOpen) {
        event.preventDefault();
        setDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deltaProjectSettingsOpen, deltaOpen, gearOpen, inventoryOpen, drawerOpen]);

  async function refresh() {
    const [nextSettings, nextProjects, unsortedChats] = await Promise.all([
      db.settings.get("settings"),
      db.projects.orderBy("orderIndex").toArray(),
      selectedProjectId ? db.chats.where("projectId").equals(selectedProjectId).toArray() : Promise.resolve([])
    ]);
    const nextChats = unsortedChats.sort((a, b) => b.updatedAt - a.updatedAt);
    setSettings(nextSettings ?? defaultSettings());
    setProjects(nextProjects);
    setChats(nextChats);
    const nextModels = await db.modelLibrary.orderBy("orderIndex").toArray();
    setModels(nextModels);
    setSelectedModelId((current) => nextSettings?.defaultModelId || current || nextModels[0]?.modelId || "");
    const activeChat = selectedChatId ? await db.chats.get(selectedChatId) : undefined;
    if (activeChat) {
      const rows = await db.messages
        .where("[chatId+branchId+sequence]")
        .between([activeChat.id, activeChat.activeBranchId, Dexie.minKey], [activeChat.id, activeChat.activeBranchId, Dexie.maxKey])
        .toArray();
      setMessages(rows.sort((a, b) => a.sequence - b.sequence));
    } else {
      setMessages([]);
    }
  }

  useEffect(() => {
    ensureSeedData().then(async () => {
      installAutomaticRecoverySnapshots();
      const first = await db.projects.orderBy("orderIndex").first();
      setSelectedProjectId(first?.id);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (!ready) return;
    refresh();
  }, [ready, selectedProjectId, selectedChatId]);

  useEffect(() => {
    function showUpdate() {
      setUpdateAvailable(true);
    }
    window.addEventListener("mirror:update-available", showUpdate);
    return () => window.removeEventListener("mirror:update-available", showUpdate);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.font = settings.font;
    document.documentElement.style.setProperty("--app-font-size", `${settings.fontScale ?? 16}px`);
    document.documentElement.style.setProperty("--entry-width", `${settings.entryWidth}%`);
    document.documentElement.style.setProperty("--message-gap", `${settings.messageSpacing}px`);
    document.documentElement.style.setProperty("--paragraph-gap", `${settings.paragraphSpacing ?? 4}px`);
    const tokens = accentTokens(accents.find((accent) => accent.name === settings.accent)?.value ?? accents[0].value);
    document.documentElement.style.setProperty("--accent", tokens.accent);
    document.documentElement.style.setProperty("--accent-fill", tokens.fill);
    document.documentElement.style.setProperty("--accent-contrast", tokens.contrast);
  }, [settings]);

  const projectChats = useMemo(() => chats.filter((chat) => chat.projectId === selectedProjectId), [chats, selectedProjectId]);
  const title = route === "chat"
    ? selectedProject?.name ?? "Choose a project"
    : selectedProject && ["stars", "archives", "archiveEntries", "characters", "characterProfile", "memories", "compaction", "sourceFiles"].includes(route)
      ? `${selectedProject.name} / ${routeLabels[route]}`
      : routeLabels[route];

  if (!ready) return <div className="loading">Mirror 2.0</div>;

  async function selectChat(id: string) {
    const activeChat = await db.chats.get(id);
    setSelectedChatId(id);
    if (!activeChat) {
      setMessages([]);
      return;
    }
    const [rows, nextChats] = await Promise.all([
      db.messages
        .where("[chatId+branchId+sequence]")
        .between([activeChat.id, activeChat.activeBranchId, Dexie.minKey], [activeChat.id, activeChat.activeBranchId, Dexie.maxKey])
        .toArray(),
      db.chats.where("projectId").equals(activeChat.projectId).toArray()
    ]);
    setChats(nextChats.sort((a, b) => b.updatedAt - a.updatedAt));
    setMessages(rows.sort((a, b) => a.sequence - b.sequence));
  }

  async function renameChat(id: string) {
    const chat = await db.chats.get(id);
    if (!chat) return;
    const nextTitle = prompt("Rename chat thread", chat.title)?.trim();
    if (!nextTitle || nextTitle === chat.title) return;
    await db.chats.update(id, { title: nextTitle, titleState: "manual", updatedAt: now() });
    await refresh();
  }

  async function deleteChat(id: string) {
    const chat = await db.chats.get(id);
    if (!chat) return;
    if (!confirm(`Delete chat thread "${chat.title}"? This removes its messages and stars.`)) return;
    await db.transaction("rw", [db.chats, db.branches, db.messages, db.stars, db.attachments, db.inventoryItems, db.inventoryLogs, db.deltaSessions, db.deltaMessages, db.deltaEntities, db.deltaAllyCache, db.deltaActionMacros], async () => {
      const deltaSessionIds = (await db.deltaSessions.where("chatId").equals(id).primaryKeys()) as string[];
      const messageIds = (await db.messages.where("chatId").equals(id).primaryKeys()) as string[];
      const attachmentIds = messageIds.length
        ? (await db.attachments.filter((attachment) => attachment.ownerType === "message" && messageIds.includes(attachment.ownerId)).primaryKeys()) as string[]
        : [];
      await db.stars.where("chatId").equals(id).delete();
      if (attachmentIds.length) await db.attachments.bulkDelete(attachmentIds);
      await db.messages.where("chatId").equals(id).delete();
      await db.branches.where("chatId").equals(id).delete();
      await db.inventoryItems.where("chatId").equals(id).delete();
      await db.inventoryLogs.where("chatId").equals(id).delete();
      if (deltaSessionIds.length) {
        await db.deltaMessages.where("sessionId").anyOf(deltaSessionIds).delete();
        await db.deltaEntities.where("sessionId").anyOf(deltaSessionIds).delete();
      }
      await db.deltaSessions.where("chatId").equals(id).delete();
      await db.deltaAllyCache.where("chatId").equals(id).delete();
      await db.deltaActionMacros.where("chatId").equals(id).delete();
      await db.chats.delete(id);
    });
    if (selectedChatId === id) {
      setSelectedChatId(undefined);
      setMessages([]);
    }
    await refresh();
  }

  async function toggleProjectPin(id: string) {
    const project = await db.projects.get(id);
    if (!project) return;
    await db.projects.update(id, { pinned: !project.pinned, updatedAt: now() });
    await refresh();
  }

  async function toggleChatPin(id: string) {
    const chat = await db.chats.get(id);
    if (!chat) return;
    await db.chats.update(id, { pinned: !chat.pinned, updatedAt: now() });
    await refresh();
  }

  async function openDeltaMode(chatOverride?: Chat, startContext = "", mapSize?: DeltaMapSize) {
    const activeChat = chatOverride ?? selectedChat;
    const activeProject = activeChat ? projects.find((project) => project.id === activeChat.projectId) : selectedProject;
    if (!activeProject || !activeChat) return;
    if (!activeProject.deltaEnabled || !activeProject.inventoryEnabled || !activeProject.gearEnabled) return;
    let session = startContext
      ? await getOrCreateDeltaSession(activeChat)
      : await db.deltaSessions.where("chatId").equals(activeChat.id).and((item) => item.active).first()
        ?? await db.deltaSessions.where("chatId").equals(activeChat.id).and((item) => !item.active).reverse().sortBy("updatedAt").then((items) => items[0]);
    if (!session) return;
    if (startContext && mapSize && session.mapSize !== mapSize) {
      const updatedAt = now();
      await db.deltaSessions.update(session.id, { mapSize, updatedAt });
      session = { ...session, mapSize, updatedAt };
    }
    const activeEntities = await db.deltaEntities.where("sessionId").equals(session.id).toArray();
    const linkedEntityNames = new Set(activeEntities.filter((entity) => entity.characterId).map((entity) => entity.name.trim().toLowerCase()));
    const malformedEntityIds = activeEntities
      .filter((entity) => !entity.characterId && (isInvalidDeltaEntityName(entity.name) || linkedEntityNames.has(entity.name.trim().toLowerCase())))
      .map((entity) => entity.id);
    if (malformedEntityIds.length) await db.deltaEntities.bulkDelete(malformedEntityIds);
    const selectedPlayerEntity = activeChat.deltaPlayerCharacterId
      ? activeEntities.find((entity) => entity.characterId === activeChat.deltaPlayerCharacterId)
      : undefined;
    if (selectedPlayerEntity && session.settings.playerEntityId !== selectedPlayerEntity.id) {
      const updatedAt = now();
      const settings = { ...session.settings, playerEntityId: selectedPlayerEntity.id };
      await db.deltaSessions.update(session.id, { settings, updatedAt });
      session = { ...session, settings, updatedAt };
    }
    const [nextMessages, nextEntities, archivedSessions, allyCache] = await Promise.all([
      db.deltaMessages.where("sessionId").equals(session.id).toArray(),
      db.deltaEntities.where("sessionId").equals(session.id).toArray(),
      db.deltaSessions.where("chatId").equals(activeChat.id).and((item) => !item.active).toArray(),
      db.deltaAllyCache.where("chatId").equals(activeChat.id).toArray()
    ]);
    setDeltaSession(session);
    setDeltaMessages(nextMessages.sort((a, b) => a.sequence - b.sequence));
    setDeltaEntities(nextEntities.sort((a, b) => a.orderIndex - b.orderIndex));
    setArchivedDeltaSessions(archivedSessions.sort((a, b) => b.updatedAt - a.updatedAt));
    setDeltaAllyCache(allyCache.sort((a, b) => b.updatedAt - a.updatedAt));
    setDeltaStartContext(startContext);
    setDeltaOpen(true);
    window.history.pushState({ mirrorDeltaMode: true }, "", window.location.href);
  }

  async function refreshDeltaMode() {
    if (!deltaSession) return;
    const [session, nextMessages, nextEntities, archivedSessions, allyCache] = await Promise.all([
      db.deltaSessions.get(deltaSession.id),
      db.deltaMessages.where("sessionId").equals(deltaSession.id).toArray(),
      db.deltaEntities.where("sessionId").equals(deltaSession.id).toArray(),
      db.deltaSessions.where("chatId").equals(deltaSession.chatId).and((item) => !item.active).toArray(),
      db.deltaAllyCache.where("chatId").equals(deltaSession.chatId).toArray()
    ]);
    if (session) setDeltaSession(session);
    setDeltaMessages(nextMessages.sort((a, b) => a.sequence - b.sequence));
    setDeltaEntities(nextEntities.sort((a, b) => a.orderIndex - b.orderIndex));
    setArchivedDeltaSessions(archivedSessions.sort((a, b) => b.updatedAt - a.updatedAt));
    setDeltaAllyCache(allyCache.sort((a, b) => b.updatedAt - a.updatedAt));
  }

  async function applyUpdate() {
    const registration = await navigator.serviceWorker?.getRegistration?.("./");
    if (!registration?.waiting) {
      location.reload();
      return;
    }
    navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
  }

  return (
    <div className="app-shell">
      {updateAvailable && (
        <div className="update-banner">
          <span>Update available</span>
          <button onClick={applyUpdate}>Reload</button>
          <button className="icon-button" onClick={() => setUpdateAvailable(false)} aria-label="Dismiss update notice"><X size={16} /></button>
        </div>
      )}
      <Header
        title={title}
        subtitle={route === "chat" ? selectedChat?.title : undefined}
        contextNote={route === "chat" && selectedChat?.infiniteHistoryLocked ? "⚠︎ infinite context" : undefined}
        onMenu={() => setDrawerOpen(true)}
        right={route === "chat" && selectedProject ? (
          <div className="header-actions">
            {selectedProject.inventoryEnabled && (
              <button className="inventory-trigger" onClick={() => setInventoryOpen(true)} aria-label="Open inventory" title="Inventory">
                <ShoppingBag size={19} />
              </button>
            )}
            {selectedProject.gearEnabled && (
              <button className="inventory-trigger" onClick={() => setGearOpen(true)} aria-label="Open gear" title="Gear">
                <Shield size={19} />
              </button>
            )}
            {selectedChat && selectedProject.deltaEnabled && selectedProject.inventoryEnabled && selectedProject.gearEnabled && (
              <button className={`inventory-trigger ${selectedChatActiveDelta ? "active" : ""}`} type="button" onClick={() => openDeltaMode()} aria-label="Open Delta Mode" title="Delta Mode">
                <Swords size={19} />
              </button>
            )}
          </div>
        ) : undefined}
      />
      {selectedProject && selectedChat && (
        <InventoryDrawer
          open={inventoryOpen}
          project={selectedProject}
          chat={selectedChat}
          elevated={deltaOpen}
          onClose={() => setInventoryOpen(false)}
          onRefresh={refresh}
        />
      )}
      {selectedProject && selectedChat && (
        <GearDrawer
          open={gearOpen}
          project={selectedProject}
          chat={selectedChat}
          elevated={deltaOpen}
          onOpenCharacter={(id) => {
            setGearEditingCharacterId(id);
          }}
          onClose={() => setGearOpen(false)}
          onRefresh={refresh}
        />
      )}
      {selectedProject && gearEditingCharacterId && (
        <div className="modal-backdrop gear-character-modal" onClick={() => setGearEditingCharacterId(undefined)}>
          <section className="gear-character-editor-shell" onClick={(event) => event.stopPropagation()}>
            <CharacterProfilePage
              project={selectedProject}
              characterId={gearEditingCharacterId}
              onBack={() => setGearEditingCharacterId(undefined)}
              onDeleted={() => setGearEditingCharacterId(undefined)}
            />
          </section>
        </div>
      )}
      {selectedProject && selectedChat && deltaOpen && deltaSession && (
        <DeltaModeWorkspace
          project={selectedProject}
          chat={selectedChat}
          settings={settings}
          selectedModelId={selectedModelId}
          session={deltaSession}
          messages={deltaMessages}
          entities={deltaEntities}
          archivedSessions={archivedDeltaSessions}
          allyCache={deltaAllyCache}
          startContext={deltaStartContext}
          onStartContextConsumed={() => setDeltaStartContext("")}
          onOpenInventory={() => setInventoryOpen(true)}
          onOpenProjectDeltaSettings={() => {
            setEditingProjectId(selectedProject.id);
            setProjectEditInitialTab("delta");
            setDeltaProjectSettingsOpen(true);
            window.history.pushState({ ...window.history.state, mirrorDeltaProjectSettings: true }, "", window.location.href);
          }}
          onClose={() => setDeltaOpen(false)}
          onRefresh={refreshDeltaMode}
        />
      )}
      {selectedProject && deltaOpen && deltaProjectSettingsOpen && (
        <section className="delta-project-settings-layer">
          <ProjectEditPage
            key={`${selectedProject.id}:delta-overlay`}
            project={selectedProject}
            initialTab="delta"
            onRefresh={refresh}
            onDone={() => {
              if (window.history.state?.mirrorDeltaProjectSettings) window.history.back();
              else setDeltaProjectSettingsOpen(false);
            }}
          />
        </section>
      )}
      <Drawer
        open={drawerOpen}
        projects={projects}
        selectedProjectId={selectedProjectId}
        chats={projectChats}
        selectedChatId={selectedChatId}
        onClose={() => setDrawerOpen(false)}
        onRoute={(nextRoute) => {
          if (nextRoute === "projectEdit") {
            setEditingProjectId(selectedProjectId);
            setProjectEditInitialTab("general");
          }
          setRoute(nextRoute);
          setDrawerOpen(false);
        }}
        onProject={(id) => {
          setSelectedProjectId(id);
          setSelectedChatId(undefined);
          setRoute("chat");
          setDrawerOpen(false);
        }}
        onChat={(id) => {
          void selectChat(id);
          setRoute("chat");
          setDrawerOpen(false);
        }}
        onRenameChat={renameChat}
        onDeleteChat={deleteChat}
        onToggleProjectPin={toggleProjectPin}
        onToggleChatPin={toggleChatPin}
      />
      <main className="screen">
        {route === "chat" && (
          <ChatScreen
            project={selectedProject}
            chat={selectedChat}
            messages={messages}
            settings={settings}
            onRefresh={refresh}
            onChatCreated={selectChat}
            onRoute={setRoute}
            selectedModelId={selectedModelId}
            models={models}
            deltaLocked={Boolean(selectedChatActiveDelta)}
            onOpenDelta={(chatOverride, startContext, mapSize) => openDeltaMode(chatOverride, startContext, mapSize)}
            onSettingsSaved={async (modelId) => {
              setSelectedModelId(modelId);
              await refresh();
            }}
          />
        )}
        {route === "projects" && <ProjectsPage projects={projects} selectedProjectId={selectedProjectId} onSelect={setSelectedProjectId} onEdit={(id) => { setEditingProjectId(id); setProjectEditInitialTab("general"); setRoute("projectEdit"); }} onRefresh={refresh} />}
        {route === "projectEdit" && editingProject && <ProjectEditPage key={`${editingProject.id}:${projectEditInitialTab}`} project={editingProject} initialTab={projectEditInitialTab} onRefresh={refresh} onDone={() => setRoute("projects")} />}
        {route === "stars" && <StarsPage project={selectedProject} />}
        {route === "archives" && <ArchivesPage project={selectedProject} />}
        {route === "characters" && <CharactersPage project={selectedProject} onOpenProfile={(id) => { setProfileCharacterId(id); setRoute("characterProfile"); }} />}
        {route === "characterProfile" && selectedProject && profileCharacterId && <CharacterProfilePage project={selectedProject} characterId={profileCharacterId} onBack={() => setRoute("characters")} onDeleted={() => { setProfileCharacterId(undefined); setRoute("characters"); }} />}
        {route === "memories" && <MemoriesPage project={selectedProject} />}
        {route === "compaction" && selectedChat && <CompactionPage chat={selectedChat} onRefresh={refresh} />}
        {route === "sourceFiles" && <SourceFilesPage project={selectedProject} />}
        {route === "settings" && <SettingsPage settings={settings} onRefresh={refresh} />}
      </main>
    </div>
  );
}

function Header({ title, subtitle, contextNote, onMenu, right }: { title: string; subtitle?: string; contextNote?: string; onMenu: () => void; right?: React.ReactNode }) {
  return (
    <header className="topbar">
      <button className="icon-button" onClick={onMenu} aria-label="Open navigation">
        <Menu size={22} />
      </button>
      <div className="brand-mini">
        <MothMark />
        <div className="title-stack"><strong>{title}</strong>{(subtitle || contextNote) && <div className="title-meta">{subtitle && <span>{subtitle}</span>}{contextNote && <small>{contextNote}</small>}</div>}</div>
      </div>
      <div className="header-right">{right}</div>
    </header>
  );
}

function InventoryDrawer({ open, project, chat, elevated, onClose, onRefresh }: { open: boolean; project: Project; chat: Chat; elevated?: boolean; onClose: () => void; onRefresh: () => Promise<void> }) {
  const [tab, setTab] = useState<"inventory" | "log">("inventory");
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [logs, setLogs] = useState<InventoryLog[]>([]);
  const [currencyAmount, setCurrencyAmount] = useState(chat.currencyAmount?.toString() ?? "");
  const [saved, showSaved] = useSavedNotice();
  useEffect(() => {
    setCurrencyAmount(chat.currencyAmount?.toString() ?? "");
    setTab("inventory");
  }, [chat.id, chat.currencyAmount, project.inventoryEnabled]);
  async function load() {
    const [nextItems, nextLogs] = await Promise.all([
      db.inventoryItems.where("chatId").equals(chat.id).toArray(),
      db.inventoryLogs.where("chatId").equals(chat.id).reverse().sortBy("updatedAt")
    ]);
    setItems(nextItems.sort((a, b) => a.kind.localeCompare(b.kind) || a.createdAt - b.createdAt));
    setLogs(nextLogs);
  }
  useEffect(() => { if (open) load(); }, [open, chat.id]);
  if (!open) return null;
  const shownItems = items.filter((item) => item.kind === "inventory");
  async function saveCurrency() {
    await db.chats.update(chat.id, { currencyAmount: currencyAmount === "" ? undefined : Number(currencyAmount), updatedAt: now() });
    showSaved();
    await onRefresh();
  }
  async function addItem(kind: InventoryKind) {
    const timestamp = now();
    await db.inventoryItems.add({ id: uid(), projectId: project.id, chatId: chat.id, kind, name: "", normalisedName: "", quantity: 1, createdAt: timestamp, updatedAt: timestamp });
    await load();
  }
  return (
    <>
      <button className={`drawer-backdrop ${elevated ? "elevated" : ""}`} onClick={onClose} aria-label="Close inventory" />
      <aside className={`inventory-drawer ${elevated ? "delta-inventory" : ""}`}>
        <div className="section-title">
          <h2>Inventory</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close inventory"><X size={20} /></button>
        </div>
        <div className="settings-tabs inventory-tabs">
          {project.inventoryEnabled && <button className={tab === "inventory" ? "picked" : ""} onClick={() => setTab("inventory")}>Items</button>}
          <button className={tab === "log" ? "picked" : ""} onClick={() => setTab("log")}>Log</button>
        </div>
        {tab === "inventory" && project.inventoryEnabled && (
          <div className="stack">
            {project.currencyName && <div className="currency-row"><input type="number" value={currencyAmount} onChange={(event) => setCurrencyAmount(event.target.value)} /><span>{project.currencyName}</span><button onClick={saveCurrency}><Save size={16} /></button>{saved && <span className="save-status">Saved</span>}</div>}
            {shownItems.map((item) => <InventoryItemRow key={item.id} item={item} onRefresh={load} />)}
            <button onClick={() => addItem("inventory")}><Plus size={18} /> Add item</button>
          </div>
        )}
        {tab === "log" && <InventoryLogList logs={logs} onRefresh={load} />}
      </aside>
    </>
  );
}

function InventoryItemRow({ item, onRefresh }: { item: InventoryItem; onRefresh: () => Promise<void> }) {
  const [name, setName] = useState(item.name);
  const [quantity, setQuantity] = useState(item.quantity);
  const [totalWeightKg, setTotalWeightKg] = useState(formatInventoryKg((item.unitWeightKg ?? 0) * item.quantity));
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pressTimer, setPressTimer] = useState<number>();
  useEffect(() => {
    setName(item.name);
    setQuantity(item.quantity);
    setTotalWeightKg(formatInventoryKg((item.unitWeightKg ?? 0) * item.quantity));
  }, [item.id, item.name, item.quantity, item.unitWeightKg]);
  function startPress() {
    window.clearTimeout(pressTimer);
    setPressTimer(window.setTimeout(() => setDeleteOpen(true), 520));
  }
  function cancelPress() {
    window.clearTimeout(pressTimer);
  }
  async function save(nextQuantity = quantity, nextTotalWeightKg = totalWeightKg) {
    const singular = normaliseInventoryName(name);
    if (Math.max(0, nextQuantity) === 0) {
      setQuantity(0);
      setDeleteOpen(true);
      return;
    }
    const safeQuantity = Math.max(0, nextQuantity);
    const parsedWeight = Number(nextTotalWeightKg);
    const unitWeightKg = Number.isFinite(parsedWeight) && parsedWeight > 0 && safeQuantity > 0
      ? parsedWeight / safeQuantity
      : undefined;
    await db.inventoryItems.update(item.id, { name: singular, normalisedName: singular, quantity: safeQuantity, unitWeightKg, updatedAt: now() });
    await onRefresh();
  }
  async function changeQuantity(nextQuantity: number) {
    const next = Math.max(0, nextQuantity);
    setQuantity(next);
    const nextTotal = formatInventoryKg((item.unitWeightKg ?? readUnitWeightKg(totalWeightKg, quantity)) * next);
    setTotalWeightKg(nextTotal);
    await save(next, nextTotal);
  }
  async function remove() {
    await db.inventoryItems.delete(item.id);
    setDeleteOpen(false);
    await onRefresh();
  }
  return (
    <div className="inventory-item-wrap">
      <div className="inventory-row">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => save()}
          onPointerDown={startPress}
          onPointerUp={cancelPress}
          onPointerLeave={cancelPress}
          placeholder={item.kind === "gear" ? "gear name" : "item name"}
        />
        <input className="inventory-weight-input" type="number" min={0.01} step={0.01} value={totalWeightKg} onChange={(event) => setTotalWeightKg(event.target.value)} onBlur={() => save()} aria-label={`${name || "item"} total KG`} />
        <span className="inventory-kg-label">kg</span>
        <button onClick={() => void changeQuantity(quantity - 1)}>-</button>
        <input type="number" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} onBlur={() => void changeQuantity(quantity)} />
        <button onClick={() => void changeQuantity(quantity + 1)}>+</button>
      </div>
      {deleteOpen && (
        <div className="modal-backdrop inventory-confirm-backdrop" onClick={() => { setDeleteOpen(false); if (quantity === 0) setQuantity(item.quantity || 1); }}>
          <section className="confirm-modal inventory-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <h2>Delete Item</h2>
            <p>{quantity === 0 ? "Quantity is 0. Delete this item?" : `Delete ${name || "this item"}?`}</p>
            <div className="split-actions">
              <button className="danger" onClick={remove}>Delete</button>
              <button onClick={() => { setDeleteOpen(false); if (quantity === 0) setQuantity(item.quantity || 1); }}>Cancel</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function DeltaVerifiedRollRow({
  message,
  relationship,
  expanded,
  onToggle,
  animate = false,
  revealDelayMs = 0,
  onReveal
}: {
  message: DeltaMessage;
  relationship: "ally" | "neutral" | "hostile";
  expanded: boolean;
  onToggle: () => void;
  animate?: boolean;
  revealDelayMs?: number;
  onReveal?: () => void;
}) {
  const receipt = message.rollReceipt;
  const [visible, setVisible] = useState(!animate);
  useEffect(() => {
    if (!animate) {
      setVisible(true);
      return;
    }
    setVisible(false);
    const timer = window.setTimeout(() => {
      setVisible(true);
      onReveal?.();
    }, revealDelayMs);
    return () => window.clearTimeout(timer);
  }, [message.id]);
  if (!receipt) return null;
  if (!visible) return null;
  const toolArguments = {
    die: receipt.die,
    count: receipt.count,
    label: receipt.label,
    rollerName: receipt.rollerName,
    ability: receipt.ability ?? "NONE"
  };
  return (
    <article className={`delta-log-row delta-roll-event ${relationship}`}>
      <span className="delta-log-number delta-roll-marker" aria-label="App-generated dice roll">🎲</span>
      <div className="delta-roll-event-content">
        <button type="button" className="delta-roll-summary" onClick={onToggle} aria-expanded={expanded} aria-label={`${message.body}. Show client roll receipt`}>
          <span>{message.body}</span>
        </button>
        {expanded && (
          <div className="delta-roll-audit">
            <div className="delta-roll-audit-heading"><strong>Client roll receipt</strong><span>{receipt.id}</span></div>
            <dl>
              <div><dt>Tool</dt><dd>{receipt.toolName}</dd></div>
              <div><dt>Request</dt><dd><code>{JSON.stringify(toolArguments)}</code></dd></div>
              <div><dt>Generator</dt><dd>{receipt.generator}</dd></div>
              <div><dt>Method</dt><dd>{receipt.algorithm}</dd></div>
              <div><dt>Accepted uint32</dt><dd>{receipt.rawValues.join(", ")}</dd></div>
              <div><dt>Raw dice</dt><dd>{receipt.results.join(", ")}</dd></div>
              {receipt.ability && <div><dt>Stat modifier</dt><dd>{receipt.ability} {receipt.modifier !== undefined && receipt.modifier >= 0 ? "+" : ""}{receipt.modifier ?? 0}</dd></div>}
              {receipt.total !== undefined && <div><dt>Total</dt><dd>{receipt.total}</dd></div>}
              <div><dt>Generated</dt><dd>{new Date(receipt.generatedAt).toLocaleString()}</dd></div>
              {receipt.hpApplications?.map((application) => (
                <div key={`${application.entityId}:${application.appliedAt}`}>
                  <dt>HP applied</dt>
                  <dd>{application.entityName}: {application.beforeHp} - {application.amount} = {application.afterHp}</dd>
                </div>
              ))}
            </dl>
            <pre>{`crypto.getRandomValues(uint32)\nlimit = 2^32 - (2^32 % ${receipt.die})\naccept only uint32 < limit\nresult = (uint32 % ${receipt.die}) + 1`}</pre>
            <p>This receipt was created by the client at the same point the random values were generated. It was not parsed from AI-written text.</p>
          </div>
        )}
      </div>
    </article>
  );
}

function DeltaModeWorkspace({
  project,
  chat,
  settings,
  selectedModelId,
  session,
  messages,
  entities,
  archivedSessions,
  allyCache,
  startContext,
  onStartContextConsumed,
  onOpenInventory,
  onOpenProjectDeltaSettings,
  onClose,
  onRefresh
}: {
  project: Project;
  chat: Chat;
  settings: AppSettings;
  selectedModelId: string;
  session: DeltaSession;
  messages: DeltaMessage[];
  entities: DeltaEntity[];
  archivedSessions: DeltaSession[];
  allyCache: DeltaAllyCacheEntry[];
  startContext?: string;
  onStartContextConsumed: () => void;
  onOpenInventory: () => void;
  onOpenProjectDeltaSettings: () => void;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [activeTool, setActiveTool] = useState<"entities" | "map" | "inventory" | "history" | "actions" | undefined>();
  const [archiveSettingsOpen, setArchiveSettingsOpen] = useState(false);
  const [actionsEditMode, setActionsEditMode] = useState(false);
  const [entitySettingsOpen, setEntitySettingsOpen] = useState(false);
  const [entitySettingsTab, setEntitySettingsTab] = useState<"entities" | "ally-cache">("entities");
  const [cacheEditId, setCacheEditId] = useState<string>();
  const [cacheDraftTag, setCacheDraftTag] = useState("");
  const [cacheImportStatus, setCacheImportStatus] = useState("");
  const [clearCacheOpen, setClearCacheOpen] = useState(false);
  const [finishPacket, setFinishPacket] = useState<DeltaFinishPacket>();
  const [finishLootRoll, setFinishLootRoll] = useState<number>();
  const [finishCurrencyRoll, setFinishCurrencyRoll] = useState<{ dice: number[]; amount: number }>();
  const [finishCurrencyPicked, setFinishCurrencyPicked] = useState(0);
  const [finishAwaitingLootRoll, setFinishAwaitingLootRoll] = useState(false);
  const [finishLoading, setFinishLoading] = useState(false);
  const [finishError, setFinishError] = useState("");
  const [deltaBusy, setDeltaBusy] = useState(false);
  const [forfeitConfirmOpen, setForfeitConfirmOpen] = useState(false);
  const [expandedEntityId, setExpandedEntityId] = useState<string>();
  const [expandedRollId, setExpandedRollId] = useState<string>();
  const [projectCharacters, setProjectCharacters] = useState<Character[]>([]);
  const [actionCharacterId, setActionCharacterId] = useState("");
  const [actionSlots, setActionSlots] = useState<CharacterActionSlot[]>([]);
  const [selectedActionSlotId, setSelectedActionSlotId] = useState("");
  const [actionMacros, setActionMacros] = useState<CharacterActionMacro[]>([]);
  const [settingsDraft, setSettingsDraft] = useState(session.settings);
  const [settingsLeaveOpen, setSettingsLeaveOpen] = useState(false);
  const [playerCharacterId, setPlayerCharacterId] = useState(chat.deltaPlayerCharacterId ?? "");
  const [previewSession, setPreviewSession] = useState<DeltaSession>();
  const [previewMessages, setPreviewMessages] = useState<DeltaMessage[]>([]);
  const [previewEntities, setPreviewEntities] = useState<DeltaEntity[]>([]);
  const [pendingEntityMacro, setPendingEntityMacro] = useState<CharacterActionMacro>();
  const [selectedEntityIds, setSelectedEntityIds] = useState<Set<string>>(new Set());
  const [macroDraft, setMacroDraft] = useState<{
    macro?: CharacterActionMacro;
    parentId?: string;
    folder: boolean;
    label: string;
    template: string;
    requestEntitySelection: boolean;
  }>();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const turnQueueRef = useRef<HTMLDivElement>(null);
  const deltaBodyRef = useRef<HTMLDivElement>(null);
  const deltaRevealSessionRef = useRef("");
  const deltaMessageSignaturesRef = useRef<Map<string, string>>(new Map());
  const stagedStartContextRef = useRef("");
  const deltaBusyRef = useRef(false);
  const pendingSettingsNavigationRef = useRef<() => void>(() => undefined);
  const [turnQueueEdges, setTurnQueueEdges] = useState({ left: false, right: false });
  const [saved, showSaved] = useSavedNotice();
  if (deltaRevealSessionRef.current !== session.id) {
    deltaRevealSessionRef.current = session.id;
    deltaMessageSignaturesRef.current = new Map(messages.map((message) => [message.id, `${message.status}:${message.body}`]));
  }
  const revealMessageIds = new Set(messages
    .filter((message) => deltaMessageSignaturesRef.current.get(message.id) !== `${message.status}:${message.body}`)
    .map((message) => message.id));
  useEffect(() => {
    deltaMessageSignaturesRef.current = new Map(messages.map((message) => [message.id, `${message.status}:${message.body}`]));
  }, [session.id, messages]);
  const archiveLimitOptions = [0, 1, 3, 5, 8, 12, 16, 20, 30, 40, 50, Infinity];
  function updateTurnQueueEdges() {
    const element = turnQueueRef.current;
    if (!element) {
      setTurnQueueEdges({ left: false, right: false });
      return;
    }
    const maxScroll = element.scrollWidth - element.clientWidth;
    setTurnQueueEdges({
      left: element.scrollLeft > 2,
      right: maxScroll > 2 && element.scrollLeft < maxScroll - 2
    });
  }
  function scrollDeltaToLatest() {
    window.requestAnimationFrame(() => {
      const element = deltaBodyRef.current;
      if (element) element.scrollTop = element.scrollHeight;
    });
  }
  useEffect(() => {
    updateTurnQueueEdges();
    window.addEventListener("resize", updateTurnQueueEdges);
    return () => window.removeEventListener("resize", updateTurnQueueEdges);
  }, [session.id, session.turnIndex, entities.length]);
  useEffect(() => {
    const composer = composerRef.current;
    fitComposerTextarea(composer);
    keepComposerVisible(composer);
  }, [body]);
  useEffect(() => {
    const handleViewportChange = () => {
      fitComposerTextarea(composerRef.current);
      keepComposerVisible(composerRef.current);
    };
    window.visualViewport?.addEventListener("resize", handleViewportChange);
    window.visualViewport?.addEventListener("scroll", handleViewportChange);
    return () => {
      window.visualViewport?.removeEventListener("resize", handleViewportChange);
      window.visualViewport?.removeEventListener("scroll", handleViewportChange);
    };
  }, []);
  useEffect(() => setSettingsDraft(session.settings), [session.id]);
  useEffect(() => setPlayerCharacterId(chat.deltaPlayerCharacterId ?? ""), [chat.id, chat.deltaPlayerCharacterId]);
  useEffect(() => {
    if (!startContext || messages.length > 0) return;
    const startKey = `${session.id}:${startContext}`;
    if (stagedStartContextRef.current === startKey) return;
    stagedStartContextRef.current = startKey;
    const handoff = startContext;
    onStartContextConsumed();
    void addDeltaMessage(session.id, "system", visibleDeltaStartContext(handoff)).then(async () => {
      const playerCharacterId = handoff.match(/PLAYER CHARACTER ID:\s*([^\n]+)/i)?.[1]?.trim();
      const timestamp = now();
      let nextOrderIndex = (await db.deltaEntities.where("sessionId").equals(session.id).count());
      if (playerCharacterId) {
        const character = await db.characters.get(playerCharacterId);
        const existing = await db.deltaEntities.where("sessionId").equals(session.id).and((entity) => entity.characterId === playerCharacterId).first();
        if (character && character.projectId === project.id && !existing) {
          await db.deltaEntities.add({ id: uid(), sessionId: session.id, ...(await characterStatsPatch(character)), side: "ally", statusText: "Entering engagement.", distanceFromPlayer: "0m", elevation: "", orderIndex: nextOrderIndex, createdAt: timestamp, updatedAt: timestamp });
          nextOrderIndex += 1;
        }
      }
      const savedCharacters = await db.characters.where("projectId").equals(project.id).toArray();
      for (const character of savedCharacters) {
        if (!textMentionsName(handoff, character.name)) continue;
        const existing = await db.deltaEntities.where("sessionId").equals(session.id).and((entity) => entity.characterId === character.id).first();
        if (existing) continue;
        await db.deltaEntities.add({ id: uid(), sessionId: session.id, ...(await characterStatsPatch(character)), side: "ally", statusText: "Entering engagement.", distanceFromPlayer: "", elevation: "", orderIndex: nextOrderIndex, createdAt: timestamp, updatedAt: timestamp });
        nextOrderIndex += 1;
      }
      for (const participant of deltaRosterParticipants(handoff)) {
        const savedCharacter = savedCharacters.find((character) => character.name.trim().toLowerCase() === participant.name.trim().toLowerCase());
        if (savedCharacter) continue;
        const existing = await db.deltaEntities
          .where("sessionId")
          .equals(session.id)
          .and((entity) => !entity.characterId && entity.name.trim().toLowerCase() === participant.name.trim().toLowerCase())
          .first();
        if (existing) continue;
        const stats = generatedStatsPatch(project, {});
        await db.deltaEntities.add({
          id: uid(),
          sessionId: session.id,
          ...stats,
          name: participant.name,
          side: participant.side,
          statusText: "Entering engagement.",
          distanceFromPlayer: "",
          elevation: "",
          orderIndex: nextOrderIndex,
          createdAt: timestamp,
          updatedAt: timestamp
        });
        nextOrderIndex += 1;
      }
      return submitDeltaTurn(handoff, {
        hideUser: true,
        stageEngagement: true,
        instruction: "Start this Delta engagement from the main-chat handoff. Do not place the handoff text in the user's composer. First stage the engagement, then write turn 1 as a concise roleplay-facing opening that explicitly names who is involved, what is happening, where it is happening, and why it matters. The client may have already created saved-character entities mentioned in the handoff; keep them, update them if needed, and do not recreate duplicates. Add only missing participants from the handoff. End by calling for initiative and stop there."
      });
    }).then(async (started) => {
      if (!started) return;
      const playerCharacterId = handoff.match(/PLAYER CHARACTER ID:\s*([^\n]+)/i)?.[1]?.trim();
      const playerName = handoff.match(/PLAYER CHARACTER:\s*([^\n]+)/i)?.[1]?.trim().toLocaleLowerCase();
      const nextSettings = { ...session.settings };
      if (playerCharacterId && !nextSettings.playerEntityId) {
        const stagedEntity = await db.deltaEntities.where("sessionId").equals(session.id).and((entity) => entity.characterId === playerCharacterId).first();
        if (stagedEntity) nextSettings.playerEntityId = stagedEntity.id;
      }
      if (playerName && !nextSettings.playerEntityId) {
        const stagedEntities = await db.deltaEntities.where("sessionId").equals(session.id).toArray();
        const matched = stagedEntities.find((entity) => entity.name.trim().toLocaleLowerCase() === playerName || entity.name.trim().toLocaleLowerCase().includes(playerName));
        if (matched) nextSettings.playerEntityId = matched.id;
      }
      await db.deltaSessions.update(session.id, { settings: nextSettings, initiativeStarted: false, awaitingPlayerRoll: true, awaitingPlayerAction: false, requiredRollDie: 20, requiredRollCount: 1, requiredRollResults: [], requiredRollKind: "initiative", requiredRollLabel: "initiative", requiredRollerName: undefined, requiredRollAbility: undefined, requiredRollModifier: undefined, requiredRollTurnNumber: undefined, requiredRollRawValues: [], actionPrompt: undefined, continuedTurnNumber: undefined, turnIndex: 0, updatedAt: now() });
      await onRefresh();
    });
  }, [startContext, messages.length]);
  useEffect(() => {
    const closeFromHistory = (event: PopStateEvent) => {
      if ((event.state as { mirrorDeltaMode?: boolean } | null)?.mirrorDeltaMode) return;
      onClose();
    };
    window.addEventListener("popstate", closeFromHistory);
    return () => window.removeEventListener("popstate", closeFromHistory);
  }, [onClose]);
  useEffect(() => {
    if (activeTool !== "entities" && activeTool !== "actions") return;
    void db.characters
      .where("projectId")
      .equals(project.id)
      .toArray()
      .then((rows) => setProjectCharacters(rows.sort((a, b) => (a.orderIndex ?? Number.MAX_SAFE_INTEGER) - (b.orderIndex ?? Number.MAX_SAFE_INTEGER) || a.normalisedName.localeCompare(b.normalisedName))));
  }, [activeTool, project.id]);
  useEffect(() => {
    const playerEntity = entities.find((entity) => entity.id === session.settings.playerEntityId) ?? entities.find((entity) => entity.characterId === chat.deltaPlayerCharacterId);
    setActionCharacterId(chat.deltaPlayerCharacterId || playerEntity?.characterId || "");
  }, [chat.deltaPlayerCharacterId, session.settings.playerEntityId, entities]);
  async function loadActionLibrary(characterId = actionCharacterId, preferredSlotId = selectedActionSlotId) {
    if (!characterId) {
      setActionSlots([]);
      setSelectedActionSlotId("");
      setActionMacros([]);
      return;
    }
    const timestamp = now();
    let slots = (await db.characterActionSlots.where("characterId").equals(characterId).toArray()).sort((a, b) => a.orderIndex - b.orderIndex);
    if (!slots.length) {
      const slot: CharacterActionSlot = { id: uid(), characterId, orderIndex: 0, createdAt: timestamp, updatedAt: timestamp };
      await db.characterActionSlots.add(slot);
      slots = [slot];
    }
    const slotId = slots.some((slot) => slot.id === preferredSlotId) ? preferredSlotId : slots[0].id;
    const macros = await db.characterActionMacros.where("slotId").equals(slotId).toArray();
    setActionSlots(slots);
    setSelectedActionSlotId(slotId);
    setActionMacros(macros.sort((a, b) => a.orderIndex - b.orderIndex));
  }
  useEffect(() => {
    if (activeTool !== "actions") return;
    void loadActionLibrary(actionCharacterId, selectedActionSlotId);
  }, [activeTool, actionCharacterId]);
  useEffect(() => {
    if (!session.awaitingPlayerRoll || activeTool !== "actions") return;
    setActiveTool(undefined);
  }, [session.awaitingPlayerRoll, activeTool]);
  function setDeltaRequestBusy(next: boolean) {
    deltaBusyRef.current = next;
    setDeltaBusy(next);
  }
  async function deltaOpenRouterRequest(payload: Record<string, unknown>) {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${(settings.apiKey ?? "").trim()}`,
        "Content-Type": "application/json",
        "HTTP-Referer": location.origin,
        "X-Title": "Mirror 2.0"
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error((await response.text()) || `OpenRouter request failed (${response.status})`);
    return response;
  }
  async function deltaCharacterPatch(character: Character) {
    return characterStatsPatch(character);
  }
  function deltaToolArgs(toolCall: OpenRouterToolCall) {
    try {
      return JSON.parse(toolCall.function.arguments || "{}") as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  async function runDeltaTool(toolCall: OpenRouterToolCall, turnNumber?: number) {
    const args = deltaToolArgs(toolCall);
    const stringArg = (key: string) => typeof args[key] === "string" ? String(args[key]).trim() : "";
    const mapCoordinate = (key: "mapRow" | "mapColumn") => {
      const value = Number(args[key]);
      const limit = deltaMapPreviewSizes[session.mapSize ?? "M"].cells;
      return Number.isInteger(value) && value >= 1 && value <= limit ? value : undefined;
    };
    switch (toolCall.function.name) {
      case "update_inventory_item": {
        if (!project.inventoryEnabled || !settings.autoManageInventory) return { error: "Inventory auto-management is disabled." };
        const kind = args.kind === "currency" ? "currency" : "inventory";
        const name = kind === "currency" ? (project.currencyName?.trim() || stringArg("name")) : normaliseInventoryName(stringArg("name"));
        const delta = typeof args.delta === "number" ? args.delta : Number(args.delta);
        const unitWeightKg = typeof args.unitWeightKg === "number" ? args.unitWeightKg : Number(args.unitWeightKg);
        const logSentence = stringArg("logSentence");
        if (!name || !Number.isFinite(delta) || delta === 0) return { error: "A non-empty item name and non-zero delta are required." };
        if (!logSentence) return { error: "A one-line log sentence is required." };
        if (kind === "currency") {
          const timestamp = now();
          const activeChat = await db.chats.get(chat.id);
          const quantity = Math.max(0, (activeChat?.currencyAmount ?? 0) + delta);
          await db.transaction("rw", db.chats, db.inventoryLogs, async () => {
            await db.chats.update(chat.id, { currencyAmount: quantity, updatedAt: timestamp });
            await db.inventoryLogs.add({ id: uid(), projectId: project.id, chatId: chat.id, sentence: logSentence, createdAt: timestamp, updatedAt: timestamp });
          });
          return { applied: true, kind, name, delta, quantity };
        }
        const result = await applyInventoryChange(project.id, chat.id, "inventory", name, delta, logSentence, Number.isFinite(unitWeightKg) && unitWeightKg > 0 ? unitWeightKg : undefined);
        return { applied: Boolean(result), kind, name, delta, quantity: result?.quantity };
      }
      case "find_characters":
        return findCharacters(project.id, stringArg("nameQuery"));
      case "get_character_identity":
        return stringArg("characterId") ? getCharacterIdentity(project.id, stringArg("characterId")) : { error: "characterId is required." };
      case "get_character_bio":
        return stringArg("characterId") ? getCharacterBio(project.id, stringArg("characterId")) : { error: "characterId is required." };
      case "get_character_stats":
        return stringArg("characterId") ? getCharacterStats(project.id, stringArg("characterId")) : { error: "characterId is required." };
      case "set_delta_engagement_name": {
        const title = stringArg("title").slice(0, 96);
        if (!title) return { error: "An engagement title is required." };
        await db.deltaSessions.update(session.id, { title, updatedAt: now() });
        return { title };
      }
      case "set_delta_map": {
        const { cells } = deltaMapPreviewSizes[session.mapSize ?? "M"];
        const rawTiles = Array.isArray(args.tiles) ? args.tiles : [];
        const tilesByCoordinate = new Map<string, DeltaMapTile>();
        const errors: string[] = [];
        for (const rawTile of rawTiles) {
          if (!rawTile || typeof rawTile !== "object") {
            errors.push("A map tile was not an object.");
            continue;
          }
          const candidate = rawTile as Record<string, unknown>;
          const row = Math.floor(Number(candidate.row));
          const column = Math.floor(Number(candidate.column));
          const kind = typeof candidate.kind === "string" ? candidate.kind.trim().toLowerCase() as DeltaMapTileKind : undefined;
          if (!Number.isInteger(row) || !Number.isInteger(column) || row < 1 || row > cells || column < 1 || column > cells || !["solid", "half", "special", "access"].includes(kind ?? "")) {
            errors.push(`Ignored invalid tile at ${String(candidate.row)}, ${String(candidate.column)}.`);
            continue;
          }
          const label = typeof candidate.label === "string" ? candidate.label.trim().slice(0, 80) : "";
          const color = typeof candidate.color === "string" && /^#[0-9a-f]{6}$/i.test(candidate.color.trim()) ? candidate.color.trim() : undefined;
          const accessState = candidate.accessState === "open" || candidate.accessState === "locked" || candidate.accessState === "closed" ? candidate.accessState : "closed";
          if (kind === "special" && (!label || !color)) {
            errors.push(`Ignored special tile at ${row}, ${column}: special terrain needs a label and hex color.`);
            continue;
          }
          tilesByCoordinate.set(`${row}:${column}`, {
            row,
            column,
            kind: kind as DeltaMapTileKind,
            ...(label ? { label } : {}),
            ...(kind === "special" && color ? { color } : {}),
            ...(kind === "access" ? { accessState } : {})
          });
        }
        const mapTiles = [...tilesByCoordinate.values()];
        await db.deltaSessions.update(session.id, { mapTiles, updatedAt: now() });
        return { staged: mapTiles.length, mapSize: session.mapSize ?? "M", cells, ...(errors.length ? { errors } : {}) };
      }
      case "list_delta_job_categories": {
        const counts = jobCategories(project.deltaJobs ?? []);
        return counts.map(([category, count]) => ({ category, count }));
      }
      case "get_delta_jobs_for_category": {
        const category = stringArg("category").toLowerCase();
        return (project.deltaJobs ?? [])
          .filter((job) => job.category.trim().toLowerCase() === category)
          .map((job) => ({ label: job.label, category: job.category, statModifiers: job.statModifiers, notes: job.notes ?? "" }));
      }
      case "create_delta_entity": {
        const characterId = stringArg("characterId");
        const requestedName = stringArg("name");
        const requestedCharacter = characterId ? await db.characters.get(characterId) : undefined;
        const character = requestedCharacter && requestedCharacter.projectId === project.id
          ? requestedCharacter
          : requestedName
            ? await db.characters.where("projectId").equals(project.id).and((item) => item.name.trim().toLowerCase() === requestedName.toLowerCase()).first()
            : undefined;
        const entityName = character?.name || requestedName || "Unnamed entity";
        if (!character && (isInvalidDeltaEntityName(entityName) || abstractDeltaRosterName(entityName))) {
          return {
            error: "Use a concrete observable identity for this participant: a canonical name, visible person, animal/species, or recognizable role. Put range, cover, terrain, and position details in their dedicated fields.",
            rejectedName: entityName
          };
        }
        const mapRow = mapCoordinate("mapRow");
        const mapColumn = mapCoordinate("mapColumn");
        const existingEntity = await db.deltaEntities
          .where("sessionId")
          .equals(session.id)
          .and((entity) => character
            ? entity.characterId === character.id || entity.name.trim().toLowerCase() === entityName.trim().toLowerCase()
            : !entity.characterId && entity.name.trim().toLocaleLowerCase() === entityName.trim().toLocaleLowerCase())
          .first();
        if (existingEntity) {
          const generatedTemplateRequested = !character && ["prefix", "base", "job"].some((key) => stringArg(key));
          const patch = character && character.projectId === project.id
            ? await deltaCharacterPatch(character)
            : generatedTemplateRequested
              ? generatedStatsPatch(project, { prefix: stringArg("prefix"), base: stringArg("base"), job: stringArg("job"), jobCategory: stringArg("jobCategory") })
              : {};
          const next: Partial<DeltaEntity> = {
            ...patch,
            ...(mapRow !== undefined && mapColumn !== undefined ? { mapRow, mapColumn } : {}),
            updatedAt: now()
          };
          if (Object.keys(next).length > 1) await db.deltaEntities.update(existingEntity.id, next);
          if (generatedTemplateRequested) await upsertDeltaAllyCache(chat.id, { ...existingEntity, ...next });
          return {
            existing: character?.name || existingEntity.name,
            entityId: existingEntity.id,
            templateTag: next.templateTag ?? existingEntity.templateTag ?? "",
            stats: { STR: next.str ?? existingEntity.str, DEX: next.dex ?? existingEntity.dex, CON: next.con ?? existingEntity.con, INT: next.int ?? existingEntity.int, WIS: next.wis ?? existingEntity.wis, CHA: next.cha ?? existingEntity.cha },
            hp: { current: next.currentHp ?? existingEntity.currentHp, max: next.maxHp ?? existingEntity.maxHp },
            mapPosition: mapRow !== undefined && mapColumn !== undefined ? { row: mapRow, column: mapColumn } : undefined
          };
        }
        const timestamp = now();
        const basePatch = character && character.projectId === project.id
          ? await deltaCharacterPatch(character)
          : generatedStatsPatch(project, { prefix: stringArg("prefix"), base: stringArg("base"), job: stringArg("job"), jobCategory: stringArg("jobCategory") });
        const entity: DeltaEntity = {
          id: uid(),
          sessionId: session.id,
          ...basePatch,
          name: entityName,
          side: normaliseDeltaRelationship(stringArg("side")) as DeltaRelationship,
          statusText: stringArg("statusText"),
          distanceFromPlayer: stringArg("distanceFromPlayer"),
          elevation: stringArg("elevation"),
          ...(mapRow !== undefined && mapColumn !== undefined ? { mapRow, mapColumn } : {}),
          orderIndex: await db.deltaEntities.where("sessionId").equals(session.id).count(),
          createdAt: timestamp,
          updatedAt: timestamp
        };
        await db.deltaEntities.add(entity);
        await upsertDeltaAllyCache(chat.id, entity);
        return {
          created: entity.name,
          entityId: entity.id,
          templateTag: entity.templateTag ?? "",
          stats: { STR: entity.str, DEX: entity.dex, CON: entity.con, INT: entity.int, WIS: entity.wis, CHA: entity.cha },
          hp: { current: entity.currentHp, max: entity.maxHp }
        };
      }
      case "finish_delta_engagement":
        await db.deltaSessions.update(session.id, {
          finishReady: true,
          awaitingPlayerAction: false,
          awaitingPlayerRoll: false,
          actionPrompt: undefined,
          requiredRollDie: undefined,
          requiredRollCount: undefined,
          requiredRollResults: undefined,
          requiredRollKind: undefined,
          requiredRollLabel: undefined,
          requiredRollerName: undefined,
          requiredRollAbility: undefined,
          requiredRollModifier: undefined,
          requiredRollTurnNumber: undefined,
          requiredRollRawValues: undefined,
          continuedTurnNumber: undefined,
          updatedAt: now()
        });
        return { finishing: true, message: "The client will show the End Engagement control. Do not write a closing response." };
      case "set_delta_player_entity": {
        const entityId = stringArg("entityId");
        const entity = entityId ? await db.deltaEntities.get(entityId) : undefined;
        if (!entity || entity.sessionId !== session.id) return { error: "Entity not found in this active Delta engagement." };
        await db.deltaSessions.update(session.id, { settings: { ...session.settings, playerEntityId: entity.id }, updatedAt: now() });
        if (entity.characterId) await db.chats.update(chat.id, { deltaPlayerCharacterId: entity.characterId, updatedAt: now() });
        return { playerEntityId: entity.id, playerName: entity.name };
      }
      case "request_delta_roll": {
        const die = Number(args.die);
        const allowedDice = [4, 6, 8, 9, 12, 20, 100];
        if (!allowedDice.includes(die)) return { error: "Unsupported die. Use d4, d6, d8, d9, d12, d20, or d100." };
        const current = await db.deltaSessions.get(session.id);
        const ordered = (await db.deltaEntities.where("sessionId").equals(session.id).toArray())
          .filter(canTakeDeltaTurn)
          .sort((a, b) => a.orderIndex - b.orderIndex);
        const currentActor = ordered[current?.turnIndex ?? 0];
        const playerEntityId = current?.settings.playerEntityId ?? ordered.find((entity) => entity.characterId === chat.deltaPlayerCharacterId)?.id;
        const count = Math.max(1, Math.min(12, Math.floor(typeof args.count === "number" && Number.isFinite(args.count) ? args.count : 1)));
        const label = stringArg("label").slice(0, 80) || `d${die} roll`;
        const abilityArg = stringArg("ability").toUpperCase();
        if (abilityArg !== "NONE" && !deltaRollAbilities.includes(abilityArg as DeltaRollAbility)) {
          return { error: "A governing ability is required. Use STR, DEX, CON, INT, WIS, CHA, or NONE." };
        }
        const ability = abilityArg === "NONE" ? undefined : abilityArg as DeltaRollAbility;
        const rollerNameArg = stringArg("rollerName").slice(0, 80);
        const normalizedLabel = `${rollerNameArg} ${label}`.toLowerCase();
        const playerEntity = playerEntityId ? ordered.find((entity) => entity.id === playerEntityId) : undefined;
        const labelEntity = ordered.find((entity) => normalizedLabel.includes(entity.name.trim().toLowerCase()));
        const rollerEntity = rollerNameArg
          ? ordered.find((entity) => entity.name.trim().toLowerCase() === rollerNameArg.trim().toLowerCase()) ?? labelEntity
          : labelEntity ?? currentActor;
        const isNonPlayerRoll = Boolean(rollerEntity && (!playerEntityId || rollerEntity.id !== playerEntityId));
        const modifier = deltaRollModifier(rollerEntity, ability);
        if (isNonPlayerRoll) {
          const samples = Array.from({ length: count }, () => secureRollSample(die));
          const results = samples.map((sample) => sample.result);
          const rollResult = deltaRollResultText(die, results, modifier);
          const resultText = rollResult.text;
          const roller = rollerEntity?.name ?? "NPC";
          const receipt = createRollReceipt({
            toolName: "request_delta_roll",
            rollerName: roller,
            label,
            ability,
            modifier,
            die,
            results,
            rawValues: samples.map((sample) => sample.rawValue),
            total: rollResult.total
          });
          await addDeltaMessage(session.id, "system", `${roller}: Roll ${label}${ability ? ` (${ability})` : ""}: ${resultText}`, {
            turnNumber,
            eventType: "roll",
            rollReceipt: receipt
          });
          return {
            rolled: true,
            automatic: true,
            roller,
            label,
            die,
            count,
            results,
            ability: ability ?? "NONE",
            modifier,
            total: rollResult.total,
            resultText,
            receiptId: receipt.id,
            instruction: /damage/i.test(label)
              ? "This is an authoritative client-generated damage roll. Before writing aftermath, call apply_delta_damage with the correct target entityId, this exact total, and this receipt ID. Do not merely narrate damage and do not repeat the roll line."
              : /(?:attack|strike|shot)/i.test(label)
                ? "This is an authoritative client-generated attack roll. Determine hit or miss. If it hits, call request_delta_roll for damage and stop before writing hit aftermath. If it misses, resolve the miss without a damage roll. Do not repeat the attack roll line."
                : "These are authoritative client-generated dice results. The app has already displayed them in a separate verified roll row. Use these exact numbers to resolve the turn, but do not repeat or rewrite the roll line in narrative text."
          };
        }
        await db.deltaSessions.update(session.id, {
          awaitingPlayerRoll: true,
          awaitingPlayerAction: false,
          requiredRollDie: die,
          requiredRollCount: count,
          requiredRollResults: [],
          requiredRollKind: "check",
          requiredRollLabel: label,
          requiredRollerName: isNonPlayerRoll ? rollerEntity?.name ?? "NPC" : playerEntity?.name ?? currentActor?.name ?? "player",
          requiredRollAbility: ability,
          requiredRollModifier: modifier,
          requiredRollTurnNumber: turnNumber,
          requiredRollRawValues: [],
          actionPrompt: undefined,
          updatedAt: now()
        });
        return { waitingForRoll: `${count}d${die}`, label, roller: isNonPlayerRoll ? rollerEntity?.name ?? "NPC" : playerEntity?.name ?? currentActor?.name ?? "player", ability: ability ?? "NONE", modifier };
      }
      case "request_delta_reaction": {
        const current = await db.deltaSessions.get(session.id);
        const roster = (await db.deltaEntities.where("sessionId").equals(session.id).toArray())
          .filter(canTakeDeltaTurn)
          .sort((a, b) => a.orderIndex - b.orderIndex);
        const targetEntityId = stringArg("targetEntityId");
        const target = roster.find((entity) => entity.id === targetEntityId);
        if (!current || !target) return { error: "The reaction target is not an active entity in this engagement." };
        const used = new Set(current.reactionUsedEntityIds ?? []);
        if (used.has(target.id)) {
          return { reactionAvailable: false, target: target.name, reason: "Reaction already attempted this round. Resolve the incoming action without another reaction check." };
        }
        const trigger = stringArg("trigger").slice(0, 240) || "Incoming threat";
        const modifier = deltaRollModifier(target, "DEX");
        const reactionUsedEntityIds = [...used, target.id];
        const playerEntityId = current.settings.playerEntityId
          ?? roster.find((entity) => entity.characterId === chat.deltaPlayerCharacterId)?.id;
        const currentActor = roster[current.turnIndex ?? 0];
        if (target.id !== playerEntityId) {
          const sample = secureRollSample(8);
          const rollResult = deltaRollResultText(8, [sample.result], modifier);
          const receipt = createRollReceipt({
            toolName: "request_delta_roll",
            rollerName: target.name,
            label: "reaction",
            ability: "DEX",
            modifier,
            die: 8,
            results: [sample.result],
            rawValues: [sample.rawValue],
            total: rollResult.total
          });
          await addDeltaMessage(session.id, "system", `${target.name}: Roll reaction (DEX): ${rollResult.text}`, {
            turnNumber,
            eventType: "roll",
            rollReceipt: receipt
          });
          await db.deltaSessions.update(session.id, { reactionUsedEntityIds, updatedAt: now() });
          return {
            reactionAvailable: rollResult.total >= 6,
            target: target.name,
            trigger,
            die: 8,
            ability: "DEX",
            modifier,
            total: rollResult.total,
            receiptId: receipt.id,
            instruction: rollResult.total >= 6
              ? "The reaction check succeeded. Resolve one brief, physically plausible reaction for this non-player entity before finishing the current actor's turn. Do not create a separate turn."
              : "The reaction check failed. The target receives no reaction; finish resolving the current actor's action."
          };
        }
        await db.deltaSessions.update(session.id, {
          reactionUsedEntityIds,
          reactionState: "checking",
          reactionSourceActorId: currentActor?.id,
          reactionTargetEntityId: target.id,
          reactionTrigger: trigger,
          reactionTurnNumber: turnNumber,
          awaitingPlayerRoll: true,
          awaitingPlayerAction: false,
          requiredRollDie: 8,
          requiredRollCount: 1,
          requiredRollResults: [],
          requiredRollKind: "reaction",
          requiredRollLabel: "reaction",
          requiredRollerName: target.name,
          requiredRollAbility: "DEX",
          requiredRollModifier: modifier,
          requiredRollTurnNumber: turnNumber,
          requiredRollRawValues: [],
          actionPrompt: undefined,
          updatedAt: now()
        });
        return { waitingForRoll: "1d8", reactionCheck: true, target: target.name, trigger, ability: "DEX", modifier, threshold: 6 };
      }
      case "request_delta_action": {
        const prompt = stringArg("prompt").slice(0, 180) || "It is your turn.";
        await db.deltaSessions.update(session.id, {
          awaitingPlayerAction: true,
          awaitingPlayerRoll: false,
          actionPrompt: prompt,
          requiredRollDie: undefined,
          requiredRollCount: undefined,
          requiredRollResults: undefined,
          requiredRollKind: undefined,
          requiredRollLabel: undefined,
          requiredRollerName: undefined,
          requiredRollAbility: undefined,
          requiredRollModifier: undefined,
          requiredRollTurnNumber: undefined,
          requiredRollRawValues: undefined,
          updatedAt: now()
        });
        return { waitingForAction: true, prompt };
      }
      case "continue_delta_player_turn": {
        const current = await db.deltaSessions.get(session.id);
        const ordered = (await db.deltaEntities.where("sessionId").equals(session.id).toArray())
          .filter(canTakeDeltaTurn)
          .sort((a, b) => a.orderIndex - b.orderIndex);
        const currentActor = ordered[current?.turnIndex ?? 0];
        const playerEntityId = current?.settings.playerEntityId
          ?? ordered.find((entity) => entity.characterId === chat.deltaPlayerCharacterId)?.id;
        if (!current?.initiativeStarted || !currentActor || currentActor.id !== playerEntityId) {
          return { error: "Only the current player entity can retain its turn for free dialogue." };
        }
        const cinematicReply = cleanDeltaCinematic(stringArg("cinematicReply")).slice(0, 500).trim();
        if (!cinematicReply) return { error: "A concise cinematicReply is required to retain a dialogue-only turn." };
        const prompt = stringArg("prompt").slice(0, 180) || "Your turn remains open.";
        await addDeltaMessage(session.id, "assistant", `${cinematicMarker()} ${cinematicReply}`, { turnNumber, eventType: "narrative" });
        await db.deltaSessions.update(session.id, {
          awaitingPlayerAction: true,
          awaitingPlayerRoll: false,
          actionPrompt: prompt,
          continuedTurnNumber: turnNumber,
          updatedAt: now()
        });
        return { waitingForAction: true, retainedTurn: turnNumber, cinematicReplyPosted: true, prompt };
      }
      case "apply_delta_damage": {
        const entityId = stringArg("entityId");
        const rollReceiptId = stringArg("rollReceiptId");
        const amount = Number(args.amount);
        if (!entityId || !rollReceiptId || !Number.isFinite(amount)) return { error: "entityId, amount, and rollReceiptId are required." };
        const zeroHpOutcome = stringArg("zeroHpOutcome") === "dead" ? "dead" : "ko";
        const result = await applyDeltaDamage(session.id, entityId, amount, rollReceiptId, zeroHpOutcome);
        if ("applied" in result && result.applied) {
          const updatedEntity = await db.deltaEntities.get(entityId);
          if (updatedEntity) await upsertDeltaAllyCache(chat.id, updatedEntity);
          await markFinishReadyIfOppositionResolved();
        }
        return result;
      }
      case "update_delta_entity": {
        const entity = await db.deltaEntities.get(stringArg("entityId"));
        if (!entity || entity.sessionId !== session.id) return { error: "Entity not found in this active Delta engagement." };
        const templateRequested = ["prefix", "base", "job"].some((key) => stringArg(key));
        const patch = templateRequested && !entity.characterId
          ? generatedStatsPatch(project, { prefix: stringArg("prefix"), base: stringArg("base"), job: stringArg("job"), jobCategory: stringArg("jobCategory") })
          : {};
        const next: Partial<DeltaEntity> = {
          ...patch,
          name: stringArg("name") || entity.name,
          side: stringArg("side") ? normaliseDeltaRelationship(stringArg("side")) : entity.side,
          engagementState: ["active", "ko", "dead", "escaped"].includes(stringArg("engagementState"))
            ? stringArg("engagementState") as DeltaEntity["engagementState"]
            : entity.engagementState,
          statusText: stringArg("statusText") || entity.statusText,
          maxHp: typeof args.maxHp === "number" && Number.isFinite(args.maxHp) ? Math.max(1, args.maxHp) : entity.maxHp,
          initiative: typeof args.initiative === "number" && Number.isFinite(args.initiative) ? args.initiative : entity.initiative,
          distanceFromPlayer: stringArg("distanceFromPlayer") || entity.distanceFromPlayer,
          elevation: stringArg("elevation") || entity.elevation,
          ...(mapCoordinate("mapRow") !== undefined && mapCoordinate("mapColumn") !== undefined ? { mapRow: mapCoordinate("mapRow"), mapColumn: mapCoordinate("mapColumn") } : {}),
          updatedAt: now()
        };
        await db.deltaEntities.update(entity.id, next);
        await upsertDeltaAllyCache(chat.id, { ...entity, ...next });
        await markFinishReadyIfOppositionResolved();
        return { updated: next.name, entityId: entity.id, templateTag: "templateTag" in next ? next.templateTag ?? "" : entity.templateTag ?? "" };
      }
      default:
        return { error: `Unknown Delta tool ${toolCall.function.name}.` };
    }
  }
  async function nextDeltaTurnNumber() {
    const stored = await db.deltaMessages.where("sessionId").equals(session.id).toArray();
    return deltaLogTurnCount(stored.sort((a, b) => a.sequence - b.sequence)) + 1;
  }
  async function completeDeltaTurn(
    history: OpenRouterMessage[],
    toolLog: string[],
    requireInitialTool = false,
    turnNumber?: number,
    persistBeforeTools?: (content: string, includesRoll: boolean) => Promise<void>
  ) {
    let messagesToSend = history;
    const visibleChunks: string[] = [];
    const latestRequestContent = history[history.length - 1]?.content;
    let hasCurrentVerifiedRoll = typeof latestRequestContent === "string" && /(?:dice roll receipt|authoritative (?:roll|total))/i.test(latestRequestContent);
    const latestRequestText = typeof latestRequestContent === "string" ? latestRequestContent.toLowerCase() : "";
    let pendingAttackResolution = /client-generated[^.\n]*(?:attack|strike|shot)/i.test(latestRequestText);
    let pendingDamageApplication = /client-generated[^.\n]*damage/i.test(latestRequestText);
    const verifiedDice = new Set<number>();
    if (hasCurrentVerifiedRoll && typeof latestRequestContent === "string") {
      for (const match of latestRequestContent.matchAll(/\bd(4|6|8|9|12|20|100)\b/gi)) verifiedDice.add(Number(match[1]));
    }
    let forceCorrectiveTool = false;
    let forcedToolName: "request_delta_roll" | "apply_delta_damage" | undefined;
    for (let index = 0; index < 6; index += 1) {
      const response = await deltaOpenRouterRequest({
        model: session.settings.modelId || chat.modelId || selectedModelId || settings.defaultModelId,
        messages: messagesToSend,
        tools: [...characterTools, ...deltaEntityTools, ...(project.inventoryEnabled && settings.autoManageInventory ? [...inventoryTools] : [])],
        ...(forcedToolName
          ? { tool_choice: { type: "function", function: { name: forcedToolName } } }
          : forceCorrectiveTool
          ? { tool_choice: "required" }
          : requireInitialTool && index === 0
            ? { tool_choice: "required" }
            : {}),
        temperature: session.settings.temperature ?? 0,
        top_p: session.settings.topP ?? 0,
        ...(session.settings.maxTokens ? { max_tokens: session.settings.maxTokens } : {})
      });
      const json = await response.json() as OpenRouterResponse;
      const assistantMessage = json.choices?.[0]?.message;
      const toolCalls = assistantMessage?.tool_calls ?? [];
      const rawContent = assistantMessage?.content ?? "";
      const content = cleanDeltaToolCallText(rawContent);
      const inlineRollDice = deltaInlineRollResultDice(content);
      if (inlineRollDice.length > 0) {
        const onlyRepeatsVerifiedRoll = hasCurrentVerifiedRoll
          && inlineRollDice.every((die) => die !== 0 && verifiedDice.has(die));
        forceCorrectiveTool = !onlyRepeatsVerifiedRoll;
        toolLog.push("rejected_unverified_roll_text");
        messagesToSend = [
          ...messagesToSend,
          {
            role: "user",
            content: onlyRepeatsVerifiedRoll
              ? "The client rejected that response because dice results must never be written inside narrative text, including repetitions of a verified roll. Rewrite the outcome without any roll line or dice arithmetic. Use the existing authoritative receipt and do not reroll."
              : "The client discarded your entire response because it invented a dice result. That discarded response is not evidence that a roll was needed. Re-read the latest actual player entry and classify it again. If it was only direct speech, signalling, or communication, call continue_delta_player_turn with the addressed entity's brief response in cinematicReply; do not create an attack. If it contained a genuine uncertain action, call request_delta_roll with the correct rollerName, die, label, and ability. Never invent an action that the player did not declare, and do not write dice results in prose."
          }
        ];
        continue;
      }
      forceCorrectiveTool = false;
      forcedToolName = undefined;
      if (!toolCalls.length) {
        if (pendingDamageApplication) {
          forcedToolName = "apply_delta_damage";
          messagesToSend = [
            ...messagesToSend,
            {
              role: "user",
              content: "The verified damage roll has not been applied to the target entity. Discard that aftermath. Call apply_delta_damage now with the correct target entityId, the verified damage total, its exact receipt ID, and the appropriate KO or DEAD zero-HP outcome. Do not narrate the aftermath until the client confirms the HP update."
            }
          ];
          continue;
        }
        if (pendingAttackResolution && /\b(?:hit|hits|strikes?|clips?|connects?|grazes?|pierces?|wounds?|damage)\b/i.test(content)) {
          pendingAttackResolution = false;
          forcedToolName = "request_delta_roll";
          messagesToSend = [
            ...messagesToSend,
            {
              role: "user",
              content: "The verified attack appears to hit, but no verified damage roll exists. Discard that hit aftermath. Call request_delta_roll now for damage with the correct rollerName, damage die/count, label containing 'damage', and governing ability. Do not estimate damage or change HP yet."
            }
          ];
          continue;
        }
        if (content) visibleChunks.push(content);
        return visibleChunks.join("\n").trim();
      }
      const dialogueContinuationOwnsReply = toolCalls.some((toolCall) => toolCall.function.name === "continue_delta_player_turn");
      const contentBeforeTools = dialogueContinuationOwnsReply ? "" : content;
      const includesRoll = toolCalls.some((toolCall) => toolCall.function.name === "request_delta_roll" || toolCall.function.name === "request_delta_reaction");
      if (persistBeforeTools) await persistBeforeTools(contentBeforeTools, includesRoll);
      else if (contentBeforeTools) visibleChunks.push(contentBeforeTools);
      let pauseRequested = false;
      messagesToSend = [
        ...messagesToSend,
        { role: "assistant", content: assistantMessage?.content ?? "", tool_calls: toolCalls }
      ];
      for (const toolCall of toolCalls) {
        const result = await runDeltaTool(toolCall, turnNumber);
        toolLog.push(toolCall.function.name);
        if (typeof result === "object" && result && ("waitingForRoll" in result || "waitingForAction" in result)) pauseRequested = true;
        if (toolCall.function.name === "request_delta_roll" && typeof result === "object" && result && "total" in result && typeof result.total === "number") {
          hasCurrentVerifiedRoll = true;
          if ("die" in result && typeof result.die === "number") verifiedDice.add(result.die);
          const label = "label" in result && typeof result.label === "string" ? result.label.toLowerCase() : "";
          if (/damage/.test(label)) {
            pendingAttackResolution = false;
            pendingDamageApplication = true;
          } else if (/(?:attack|strike|shot)/.test(label)) {
            pendingAttackResolution = true;
          }
        }
        if (toolCall.function.name === "request_delta_reaction" && typeof result === "object" && result && "total" in result && typeof result.total === "number") {
          hasCurrentVerifiedRoll = true;
          verifiedDice.add(8);
        }
        if (toolCall.function.name === "apply_delta_damage" && typeof result === "object" && result && "applied" in result && result.applied === true) {
          pendingDamageApplication = false;
        }
        messagesToSend.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(result) });
      }
      if (pauseRequested) {
        return visibleChunks.join("\n").trim();
      }
    }
    throw new Error("Delta blocked repeated AI-authored dice results. The current turn was not advanced; retry it.");
  }
  async function submitDeltaTurn(clean: string, options: { hideUser?: boolean; instruction?: string; stageEngagement?: boolean; turnActorId?: string; turnNumber?: number; allowDialogueReply?: boolean } = {}) {
    if (!clean || !session.active) return false;
    if (deltaBusyRef.current) return false;
    if (!settings.apiKey) {
      alert("Add your OpenRouter API key before sending Delta AI requests. Your draft is still here.");
      return false;
    }
    const model = session.settings.modelId || chat.modelId || selectedModelId || settings.defaultModelId;
    if (!model) {
      alert("Choose a model before sending Delta AI requests. Your draft is still here.");
      return false;
    }
    const turnNumber = options.turnNumber ?? await nextDeltaTurnNumber();
    if (!options.hideUser) await addDeltaMessage(session.id, "user", clean, { turnNumber, eventType: "narrative" });
    const timestamp = now();
    const replyId = uid();
    const replySequence = ((await db.deltaMessages.where("[sessionId+sequence]").between([session.id, Dexie.minKey], [session.id, Dexie.maxKey]).last())?.sequence ?? -1) + 1;
    await db.deltaMessages.add({ id: replyId, sessionId: session.id, sequence: replySequence, role: "assistant", body: "...", status: "pending", modelId: model, turnNumber, eventType: "narrative", createdAt: timestamp, updatedAt: timestamp });
    await onRefresh();
    const allCharacters = await db.characters.where("projectId").equals(project.id).toArray();
    const deltaPrompt = effectiveDeltaSystemPrompt(project.deltaSystemPrompt);
    const currentEntities = (await db.deltaEntities.where("sessionId").equals(session.id).toArray()).sort((a, b) => a.orderIndex - b.orderIndex);
    const [inventoryRows, activeChat] = project.inventoryEnabled
      ? await Promise.all([
        db.inventoryItems.where("chatId").equals(chat.id).toArray(),
        db.chats.get(chat.id)
      ])
      : [[], undefined] as const;
    const inventoryDetails = project.inventoryEnabled
      ? [
        `Inventory:\n${[
          project.currencyName ? `- ${project.currencyName}: ${activeChat?.currencyAmount ?? 0}` : "",
          ...inventoryRows.filter((item) => item.kind === "inventory" && item.name.trim()).map((item) => {
            const totalKg = (item.unitWeightKg ?? 0) * item.quantity;
            return `- ${item.name}: ${item.quantity}${item.unitWeightKg ? `, ${formatInventoryKg(item.unitWeightKg)}kg each, ${formatInventoryKg(totalKg)}kg total` : ""}`;
          })
        ].filter(Boolean).join("\n") || "(empty)"}`,
        settings.autoManageInventory ? "Inventory auto-management is enabled in Delta: use update_inventory_item when the player or NPC action gains, spends, fires, drops, consumes, steals, reloads, or loses inventory/currency. Subtract only the actual amount used, not the whole stack. Inventory log sentences must include where the item came from or went." : "Inventory is read-only in Delta because auto-management is disabled.",
        "If the user's text contains [i], treat the nearby action as an explicit inventory-management signal."
      ].filter(Boolean).join("\n\n")
      : "";
    const linkedCharacters = await linkedCharacterContext();
    const mapSize = session.mapSize ?? "M";
    const mapDefinition = session.mapTiles?.map((tile) => `${tile.row},${tile.column}: ${tile.kind}${tile.label ? ` (${tile.label})` : ""}${tile.kind === "special" && tile.color ? ` color=${tile.color}` : ""}${tile.kind === "access" ? ` ${tile.accessState ?? "closed"}` : ""}`).join("; ") || "(not staged)";
    const context = [
      deltaPrompt,
      `Project: ${project.name}`,
      project.worldSetting ? `World setting:\n${project.worldSetting}` : "",
      `Saved project character names:\n${allCharacters.map((character) => `- ${character.name} (${character.id})`).join("\n") || "(none)"}`,
      linkedCharacters ? `Linked involved character data:\n${linkedCharacters}` : "",
      `Current entity list:\n${currentEntities.map((entity) => `- ${entity.id}: ${entity.name}, ${entity.side}, state=${entity.engagementState ?? (entity.currentHp === 0 ? "ko" : "active")}, HP=${entity.currentHp ?? entity.maxHp ?? "?"}/${entity.maxHp ?? "?"}${entity.characterId ? `, characterId=${entity.characterId}` : ""}${entity.templateTag ? `, ${entity.templateTag}` : ""}${entity.statusText ? `, ${entity.statusText}` : ""}${entityPositionLabel(entity) ? `, ${entityPositionLabel(entity)}` : ""}`).join("\n") || "(none)"}`,
      options.turnActorId ? `Current turn actor: ${currentEntities.find((entity) => entity.id === options.turnActorId)?.name ?? options.turnActorId}` : "",
      inventoryDetails,
      `Map boundary: ${mapSize}, ${deltaMapPreviewSizes[mapSize].metres}m, ${deltaMapPreviewSizes[mapSize].cells} x ${deltaMapPreviewSizes[mapSize].cells} tiles. Current non-open terrain: ${mapDefinition}`,
      `Chat-scoped ally cache:\n${allyCache.map((entry) => `- ${entry.name}${entry.templateTag ? `, ${entry.templateTag}` : ""}`).join("\n") || "(none)"}`,
      `Available PREFIX labels: ${effectiveDeltaPrefixes(project.deltaPrefixes).map((item) => item.label).join(", ") || "(none)"}`,
      `Available BASE labels: ${effectiveDeltaBases(project.deltaBases).map((item) => item.label).join(", ") || "(none)"}`,
      `Available JOB categories: ${jobCategories(project.deltaJobs ?? []).map(([category, count]) => `${category} (${count})`).join(", ") || "(none)"}`,
      "Runtime enforcement: use the client for every new roll and never write dice results in prose. Apply HP damage only through apply_delta_damage after a verified damage roll. Keep reactions inside the triggering actor's turn, and use contested rolls for active opposition. Persist entity state rather than merely describing it. The Delta system prompt defines the prose, cut-in, dialogue, continuity, entity, and opening-engagement behavior; do not restate or override it here.",
      options.allowDialogueReply
        ? "Dialogue scope for this request: respond only to direct speech in the latest player entry currently being processed. Once posted, that dialogue is answered and must not be answered again on later turns."
        : "Dialogue scope for this request: do not answer, paraphrase, continue, or add another cinematic response to player dialogue from any earlier message. That dialogue has already been handled. Resolve only the current roll, action, or current entity turn.",
      options.stageEngagement
        ? "Current phase: opening a new engagement. Before any transcript response, call set_delta_engagement_name and set_delta_map. The map must use only valid one-based coordinates inside the fixed grid; include only non-open tiles. Special terrain needs a concrete label and hex color. Then create or reconcile the entities from the handoff, assign every participating entity a unique valid mapRow/mapColumn on an open or passable tile, and mark the selected player entity before calling for initiative. Do not treat continuity labels such as Situation, Location, Objective, Map, or Terrain as entities."
        : ""
    ].filter(Boolean).join("\n\n");
    const requestMessages: OpenRouterMessage[] = [
      { role: "system", content: context },
      ...messages.map((message) => ({ role: message.role as OpenRouterMessage["role"], content: message.body })),
      { role: "user", content: [options.instruction, clean].filter(Boolean).join("\n\n") }
    ];
    const toolLog: string[] = [];
    let pendingReplyOpen = true;
    let requestSucceeded = true;
    const persistBeforeTools = async (content: string, includesRoll: boolean) => {
      if (content) {
        if (pendingReplyOpen) {
          await db.deltaMessages.update(replyId, { body: content, status: "complete", updatedAt: now() });
          pendingReplyOpen = false;
        } else {
          await addDeltaMessage(session.id, "assistant", content, { turnNumber, eventType: "narrative", modelId: model });
        }
      } else if (includesRoll && pendingReplyOpen) {
        await db.deltaMessages.delete(replyId);
        pendingReplyOpen = false;
      }
    };
    setDeltaRequestBusy(true);
    try {
      const reply = await completeDeltaTurn(requestMessages, toolLog, options.stageEngagement, turnNumber, persistBeforeTools);
      if (reply.trim()) {
        if (pendingReplyOpen) await db.deltaMessages.update(replyId, { body: reply, status: "complete", updatedAt: now() });
        else await addDeltaMessage(session.id, "assistant", reply, { turnNumber, eventType: "narrative", modelId: model });
      } else if (pendingReplyOpen) await db.deltaMessages.delete(replyId);
    } catch (error) {
      requestSucceeded = false;
      const body = error instanceof Error ? error.message : "OpenRouter request failed.";
      if (pendingReplyOpen) await db.deltaMessages.update(replyId, { body, status: "failed", updatedAt: now() });
      else await addDeltaMessage(session.id, "assistant", body, { turnNumber, eventType: "narrative", modelId: model });
    } finally {
      setDeltaRequestBusy(false);
    }
    await onRefresh();
    return requestSucceeded;
  }
  async function send() {
    const clean = body.trim();
    if (!clean || !session.active) return;
    if (deltaBusyRef.current) return;
    if (session.awaitingPlayerRoll || (session.initiativeStarted && !session.awaitingPlayerAction)) return;
    if (clean.toLowerCase() === "((testing end engagement))") {
      setBody("");
      await startFinishFlow();
      return;
    }
    const ordered = (await db.deltaEntities.where("sessionId").equals(session.id).toArray())
      .filter(canTakeDeltaTurn)
      .sort((a, b) => a.orderIndex - b.orderIndex);
    const isReaction = session.reactionState === "available";
    const turnActorId = isReaction
      ? session.reactionSourceActorId ?? ordered[session.turnIndex ?? 0]?.id
      : ordered[session.turnIndex ?? 0]?.id;
    const wasAwaitingPlayerAction = Boolean(session.awaitingPlayerAction);
    if (wasAwaitingPlayerAction) await db.deltaSessions.update(session.id, {
      awaitingPlayerAction: false,
      actionPrompt: undefined,
      continuedTurnNumber: undefined,
      ...(isReaction ? { reactionState: "resolving" as const } : {}),
      updatedAt: now()
    });
    const sent = await submitDeltaTurn(clean, wasAwaitingPlayerAction ? {
      turnActorId,
      allowDialogueReply: !isReaction,
      ...(isReaction && session.reactionTurnNumber !== undefined
        ? { turnNumber: session.reactionTurnNumber }
        : session.continuedTurnNumber !== undefined
          ? { turnNumber: session.continuedTurnNumber }
          : {}),
      instruction: isReaction
        ? `This is the player's successful out-of-turn reaction to: ${session.reactionTrigger ?? "the immediate threat"}. Resolve this reaction inside the interrupted actor's current turn, not as a new turn. If its success is uncertain, call request_delta_roll with the governing ability and stop for the player's roll. Otherwise resolve the reaction and then finish the interrupted actor's remaining action. Do not grant another reaction check, request_delta_action, or advance another entity; the client owns turn advancement.`
        : "The player just submitted part of their current turn. Direct in-character speech addressed to another involved entity must receive one brief cinematic reply or immediate nonverbal response. If the entry also contains an action, put that cut-in first, begin it with 🎞️, and keep it concise. If the entry contains only speech, signalling, or communication and no movement, attack, item use, physical interaction, roll-worthy influence attempt, or other turn-consuming action, do not write a separate response: call continue_delta_player_turn with the addressed entity's concise response in cinematicReply so the client posts it and keeps the same numbered turn open. Never invent an action that the player did not declare. Otherwise, if the action has uncertain success, risk, opposition, contested movement, attack, defense, stealth, persuasion, hacking, resistance, damage, or hazard interaction, do not resolve success/failure yet. Call request_delta_roll with the required die/count/label and governing STR/DEX/CON/INT/WIS/CHA ability, then stop; use NONE only if no stat applies. The client applies the selected entity's real modifier. If it is an opposed control action such as disarm, grapple, shove, restrain, escape, hold position, stealth versus detection, deception versus insight, or hacking versus active defense, treat it as a contested check: request the player's roll now, then after the client provides that roll, call request_delta_roll with rollerName and governing ability for the opposing entity if an opposing roll is needed. Compare authoritative modified totals only after all required client-generated rolls are returned. If no roll is needed, resolve exactly one compact outcome, persist entity changes, and stop without calling request_delta_action again for this same turn."
    } : {});
    if (sent) {
      setBody("");
      const latest = await db.deltaSessions.get(session.id);
      if (isReaction && latest && !latest.awaitingPlayerAction && !latest.awaitingPlayerRoll) {
        await db.deltaSessions.update(session.id, {
          reactionState: undefined,
          reactionSourceActorId: undefined,
          reactionTargetEntityId: undefined,
          reactionTrigger: undefined,
          reactionTurnNumber: undefined,
          updatedAt: now()
        });
      }
      if (session.initiativeStarted && session.awaitingPlayerAction && !latest?.awaitingPlayerAction && !latest?.awaitingPlayerRoll) await advanceTurn(turnActorId);
    }
  }
  function secureRollSample(sides: number) {
    if (!globalThis.crypto?.getRandomValues) throw new Error("Secure browser randomness is unavailable. Delta will not generate an unverifiable fallback roll.");
    const values = new Uint32Array(1);
    const range = 0x100000000;
    const limit = range - (range % sides);
    do {
      globalThis.crypto.getRandomValues(values);
    } while (values[0] >= limit);
    return { rawValue: values[0], result: (values[0] % sides) + 1 };
  }
  function rollDie(sides: number) {
    return secureRollSample(sides).result;
  }
  function createRollReceipt({
    toolName,
    rollerName,
    label,
    ability,
    modifier,
    die,
    results,
    rawValues,
    total
  }: {
    toolName: DeltaRollReceipt["toolName"];
    rollerName: string;
    label: string;
    ability?: DeltaRollAbility;
    modifier?: number;
    die: number;
    results: number[];
    rawValues: number[];
    total?: number;
  }): DeltaRollReceipt {
    return {
      id: uid(),
      source: "client-web-crypto",
      generator: "crypto.getRandomValues",
      algorithm: "uint32-rejection-sampling-v1",
      toolName,
      rollerName,
      label,
      ability,
      modifier,
      die,
      count: results.length,
      rawValues,
      results,
      total,
      generatedAt: now()
    };
  }
  async function rollDeltaDie(sides: number) {
    if (deltaBusyRef.current) return;
    if (session.awaitingPlayerRoll && session.requiredRollDie && sides !== session.requiredRollDie) return;
    const sample = secureRollSample(sides);
    const result = sample.result;
    if (session.awaitingPlayerRoll) {
      const results = [...(session.requiredRollResults ?? []), result];
      const rawValues = [...(session.requiredRollRawValues ?? []), sample.rawValue];
      const requiredCount = Math.max(1, session.requiredRollCount ?? 1);
      if (results.length < requiredCount) {
        await db.deltaSessions.update(session.id, { requiredRollResults: results, requiredRollRawValues: rawValues, updatedAt: now() });
        await onRefresh();
        return;
      }
      if ((session.requiredRollKind ?? "initiative") === "initiative") await resolveInitiative(results[0] ?? result);
      else {
        const latestSession = await db.deltaSessions.get(session.id);
        const ordered = (await db.deltaEntities.where("sessionId").equals(session.id).toArray())
          .filter(canTakeDeltaTurn)
          .sort((a, b) => a.orderIndex - b.orderIndex);
        const currentActor = ordered[latestSession?.turnIndex ?? session.turnIndex ?? 0];
        const playerEntity = latestSession?.settings.playerEntityId ? ordered.find((entity) => entity.id === latestSession.settings.playerEntityId) : undefined;
        const rollerName = latestSession?.requiredRollerName ?? currentActor?.name ?? playerEntity?.name ?? "Player";
        const label = latestSession?.requiredRollLabel || `${requiredCount}d${sides} roll`;
        const ability = latestSession?.requiredRollAbility;
        const modifier = latestSession?.requiredRollModifier ?? deltaRollModifier(playerEntity ?? currentActor, ability);
        const rollResult = deltaRollResultText(sides, results, modifier);
        const resultText = rollResult.text;
        const receipt = createRollReceipt({
          toolName: "player_delta_roll",
          rollerName,
          label,
          ability,
          modifier,
          die: sides,
          results,
          rawValues,
          total: rollResult.total
        });
        await addDeltaMessage(session.id, "system", `${rollerName}: Roll ${label}${ability ? ` (${ability})` : ""}: ${resultText}`, {
          turnNumber: session.requiredRollTurnNumber,
          eventType: "roll",
          rollReceipt: receipt
        });
        if (latestSession?.requiredRollKind === "reaction") {
          const reactionSucceeded = rollResult.total >= 6;
          if (reactionSucceeded) {
            await db.deltaSessions.update(session.id, {
              reactionState: "available",
              awaitingPlayerRoll: false,
              awaitingPlayerAction: true,
              actionPrompt: `Reaction available: ${latestSession.reactionTrigger ?? "respond to the immediate threat"}`,
              requiredRollDie: undefined,
              requiredRollCount: undefined,
              requiredRollResults: undefined,
              requiredRollKind: undefined,
              requiredRollLabel: undefined,
              requiredRollerName: undefined,
              requiredRollAbility: undefined,
              requiredRollModifier: undefined,
              requiredRollTurnNumber: undefined,
              requiredRollRawValues: undefined,
              updatedAt: now()
            });
            await onRefresh();
            return;
          }
          const sourceActorId = latestSession.reactionSourceActorId ?? currentActor?.id;
          const reactionTurnNumber = latestSession.reactionTurnNumber ?? latestSession.requiredRollTurnNumber;
          await db.deltaSessions.update(session.id, {
            reactionState: "resolving",
            awaitingPlayerRoll: false,
            awaitingPlayerAction: false,
            actionPrompt: undefined,
            requiredRollDie: undefined,
            requiredRollCount: undefined,
            requiredRollResults: undefined,
            requiredRollKind: undefined,
            requiredRollLabel: undefined,
            requiredRollerName: undefined,
            requiredRollAbility: undefined,
            requiredRollModifier: undefined,
            requiredRollTurnNumber: undefined,
            requiredRollRawValues: undefined,
            updatedAt: now()
          });
          await submitDeltaTurn(`Reaction check receipt ${receipt.id}: ${resultText}. Authoritative total: ${rollResult.total}; reaction threshold: 6.`, {
            hideUser: true,
            turnActorId: sourceActorId,
            turnNumber: reactionTurnNumber,
            instruction: `The client-generated reaction check failed. ${latestSession.reactionTrigger ? `Immediate threat: ${latestSession.reactionTrigger}. ` : ""}The player receives no reaction. Resume and finish exactly the interrupted attacker's current turn using the already established attack and roll context. Do not start another entity's turn, request another reaction for this target this round, or invent a replacement roll.`
          });
          const afterReaction = await db.deltaSessions.get(session.id);
          if (afterReaction?.initiativeStarted && !afterReaction.awaitingPlayerAction && !afterReaction.awaitingPlayerRoll) {
            await db.deltaSessions.update(session.id, {
              reactionState: undefined,
              reactionSourceActorId: undefined,
              reactionTargetEntityId: undefined,
              reactionTrigger: undefined,
              reactionTurnNumber: undefined,
              updatedAt: now()
            });
            await advanceTurn(sourceActorId);
          }
          return;
        }
        await db.deltaSessions.update(session.id, {
          awaitingPlayerRoll: false,
          requiredRollDie: undefined,
          requiredRollCount: undefined,
          requiredRollResults: undefined,
          requiredRollKind: undefined,
          requiredRollLabel: undefined,
          requiredRollerName: undefined,
          requiredRollAbility: undefined,
          requiredRollModifier: undefined,
          requiredRollTurnNumber: undefined,
          requiredRollRawValues: undefined,
          updatedAt: now()
        });
        await submitDeltaTurn(`Dice roll receipt ${receipt.id}: ${resultText}. Authoritative total: ${rollResult.total}.`, {
          hideUser: true,
          turnActorId: currentActor?.id,
          turnNumber: session.requiredRollTurnNumber,
          instruction: /damage/i.test(label)
            ? `This is the actual client-generated damage roll. The result and receipt ID are authoritative and already visibly logged. Before writing aftermath, call apply_delta_damage with the correct target entityId, final damage amount ${rollResult.total}, and receipt ID ${receipt.id}; never calculate or overwrite currentHp. Do not repeat the roll line.`
            : /(?:attack|strike|shot)/i.test(label)
              ? `This is the actual client-generated attack roll. The result and receipt ID are authoritative and already visibly logged. Determine hit or miss. If it hits, call request_delta_roll for the correct damage die/count with a label containing 'damage', then stop before writing hit aftermath. If it misses, resolve the miss without damage. Do not repeat the attack roll line or change HP from an attack roll.`
              : `This is the actual client-generated ${session.requiredRollLabel || `${requiredCount}d${sides} roll`}. The result and receipt ID are authoritative and already visibly logged. If this was a contested check and an opposing entity still needs a roll, call request_delta_roll with rollerName for that entity now; do not invent the opposing number. Compare totals only after all required client-generated rolls are returned. Resolve exactly one compact Delta outcome from this roll bundle. Include the aftermath and persist non-HP status/entity changes. If another player roll is required to finish this same action, call request_delta_roll with the next required die/count and stop. Otherwise stop without calling request_delta_action again for this same turn; the client will advance to the next entity.`
        });
        const latest = await db.deltaSessions.get(session.id);
        if (latest?.initiativeStarted && !latest.awaitingPlayerAction && !latest.awaitingPlayerRoll) {
          if (latest.reactionState === "resolving") {
            await db.deltaSessions.update(session.id, {
              reactionState: undefined,
              reactionSourceActorId: undefined,
              reactionTargetEntityId: undefined,
              reactionTrigger: undefined,
              reactionTurnNumber: undefined,
              updatedAt: now()
            });
          }
          await advanceTurn(latest.reactionSourceActorId ?? currentActor?.id);
        }
      }
      return;
    }
    await submitDeltaTurn(`Dice roll: d${sides} = ${result}`, {
      instruction: "This is an actual client-generated dice roll. The result is authoritative. Do not reroll, reinterpret the number, or replace it with an AI-chosen value. Respond with the concise Delta outcome."
    });
  }
  async function resolveInitiative(playerRoll: number) {
    const playerId = session.settings.playerEntityId ?? entities[0]?.id;
    if (!playerId) return;
    const ranked = entities
      .map((entity, index) => {
        const dexModifier = Math.floor(((entity.dex ?? 10) - 10) / 2);
        const rawRoll = entity.id === playerId ? playerRoll : rollDie(20);
        return {
          entity,
          rawRoll,
          dexModifier,
          initiative: rawRoll + dexModifier,
          index
        };
      })
      .sort((a, b) => b.initiative - a.initiative || a.index - b.index);
    const first = ranked[0];
    await db.transaction("rw", db.deltaEntities, db.deltaSessions, async () => {
      await Promise.all(ranked.map(({ entity, initiative }, orderIndex) => db.deltaEntities.update(entity.id, { initiative, orderIndex, updatedAt: now() })));
      await db.deltaSessions.update(session.id, {
        initiativeStarted: true,
        awaitingPlayerRoll: false,
        requiredRollDie: undefined,
        requiredRollCount: undefined,
        requiredRollResults: undefined,
        requiredRollKind: undefined,
        requiredRollLabel: undefined,
        requiredRollerName: undefined,
        requiredRollAbility: undefined,
        requiredRollModifier: undefined,
        requiredRollTurnNumber: undefined,
        requiredRollRawValues: undefined,
        actionPrompt: undefined,
        reactionUsedEntityIds: [],
        reactionState: undefined,
        reactionSourceActorId: undefined,
        reactionTargetEntityId: undefined,
        reactionTrigger: undefined,
        reactionTurnNumber: undefined,
        continuedTurnNumber: undefined,
        awaitingPlayerAction: first?.entity.id === playerId,
        turnIndex: 0,
        updatedAt: now()
      });
    });
    await addDeltaMessage(session.id, "system", `Initiative order (+DEX):\n${ranked.map(({ entity, rawRoll, dexModifier, initiative }, index) => `${index + 1}. ${entity.name}: ${rawRoll}${dexModifier === 0 ? "" : dexModifier > 0 ? ` + ${dexModifier}` : ` - ${Math.abs(dexModifier)}`} = ${initiative}`).join("\n")}`);
    await onRefresh();
  }
  function canTakeDeltaTurn(entity: DeltaEntity) {
    const state = entity.engagementState ?? "active";
    return state === "active" && (entity.currentHp === undefined || entity.currentHp > 0);
  }
  async function markFinishReadyIfOppositionResolved() {
    const current = await db.deltaSessions.get(session.id);
    if (!current?.active || !current.initiativeStarted) return false;
    if (current.finishReady) return true;
    const roster = await db.deltaEntities.where("sessionId").equals(session.id).toArray();
    const hostiles = roster.filter((entity) => entity.side === "hostile");
    if (!hostiles.length || hostiles.some(canTakeDeltaTurn)) return false;
    await db.deltaSessions.update(session.id, {
      finishReady: true,
      awaitingPlayerAction: false,
      awaitingPlayerRoll: false,
      actionPrompt: undefined,
      requiredRollDie: undefined,
      requiredRollCount: undefined,
      requiredRollResults: undefined,
      requiredRollKind: undefined,
      requiredRollLabel: undefined,
      requiredRollerName: undefined,
      requiredRollAbility: undefined,
      requiredRollModifier: undefined,
      requiredRollTurnNumber: undefined,
      requiredRollRawValues: undefined,
      reactionState: undefined,
      reactionSourceActorId: undefined,
      reactionTargetEntityId: undefined,
      reactionTrigger: undefined,
      reactionTurnNumber: undefined,
      continuedTurnNumber: undefined,
      updatedAt: now()
    });
    return true;
  }
  async function advanceTurn(expectedActorId?: string) {
    const current = await db.deltaSessions.get(session.id);
    if (await markFinishReadyIfOppositionResolved()) {
      await onRefresh();
      return;
    }
    const ordered = (await db.deltaEntities.where("sessionId").equals(session.id).toArray())
      .filter(canTakeDeltaTurn)
      .sort((a, b) => a.orderIndex - b.orderIndex);
    if (!current || !ordered.length || !current.initiativeStarted) return;
    if (current.awaitingPlayerRoll || current.awaitingPlayerAction) return;
    const expectedIndex = expectedActorId ? ordered.findIndex((entity) => entity.id === expectedActorId) : -1;
    const currentIndex = expectedIndex >= 0
      ? expectedIndex
      : Math.max(0, Math.min(current.turnIndex ?? 0, ordered.length - 1));
    const nextIndex = (currentIndex + 1) % ordered.length;
    const playerId = current.settings.playerEntityId ?? ordered[0]?.id;
    const next = ordered[nextIndex];
    await db.deltaSessions.update(session.id, {
      turnIndex: nextIndex,
      awaitingPlayerAction: next?.id === playerId,
      awaitingPlayerRoll: false,
      ...(nextIndex === 0 ? { reactionUsedEntityIds: [] } : {}),
      reactionState: undefined,
      reactionSourceActorId: undefined,
      reactionTargetEntityId: undefined,
      reactionTrigger: undefined,
      reactionTurnNumber: undefined,
      continuedTurnNumber: undefined,
      updatedAt: now()
    });
    await onRefresh();
  }
  async function nextTurn() {
    if (deltaBusyRef.current) return;
    if (!session.initiativeStarted || session.awaitingPlayerAction || session.awaitingPlayerRoll) return;
    const current = await db.deltaSessions.get(session.id);
    if (!current || !current.initiativeStarted || current.awaitingPlayerAction || current.awaitingPlayerRoll) return;
    if (await markFinishReadyIfOppositionResolved()) {
      await onRefresh();
      return;
    }
    const ordered = (await db.deltaEntities.where("sessionId").equals(session.id).toArray())
      .filter(canTakeDeltaTurn)
      .sort((a, b) => a.orderIndex - b.orderIndex);
    const actor = ordered[current.turnIndex ?? 0];
    if (!actor) return;
    const sent = await submitDeltaTurn(`${actor.name}'s turn.`, {
      hideUser: true,
      turnActorId: actor.id,
      instruction: `Play exactly one turn for ${actor.name}. If this turn involves attack, defense, hazard, detection, resistance, damage, contested movement, or another uncertain NPC/ally/non-player action, call request_delta_roll with rollerName, the needed die, and the governing STR/DEX/CON/INT/WIS/CHA ability instead of inventing the number; use NONE only if no stat applies. Do not announce tool use with lines such as 'Requesting roll', 'Calling for damage roll', or 'Rolling attack for X'. The client applies the entity's real stat modifier and displays every returned roll in its own verified row; resolve from the returned total without repeating the dice line in prose. When this turn directly threatens another active entity and a physically meaningful reaction could affect the outcome, wait until the initiating attack/check roll is known, then call request_delta_reaction before resolving damage or the final consequence. The client owns the 1d8 + DEX reaction check and one-reaction-per-round limit. A reaction remains inside ${actor.name}'s current turn. If verified damage occurs, call apply_delta_damage with the target entityId, final damage amount, returned receipt ID, and a zeroHpOutcome of ko or dead; never overwrite currentHp. If an entity escapes, set engagementState to escaped immediately. KO, DEAD, and ESCAPED entities cannot act. If another entity actively resists a disarm, grapple, shove, restrain, escape, stealth, deception, hacking, or similar opposed action, use contested logic and request the needed rolls through the client. Default to no separate cinematic cut-in; use one only for a major emotional, relationship, reveal, near-death, reversal, or scene-pivot beat after several ordinary turns without one. Write the action and consequence directly, without prefixes like 'Turn resolved:'. Use multiple short lines if needed. Add one or two small sensory or character-flavor details when they sharpen the moment, but do not expand into main-chat story prose. Persist status, relationship, distance, elevation, or engagement-state changes with update_delta_entity. Do not resolve any later turns and do not tell the player to let you know what happens next.`
    });
    if (sent) await advanceTurn(actor.id);
  }
  async function cacheCurrentGeneratedAllies() {
    await Promise.all(entities.map((entity) => upsertDeltaAllyCache(chat.id, entity)));
  }
  function finishContext(
    lootRoll: number,
    currencyRoll: { dice: number[]; amount: number },
    finishMessages: DeltaMessage[],
    finishEntities: DeltaEntity[]
  ) {
    const currencyName = project.currencyName?.trim() || "money";
    const extraLootInstruction = lootRoll === 6
      ? "Loot recovery roll: 1d6 = 6. Include one rare/special world-appropriate recoverable item, or three ordinary world-appropriate items plus one standout item if that fits better."
      : `Loot recovery roll: 1d6 = ${lootRoll}. Include exactly ${lootRoll} world-appropriate recoverable loot item${lootRoll === 1 ? "" : "s"}. Use the project's world setting as the main source of flavor. Quantities should fit the item, not default to 1 when another quantity makes more sense.`;
    return [
      "Finish the current Delta engagement and return only valid JSON with this exact object shape:",
      "{\"finalEngagementBeat\":\"\",\"outcomeSummary\":\"\",\"lootItems\":[{\"id\":\"\",\"name\":\"\",\"quantity\":1,\"pickedQuantity\":0}],\"parentChatHandoff\":\"\"}",
      "finalEngagementBeat: short in-world closing beat for the Delta transcript.",
      "outcomeSummary: comprehensive factual account of the engagement outcome. Identify every involved participant and their final condition. Record every meaningful wound, who caused it, how it happened, deaths, knockouts, escapes, captures, relationship changes, unresolved threats, discoveries, objective changes, and important scene/location consequences. Do not omit an injury merely because that character survived.",
      "lootItems: assess recoverable loot from the engagement before returning JSON. Include concrete gained/recoverable items with quantities when anything was plausibly taken, dropped, captured, found, protected, disarmed, looted, or recovered from the scene, objective, containers, defeated/captured entities, or abandoned carried gear. Use pickedQuantity 0 initially. Use an empty array only when there is truly nothing recoverable.",
      extraLootInstruction,
      "The loot recovery roll is client-generated and authoritative. Do not reroll it or change the count.",
      `Currency recovery roll: 3d4 digits = ${currencyRoll.dice.join(", ")} for ${currencyRoll.amount} ${currencyName}. Currency is handled by the client as its own inventory category. Do not include currency in lootItems. Do not add money, credits, coins, cash, or any currency equivalent as a loot item.`,
      "parentChatHandoff: write a detailed but condensed third-person narrative reconstruction that can stand alone as the next main-chat reply. It must read as though the engagement played out inside the story, not as a report to the user. Preserve chronological cause and effect: how the confrontation began, the meaningful actions and turning points, what each important participant did, every consequential injury and exactly how it was sustained, who was killed/knocked out/escaped/captured, how the engagement resolved, and the immediate state of the people and location afterward. Retain exact names, wounds, discoveries, objectives, and unresolved consequences. Condense repetition and routine failed actions, but do not sacrifice continuity-critical detail. Use several compact paragraphs when needed. Do not include the full turn log, dice values unless narratively essential, tool calls, debug text, UI wording, headings, or technical explanation.",
      `Project: ${project.name}`,
      project.instructions ? `Project instructions:\n${project.instructions}` : "",
      project.worldSetting ? `World setting:\n${project.worldSetting}` : "",
      `Final entity state:\n${finishEntities.map((entity) => `- ${entity.name}, ${entity.side}, state=${entity.engagementState ?? (entity.currentHp === 0 ? "ko" : "active")}, HP=${entity.currentHp ?? entity.maxHp ?? "?"}/${entity.maxHp ?? "?"}${entity.templateTag ? `, ${entity.templateTag}` : ""}${entity.statusText ? `, ${entity.statusText}` : ""}${entityPositionLabel(entity) ? `, ${entityPositionLabel(entity)}` : ""}`).join("\n") || "(none)"}`,
      `Complete active Delta transcript:\n${finishMessages.map((message) => `${message.turnNumber ? `Turn ${message.turnNumber} ` : ""}[${message.role}${message.eventType ? `/${message.eventType}` : ""}]: ${message.body}`).join("\n\n") || "(none)"}`
    ].filter(Boolean).join("\n\n");
  }
  async function startFinishFlow() {
    if (!session.active) return;
    setFinishError("");
    setFinishPacket(undefined);
    setFinishLootRoll(undefined);
    setFinishCurrencyRoll(undefined);
    setFinishCurrencyPicked(0);
    setFinishAwaitingLootRoll(true);
  }
  async function rollFinishLoot() {
    if (finishLoading) return;
    const lootRoll = rollDie(6);
    const currencyDice = [rollDie(4), rollDie(4), rollDie(4)];
    const currencyRoll = { dice: currencyDice, amount: Number(currencyDice.join("")) };
    setFinishLootRoll(lootRoll);
    setFinishCurrencyRoll(currencyRoll);
    setFinishCurrencyPicked(0);
    setFinishAwaitingLootRoll(false);
    await requestFinishPacket(lootRoll, currencyRoll);
  }
  async function requestFinishPacket(lootRoll: number, currencyRoll: { dice: number[]; amount: number }) {
    if (!settings.apiKey) {
      setFinishError("Add your OpenRouter API key before finishing Delta.");
      return;
    }
    const model = session.settings.modelId || chat.modelId || selectedModelId || settings.defaultModelId;
    if (!model) {
      setFinishError("Choose a model before finishing Delta.");
      return;
    }
    setFinishError("");
    setFinishLoading(true);
    try {
      await cacheCurrentGeneratedAllies();
      const [finishMessages, finishEntities] = await Promise.all([
        db.deltaMessages.where("sessionId").equals(session.id).toArray(),
        db.deltaEntities.where("sessionId").equals(session.id).toArray()
      ]);
      const completeTranscript = finishMessages
        .filter((message) => message.status === "complete" && message.body.trim() && message.body.trim() !== "...")
        .sort((a, b) => a.sequence - b.sequence);
      const finalEntities = finishEntities.sort((a, b) => a.orderIndex - b.orderIndex);
      const response = await deltaOpenRouterRequest({
        model,
        messages: [
          { role: "system", content: "You write continuity-complete, roleplay-facing Delta finish packets as valid JSON only. Preserve consequential detail while condensing repetition." },
          { role: "user", content: finishContext(lootRoll, currencyRoll, completeTranscript, finalEntities) }
        ],
        temperature: session.settings.temperature ?? 0,
        top_p: session.settings.topP ?? 0,
        ...(session.settings.maxTokens ? { max_tokens: session.settings.maxTokens } : {})
      });
      const json = await response.json() as OpenRouterResponse;
      const packet = parseDeltaFinishPacket(json.choices?.[0]?.message?.content ?? "");
      if (!packet.finalEngagementBeat || !packet.parentChatHandoff) throw new Error("Finish packet was missing required text.");
      await addDeltaMessage(session.id, "assistant", packet.finalEngagementBeat);
      setFinishPacket(packet);
      await onRefresh();
    } catch (error) {
      setFinishError(error instanceof Error ? error.message : "Finish packet failed.");
    } finally {
      setFinishLoading(false);
    }
  }
  function updateLootItem(id: string, patch: Partial<DeltaLootItem>) {
    if (!finishPacket) return;
    setFinishPacket({
      ...finishPacket,
      lootItems: finishPacket.lootItems.map((item) => {
        if (item.id !== id) return item;
        const quantity = Math.max(0, Math.floor(patch.quantity ?? item.quantity));
        const pickedQuantity = Math.max(0, Math.min(quantity, Math.floor(patch.pickedQuantity ?? item.pickedQuantity)));
        return { ...item, ...patch, quantity, pickedQuantity };
      })
    });
  }
  function pickUpAllLoot() {
    if (!finishPacket) return;
    setFinishPacket({ ...finishPacket, lootItems: finishPacket.lootItems.map((item) => ({ ...item, pickedQuantity: item.quantity })) });
  }
  function dropAllLoot() {
    if (!finishPacket) return;
    setFinishPacket({ ...finishPacket, lootItems: finishPacket.lootItems.map((item) => ({ ...item, pickedQuantity: 0 })) });
  }
  function hasUnclaimedLoot(packet = finishPacket) {
    const unclaimedItems = Boolean(packet?.lootItems.some((item) => item.pickedQuantity < item.quantity));
    const unclaimedCurrency = Boolean(finishCurrencyRoll && finishCurrencyPicked < finishCurrencyRoll.amount);
    return unclaimedItems || unclaimedCurrency;
  }
  async function continueFromFinish(force = false) {
    if (!finishPacket) return;
    if (!force && hasUnclaimedLoot()) {
      setForfeitConfirmOpen(true);
      return;
    }
    const timestamp = now();
    const picked = finishPacket.lootItems.filter((item) => item.pickedQuantity > 0);
    const pickedInventory = picked;
    const pickedCurrencyAmount = finishCurrencyRoll ? Math.max(0, Math.min(finishCurrencyRoll.amount, Math.floor(finishCurrencyPicked))) : 0;
    const currencyName = project.currencyName?.trim() || "money";
    const leftBehind = finishPacket.lootItems
      .map((item) => ({ name: item.name, quantity: Math.max(0, item.quantity - item.pickedQuantity) }))
      .filter((item) => item.quantity > 0);
    if (finishCurrencyRoll && pickedCurrencyAmount < finishCurrencyRoll.amount) {
      leftBehind.push({ name: currencyName, quantity: finishCurrencyRoll.amount - pickedCurrencyAmount });
    }
    const took = [
      ...picked.map((item) => ({ name: item.name, quantity: item.pickedQuantity })),
      ...(pickedCurrencyAmount > 0 ? [{ name: currencyName, quantity: pickedCurrencyAmount }] : [])
    ];
    const selectedCharacterName = playerEntityId
      ? (namesByEntityId.get(playerEntityId) ?? entities.find((entity) => entity.id === playerEntityId)?.name ?? "Someone")
      : "Someone";
    const conclusionMessage = [
      "\u0394 Concluded.",
      finishPacket.parentChatHandoff,
      "",
      `${selectedCharacterName} took: ${formatLootList(took)}`,
      leftBehind.length ? `Left behind: ${formatLootList(leftBehind)}` : ""
    ].join("\n");
    if ((picked.length || pickedCurrencyAmount > 0) && !project.inventoryEnabled) await db.projects.update(project.id, { inventoryEnabled: true, updatedAt: timestamp });
    if (!project.currencyName?.trim()) await db.projects.update(project.id, { currencyName: "money", updatedAt: timestamp });
    for (const item of pickedInventory) {
      await applyInventoryChange(project.id, chat.id, "inventory", item.name, item.pickedQuantity, `Recovered ${item.name} x ${item.pickedQuantity} from \u0394 ${session.title}.`);
    }
    if (pickedCurrencyAmount > 0) {
      const activeChat = await db.chats.get(chat.id);
      const amount = Math.max(0, (activeChat?.currencyAmount ?? 0) + pickedCurrencyAmount);
      await db.transaction("rw", db.chats, db.inventoryLogs, async () => {
        await db.chats.update(chat.id, { currencyAmount: amount, updatedAt: timestamp });
        await db.inventoryLogs.add({ id: uid(), projectId: project.id, chatId: chat.id, sentence: `Recovered ${currencyName} x ${pickedCurrencyAmount} from \u0394 ${session.title}.`, createdAt: timestamp, updatedAt: timestamp });
      });
    }
    await addMessage(chat.id, chat.activeBranchId, "assistant", conclusionMessage);
    await archiveDeltaSession(session.id, session.title);
    await pruneArchivedDeltaSessions();
    setFinishPacket(undefined);
    setFinishLootRoll(undefined);
    setFinishCurrencyRoll(undefined);
    setFinishCurrencyPicked(0);
    setFinishAwaitingLootRoll(false);
    setForfeitConfirmOpen(false);
    await onRefresh();
    onClose();
    if (window.history.state?.mirrorDeltaMode) window.history.back();
  }
  async function pruneArchivedDeltaSessions() {
    const limit = settingsDraft.maxHistoryMessages;
    if (limit === undefined) return;
    const archived = await db.deltaSessions.where("chatId").equals(chat.id).and((item) => !item.active).toArray();
    const removals = archived.sort((a, b) => b.updatedAt - a.updatedAt).slice(limit);
    if (removals.length === 0) return;
    const ids = removals.map((item) => item.id);
    await db.transaction("rw", [db.deltaSessions, db.deltaMessages, db.deltaEntities], async () => {
      await db.deltaMessages.where("sessionId").anyOf(ids).delete();
      await db.deltaEntities.where("sessionId").anyOf(ids).delete();
      await db.deltaSessions.where("id").anyOf(ids).delete();
    });
  }
  async function openArchived(sessionRecord: DeltaSession) {
    const [archivedMessages, archivedEntities] = await Promise.all([
      db.deltaMessages.where("sessionId").equals(sessionRecord.id).toArray(),
      db.deltaEntities.where("sessionId").equals(sessionRecord.id).toArray()
    ]);
    setPreviewSession(sessionRecord);
    setPreviewMessages(archivedMessages.sort((a, b) => a.sequence - b.sequence));
    setPreviewEntities(archivedEntities.sort((a, b) => a.orderIndex - b.orderIndex));
  }
  async function renameArchived(sessionRecord: DeltaSession) {
    const title = prompt("Rename archived engagement", sessionRecord.title)?.trim();
    if (!title) return;
    await db.deltaSessions.update(sessionRecord.id, { title, updatedAt: now() });
    setPreviewSession({ ...sessionRecord, title, updatedAt: now() });
    await onRefresh();
  }
  async function saveSettings() {
    const timestamp = now();
    await db.deltaSessions.update(session.id, { settings: settingsDraft, updatedAt: timestamp });
    await pruneArchivedDeltaSessions();
    showSaved();
    await onRefresh();
  }
  const settingsDirty = JSON.stringify(settingsDraft) !== JSON.stringify(session.settings);
  function requestSettingsNavigation(action: () => void) {
    if (settingsDirty) {
      pendingSettingsNavigationRef.current = action;
      setSettingsLeaveOpen(true);
      return;
    }
    action();
  }
  async function saveSettingsAndContinue() {
    await saveSettings();
    setSettingsLeaveOpen(false);
    pendingSettingsNavigationRef.current();
  }
  function discardSettingsAndContinue() {
    setSettingsDraft(session.settings);
    setSettingsLeaveOpen(false);
    pendingSettingsNavigationRef.current();
  }
  async function renameActiveEngagement() {
    const title = prompt("Name this Delta engagement", session.title)?.trim();
    if (!title || title === session.title) return;
    await db.deltaSessions.update(session.id, { title, updatedAt: now() });
    await onRefresh();
  }
  function insertMacro(template: string) {
    const textarea = composerRef.current;
    const start = textarea?.selectionStart ?? body.length;
    const end = textarea?.selectionEnd ?? body.length;
    const next = `${body.slice(0, start)}${template}${body.slice(end)}`;
    setBody(next);
    window.setTimeout(() => {
      composerRef.current?.focus();
      const cursor = start + template.length;
      composerRef.current?.setSelectionRange(cursor, cursor);
    }, 0);
  }
  function chooseMacro(macro: CharacterActionMacro) {
    if (macro.template === undefined) return;
    if (macro.requestEntitySelection) {
      setPendingEntityMacro(macro);
      setSelectedEntityIds(new Set());
      setActiveTool("entities");
      return;
    }
    insertMacro(macro.template);
  }
  function insertPendingEntityMacro() {
    if (!pendingEntityMacro?.template) return;
    const namesById = entityDisplayNames(entities);
    const names = entities
      .filter((entity) => selectedEntityIds.has(entity.id))
      .map((entity) => namesById.get(entity.id) ?? entity.name);
    const targetText = formatEntityNameList(names);
    const template = pendingEntityMacro.template.includes("{target}")
      ? pendingEntityMacro.template.split("{target}").join(targetText)
      : `${pendingEntityMacro.template}${pendingEntityMacro.template.endsWith(" ") ? "" : " "}${targetText}`;
    insertMacro(template);
    setPendingEntityMacro(undefined);
    setSelectedEntityIds(new Set());
    setActiveTool("actions");
  }
  function toggleSelectedEntity(id: string) {
    setSelectedEntityIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  async function updateEntityRelationship(entity: DeltaEntity, side: DeltaRelationship) {
    await db.deltaEntities.update(entity.id, { side, updatedAt: now() });
    if (side === "ally") await upsertDeltaAllyCache(chat.id, { ...entity, side });
    await onRefresh();
  }
  async function characterStatsPatch(character: Character) {
    const stats = await characterTemplateStats(project, character);
    return {
      characterId: character.id,
      name: character.name,
      str: stats.STR,
      dex: stats.DEX,
      con: stats.CON,
      int: stats.INT,
      wis: stats.WIS,
      cha: stats.CHA,
      maxHp: stats.maxHp,
      currentHp: stats.maxHp,
      templateTag: undefined,
      prefix: undefined,
      base: undefined,
      job: undefined,
      generatedStatsSource: undefined
    };
  }
  async function linkedCharacterContext() {
    const sessionEntities = await db.deltaEntities.where("sessionId").equals(session.id).toArray();
    const linkedIds = Array.from(new Set(sessionEntities.map((entity) => entity.characterId).filter(Boolean) as string[]));
    if (!linkedIds.length) return "";
    const rows = (await db.characters.bulkGet(linkedIds)).filter((character): character is Character => Boolean(character && character.projectId === project.id));
    const sections = await Promise.all(rows.map(async (character) => {
      const stats = await characterStatsPatch(character);
      return [
        `${character.name} (${character.id})`,
        `Identity: age=${character.age || ""}; gender=${character.gender || ""}; personality=${character.personality || ""}; misc=${character.misc || ""}`,
        `Stats: STR ${stats.str}, DEX ${stats.dex}, CON ${stats.con}, INT ${stats.int}, WIS ${stats.wis}, CHA ${stats.cha}`
      ].join("\n");
    }));
    return sections.join("\n\n");
  }
  async function addCharacterEntity(characterId: string) {
    const character = await db.characters.get(characterId);
    if (!character || character.projectId !== project.id) return;
    const timestamp = now();
    const stats = await characterStatsPatch(character);
    await db.deltaEntities.add({
      id: uid(),
      sessionId: session.id,
      ...stats,
      side: "neutral",
      statusText: "Awaiting engagement status.",
      distanceFromPlayer: "",
      elevation: "",
      orderIndex: entities.length,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    await onRefresh();
  }
  async function refreshEntityCharacterStats(entity: DeltaEntity) {
    if (!entity.characterId) return;
    const character = await db.characters.get(entity.characterId);
    if (!character || character.projectId !== project.id) return;
    const patch = await characterStatsPatch(character);
    const previousMax = entity.maxHp ?? patch.maxHp;
    const hpDelta = patch.maxHp - previousMax;
    await db.deltaEntities.update(entity.id, { ...patch, currentHp: Math.max(0, (entity.currentHp ?? patch.maxHp) + hpDelta), updatedAt: now() });
    await onRefresh();
  }
  async function linkCharacterToEntity(entity: DeltaEntity, characterId: string) {
    const character = await db.characters.get(characterId);
    if (!character || character.projectId !== project.id) return;
    await db.deltaEntities.update(entity.id, { ...(await characterStatsPatch(character)), updatedAt: now() });
    if (entity.id === playerEntityId) await db.chats.update(chat.id, { deltaPlayerCharacterId: character.id, updatedAt: now() });
    await onRefresh();
  }
  async function setPlayerCharacterData(characterId: string) {
    const player = entities.find((entity) => entity.id === playerEntityId);
    const patch = characterId ? await db.characters.get(characterId) : undefined;
    if (characterId && (!patch || patch.projectId !== project.id)) return;
    await db.chats.update(chat.id, { deltaPlayerCharacterId: characterId || undefined, updatedAt: now() });
    setPlayerCharacterId(characterId);
    if (player && patch) await db.deltaEntities.update(player.id, { ...(await characterStatsPatch(patch)), updatedAt: now() });
    await onRefresh();
  }
  function parseTemplateTag(value: string) {
    const clean = value.trim().toUpperCase().replace(/\s+/g, " ");
    const [first, job] = clean.split(" ");
    const [prefix, base] = first?.includes("-") ? first.split("-") : [undefined, first];
    return { prefix, base, job, templateTag: formatDeltaTemplateTag(prefix, base, job) };
  }
  async function saveCacheTag(entry: DeltaAllyCacheEntry) {
    const parsed = parseTemplateTag(cacheDraftTag);
    const patch = generatedStatsPatch(project, parsed);
    await db.deltaAllyCache.update(entry.id, {
      ...patch,
      templateTag: parsed.templateTag,
      prefix: parsed.prefix,
      base: parsed.base,
      job: parsed.job,
      updatedAt: now()
    });
    setCacheEditId(undefined);
    setCacheDraftTag("");
    await onRefresh();
  }
  function exportAllyCache() {
    downloadJson(`mirror-delta-ally-cache-${chat.title || chat.id}.json`, {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      chatTitle: chat.title,
      allyCache
    });
  }
  async function importAllyCache(file: File | undefined) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as { allyCache?: DeltaAllyCacheEntry[] };
      if (!Array.isArray(parsed.allyCache)) {
        setCacheImportStatus("Invalid ally cache file.");
        return;
      }
      const timestamp = now();
      const rows = parsed.allyCache
        .filter((entry) => entry.name?.trim())
        .map((entry) => ({ ...entry, id: uid(), chatId: chat.id, createdAt: timestamp, updatedAt: timestamp }));
      if (rows.length) await db.deltaAllyCache.bulkAdd(rows);
      setCacheImportStatus(`Imported ${rows.length} ally cache entr${rows.length === 1 ? "y" : "ies"}.`);
      await onRefresh();
    } catch {
      setCacheImportStatus("Import failed.");
    }
  }
  async function clearAllyCache() {
    await db.deltaAllyCache.where("chatId").equals(chat.id).delete();
    setClearCacheOpen(false);
    await onRefresh();
  }
  async function removeEntity(entity: DeltaEntity) {
    if (entity.id === playerEntityId) return;
    if (!confirm(`Remove ${entity.name} from this Delta engagement?`)) return;
    await db.deltaEntities.delete(entity.id);
    if (expandedEntityId === entity.id) setExpandedEntityId(undefined);
    await onRefresh();
  }
  function actionSlotName(slot: CharacterActionSlot, index = actionSlots.findIndex((item) => item.id === slot.id)) {
    return slot.name?.trim() || String(index + 1);
  }
  async function addActionSlot() {
    if (!actionCharacterId) return;
    const timestamp = now();
    const slot: CharacterActionSlot = { id: uid(), characterId: actionCharacterId, orderIndex: actionSlots.length, createdAt: timestamp, updatedAt: timestamp };
    await db.characterActionSlots.add(slot);
    await loadActionLibrary(actionCharacterId, slot.id);
  }
  async function renameActionSlot(slotId: string, name: string) {
    await db.characterActionSlots.update(slotId, { name: name.trim() || undefined, updatedAt: now() });
    await loadActionLibrary(actionCharacterId, slotId);
  }
  async function changeActionCharacter(characterId: string) {
    setActionCharacterId(characterId);
    await loadActionLibrary(characterId, "");
  }
  async function changeActionSlot(slotId: string) {
    await loadActionLibrary(actionCharacterId, slotId);
  }
  function addMacro(parentId: string | undefined, folder: boolean) {
    if (!selectedActionSlotId) return;
    setMacroDraft({ parentId, folder, label: "", template: "", requestEntitySelection: false });
  }
  function editMacro(macro: CharacterActionMacro) {
    setMacroDraft({
      macro,
      parentId: macro.parentId,
      folder: macro.template === undefined,
      label: macro.label,
      template: macro.template ?? "",
      requestEntitySelection: macro.requestEntitySelection ?? false
    });
  }
  async function saveMacroDraft() {
    if (!macroDraft) return;
    if (!selectedActionSlotId) return;
    const label = macroDraft.label.trim();
    if (!label) return;
    const timestamp = now();
    if (macroDraft.macro) {
      await db.characterActionMacros.update(macroDraft.macro.id, {
        label,
        template: macroDraft.folder ? undefined : macroDraft.template,
        requestEntitySelection: macroDraft.folder ? false : macroDraft.requestEntitySelection,
        updatedAt: timestamp
      });
    } else {
      const siblings = actionMacros.filter((macro) => macro.parentId === macroDraft.parentId);
      await db.characterActionMacros.add({
        id: uid(),
        slotId: selectedActionSlotId,
        parentId: macroDraft.parentId,
        label,
        template: macroDraft.folder ? undefined : macroDraft.template,
        requestEntitySelection: macroDraft.folder ? false : macroDraft.requestEntitySelection,
        orderIndex: (Math.max(-1, ...siblings.map((macro) => macro.orderIndex)) + 1),
        createdAt: timestamp,
        updatedAt: timestamp
      });
    }
    setMacroDraft(undefined);
    await loadActionLibrary(actionCharacterId, selectedActionSlotId);
  }
  async function deleteMacro(macro: CharacterActionMacro) {
    if (!confirm(`Delete "${macro.label}" and anything inside it?`)) return;
    const ids = new Set<string>([macro.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const item of actionMacros) {
        if (item.parentId && ids.has(item.parentId) && !ids.has(item.id)) {
          ids.add(item.id);
          grew = true;
        }
      }
    }
    await db.characterActionMacros.bulkDelete(Array.from(ids));
    await loadActionLibrary(actionCharacterId, selectedActionSlotId);
  }
  const playerEntityId = settingsDraft.playerEntityId ?? entities[0]?.id;
  const namesByEntityId = entityDisplayNames(entities);
  const orderedEntities = [...entities].sort((a, b) => a.orderIndex - b.orderIndex);
  const activeOrderedEntities = orderedEntities.filter(canTakeDeltaTurn);
  const turnIndex = Math.max(0, Math.min(session.turnIndex ?? 0, Math.max(0, activeOrderedEntities.length - 1)));
  const turnQueue = session.initiativeStarted ? [...activeOrderedEntities.slice(turnIndex), ...activeOrderedEntities.slice(0, turnIndex)] : [];
  const currentTurn = turnQueue[0];
  const requiredRollCount = Math.max(1, session.requiredRollCount ?? 1);
  const completedRollCount = session.requiredRollResults?.length ?? 0;
  const remainingRollCount = Math.max(1, requiredRollCount - completedRollCount);
  const requiredRollAbility = session.requiredRollKind === "initiative" ? "DEX" : session.requiredRollAbility;
  const requiredRollAbilityText = requiredRollAbility ? ` + ${requiredRollAbility}` : "";
  const requiredRollText = `${remainingRollCount} ${remainingRollCount === 1 ? "roll" : "rolls"} (d${session.requiredRollDie ?? 20}${requiredRollAbilityText}) left`;
  const revealTextEnabled = project.deltaRevealText !== false;
  const revealSpeed = Math.max(1, Math.min(10, Math.round(project.deltaRevealSpeed ?? 5)));
  const revealStepMs = deltaRevealStepMs(revealSpeed);
  const currentTurnLabel = session.awaitingPlayerRoll
    ? `Roll ${requiredRollCount}d${session.requiredRollDie ?? 20}${requiredRollAbilityText} for ${session.requiredRollLabel || "initiative"}`
    : currentTurn
      ? (namesByEntityId.get(currentTurn.id) ?? currentTurn.name)
      : "Engagement";
  const currentTurnNumber = session.continuedTurnNumber ?? deltaLogTurnCount(messages) + 1;
  const inputDisabled = Boolean(deltaBusy || session.awaitingPlayerRoll || (session.initiativeStarted && !session.awaitingPlayerAction));
  const isArchivedSession = !session.active;
  const relationshipForEntity = (entity?: DeltaEntity) => normaliseDeltaRelationship(entity?.side ?? "neutral");
  const entityByDisplayName = new Map(orderedEntities.flatMap((entity) => {
    const displayName = namesByEntityId.get(entity.id) ?? entity.name;
    return [[displayName.trim().toLowerCase(), entity], [entity.name.trim().toLowerCase(), entity]] as const;
  }));
  const relationshipForInitiativeLine = (line: string) => {
    const name = line.replace(/^\s*\d+\.\s*/, "").split(":")[0]?.trim().toLowerCase();
    return relationshipForEntity(name ? entityByDisplayName.get(name) : undefined);
  };
  let displayedTurnNumber = 0;
  let lastDisplayedTurnNumber: number | undefined;
  let legacyRollPendingResolution = false;
  let revealCursorMs = 0;
  const numberForMessage = (message: DeltaMessage) => {
    if (message.turnNumber !== undefined) {
      displayedTurnNumber = Math.max(displayedTurnNumber, message.turnNumber);
      const showNumber = lastDisplayedTurnNumber !== message.turnNumber;
      lastDisplayedTurnNumber = message.turnNumber;
      return showNumber ? String(message.turnNumber).padStart(2, "0") : "";
    }
    if (message.role === "assistant" && legacyRollPendingResolution && displayedTurnNumber > 0) {
      legacyRollPendingResolution = false;
      return "";
    }
    legacyRollPendingResolution = false;
    displayedTurnNumber += 1;
    lastDisplayedTurnNumber = displayedTurnNumber;
    return String(displayedTurnNumber).padStart(2, "0");
  };
  let previewTurnNumber = 0;
  let lastPreviewTurnNumber: number | undefined;
  let previewLegacyRollPendingResolution = false;
  const numberForPreviewMessage = (message: DeltaMessage) => {
    if (message.turnNumber !== undefined) {
      previewTurnNumber = Math.max(previewTurnNumber, message.turnNumber);
      const showNumber = lastPreviewTurnNumber !== message.turnNumber;
      lastPreviewTurnNumber = message.turnNumber;
      return showNumber ? String(message.turnNumber).padStart(2, "0") : "";
    }
    if (message.role === "assistant" && previewLegacyRollPendingResolution && previewTurnNumber > 0) {
      previewLegacyRollPendingResolution = false;
      return "";
    }
    previewLegacyRollPendingResolution = false;
    previewTurnNumber += 1;
    lastPreviewTurnNumber = previewTurnNumber;
    return String(previewTurnNumber).padStart(2, "0");
  };
  const previewEntityByName = new Map(previewEntities.map((entity) => [entity.name.trim().toLowerCase(), entity]));
  return (
    <div className="delta-layer">
      <div className="delta-dim" aria-hidden="true" />
      <aside className="delta-workspace">
        <div className="delta-top">
          <div className="delta-title-block">
            <h2><Swords size={18} /> Delta Mode</h2>
            {!isArchivedSession && <strong className="delta-engagement-name" title={session.title}>{session.title || "Untitled Engagement"}</strong>}
            <small title={`${project.name} / ${chat.title}`}>{project.name} / {chat.title}</small>
          </div>
          {!isArchivedSession && <button className="icon-button" onClick={renameActiveEngagement} aria-label="Rename Delta engagement" title={session.title || "Name engagement"}><Edit3 size={16} /></button>}
        </div>
        <nav className="delta-toolbar" aria-label="Delta tools">
          {!isArchivedSession && <>
            <button className={activeTool === "entities" ? "picked" : ""} onClick={() => requestSettingsNavigation(() => setActiveTool(activeTool === "entities" ? undefined : "entities"))} aria-label="Entity list"><UserRound size={18} /></button>
            <button className={activeTool === "map" ? "picked" : ""} onClick={() => requestSettingsNavigation(() => setActiveTool(activeTool === "map" ? undefined : "map"))} aria-label="Map"><MapIcon size={18} /></button>
            <button onClick={() => requestSettingsNavigation(onOpenInventory)} aria-label="Inventory"><ShoppingBag size={18} /></button>
          </>}
          <button className={`delta-archive-button ${activeTool === "history" ? "picked" : ""}`} onClick={() => requestSettingsNavigation(() => setActiveTool(activeTool === "history" ? undefined : "history"))} aria-label="Archive"><Archive size={16} /><span>Archive</span></button>
          {!isArchivedSession && <button className="delta-settings-button" onClick={() => requestSettingsNavigation(onOpenProjectDeltaSettings)} aria-label="Project Delta settings" title="Project Delta settings"><Settings size={17} /></button>}
        </nav>
        {!isArchivedSession && <div className={`delta-turn-queue-wrap ${turnQueueEdges.left ? "show-left" : ""} ${turnQueueEdges.right ? "show-right" : ""}`}>
          <div className="delta-turn-queue" aria-label="Turn order" ref={turnQueueRef} onScroll={updateTurnQueueEdges}>
            {turnQueue.map((entity, index) => (
              <span className={`${relationshipForEntity(entity)} ${index === 0 ? "active" : ""}`} key={entity.id}>
                {entity.orderIndex + 1}. {namesByEntityId.get(entity.id) ?? entity.name}
              </span>
            ))}
          </div>
        </div>}
        {activeTool && activeTool !== "actions" && (
          <section className={`delta-tool-panel ${activeTool === "map" ? "delta-map-tool-panel" : ""}`}>
            {activeTool === "entities" && (
              <>
                <div className="section-title">
                  <h2>{pendingEntityMacro ? "Select Targets" : "Entity List"}</h2>
                  <div className="split-actions">
                    {pendingEntityMacro && <span className="save-status">Macro target</span>}
                    <button className="icon-button" onClick={() => setEntitySettingsOpen(!entitySettingsOpen)} aria-label="Entity settings"><Settings size={16} /></button>
                  </div>
                </div>
                {entitySettingsOpen && (
                  <section className="entity-settings-panel stack">
                    <div className="tabs compact-tabs">
                      <button className={entitySettingsTab === "entities" ? "active" : ""} onClick={() => setEntitySettingsTab("entities")}>Entities</button>
                      <button className={entitySettingsTab === "ally-cache" ? "active" : ""} onClick={() => setEntitySettingsTab("ally-cache")}>Ally Cache</button>
                    </div>
                    {entitySettingsTab === "entities" && (
                      <>
                        <label>Highlighted player<select value={playerEntityId ?? ""} onChange={(event) => setSettingsDraft({ ...settingsDraft, playerEntityId: event.target.value })}>{entities.map((entity) => <option value={entity.id} key={entity.id}>{namesByEntityId.get(entity.id) ?? entity.name}</option>)}</select></label>
                        <label>Player character data
                          <select value={playerCharacterId} onChange={(event) => void setPlayerCharacterData(event.target.value)}>
                            <option value="">Not linked</option>
                            {projectCharacters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
                          </select>
                        </label>
                        <div className="split-actions"><button onClick={saveSettings}><Save size={18} /> Save entity settings</button>{saved && <span className="save-status">Saved</span>}</div>
                        <label>Add involved character
                          <select defaultValue="" onChange={(event) => { if (event.target.value) void addCharacterEntity(event.target.value); event.currentTarget.value = ""; }}>
                            <option value="">Choose from character data...</option>
                            {projectCharacters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
                          </select>
                        </label>
                        <p className="notice">Linked characters import their current stats from the project character database. Engagement-only entities can use readable PREFIX-BASE JOB tags.</p>
                      </>
                    )}
                    {entitySettingsTab === "ally-cache" && (
                      <div className="stack">
                        <div className="split-actions">
                          <button onClick={exportAllyCache}><Download size={16} /> Export</button>
                          <label className="file-pick"><Upload size={16} /> Import<input type="file" accept="application/json" onChange={(event) => void importAllyCache(event.target.files?.[0])} /></label>
                          <button className="danger" onClick={() => setClearCacheOpen(true)}>Clear all</button>
                        </div>
                        {cacheImportStatus && <p className="save-status">{cacheImportStatus}</p>}
                        {allyCache.length === 0 && <p className="notice">No generated allies cached for this chat yet.</p>}
                        <div className="ally-cache-list">
                          {allyCache.map((entry) => (
                            <section className="ally-cache-row" key={entry.id}>
                              <div>
                                <strong>{entry.name}</strong>
                                {cacheEditId === entry.id ? (
                                  <input value={cacheDraftTag} onChange={(event) => setCacheDraftTag(event.target.value)} placeholder="DEX-LIGHT ROGUE" />
                                ) : (
                                  <small>{entry.templateTag || "No template tag"}</small>
                                )}
                              </div>
                              <button className={cacheEditId === entry.id ? "picked" : ""} onClick={() => { setCacheEditId(entry.id); setCacheDraftTag(entry.templateTag ?? ""); }} aria-label={`Edit ${entry.name} cache tag`}><Pencil size={15} /></button>
                              {cacheEditId === entry.id && <button onClick={() => saveCacheTag(entry)}><Save size={15} /> Save</button>}
                            </section>
                          ))}
                        </div>
                      </div>
                    )}
                  </section>
                )}
                <div className="delta-entity-list">
                  {orderedEntities.map((entity) => {
                    const hp = entity.currentHp ?? 0;
                    const maxHp = entity.maxHp || 1;
                    const displayName = namesByEntityId.get(entity.id) ?? entity.name;
                    const relationship = normaliseDeltaRelationship(entity.side);
                    return (
                      <div key={entity.id} className="delta-entity-wrap">
                        <div
                          className={`delta-entity ${relationship} ${entity.id === playerEntityId ? "player" : ""} ${selectedEntityIds.has(entity.id) ? "selected" : ""} ${canTakeDeltaTurn(entity) ? "" : "inactive"}`}
                          onClick={() => pendingEntityMacro ? toggleSelectedEntity(entity.id) : setExpandedEntityId(expandedEntityId === entity.id ? undefined : entity.id)}
                        >
                          <small className="delta-initiative">{entity.initiative ?? "-"}</small>
                          <span>{displayName}{entity.templateTag && <small className="delta-template-tag">{entity.templateTag}</small>}</span>
                          <HpSquares current={hp} max={maxHp} relationship={relationship} />
                          <small>{hp}/{maxHp} HP</small>
                          <small className="delta-relationship-label">{deltaRelationshipLabel(relationship)}</small>
                        {entityPositionLabel(entity) && <small className="delta-position">{entityPositionLabel(entity)}</small>}
                        <small className="delta-status">{entity.engagementState && entity.engagementState !== "active" ? entity.engagementState.toUpperCase() : entity.statusText || "No status"}</small>
                      </div>
                      {expandedEntityId === entity.id && (
                        <div className="delta-entity-detail">
                          <p>{entity.statusText || "No current Delta status."}</p>
                          <div className="delta-stat-grid">
                            {deltaEntityStats(entity).map(([label, value]) => (
                              <span key={label}><b>{label}</b><strong>{value ?? "-"}</strong><small>{statModifier(value)}</small></span>
                            ))}
                          </div>
                          {entitySettingsOpen && entitySettingsTab === "entities" && (
                            <div className="split-actions">
                              <label>Relationship
                                <select value={relationship} onChange={(event) => void updateEntityRelationship(entity, event.target.value as DeltaRelationship)}>
                                  {deltaRelationships.map((value) => <option key={value} value={value}>{deltaRelationshipLabel(value)}</option>)}
                                </select>
                              </label>
                              <label>Character data
                                <select value={entity.characterId ?? ""} onChange={(event) => { if (event.target.value) void linkCharacterToEntity(entity, event.target.value); }}>
                                  <option value="">Not linked</option>
                                  {projectCharacters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
                                </select>
                              </label>
                              {entity.characterId && <button onClick={() => refreshEntityCharacterStats(entity)}>Refresh character stats</button>}
                              {entity.id !== playerEntityId && <button className="danger" onClick={() => removeEntity(entity)}>Remove</button>}
                            </div>
                          )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {pendingEntityMacro && (
                  <div className="split-actions">
                    <button onClick={insertPendingEntityMacro} disabled={selectedEntityIds.size === 0}>Insert selected</button>
                    <button onClick={() => { setPendingEntityMacro(undefined); setSelectedEntityIds(new Set()); }}>Cancel</button>
                  </div>
                )}
              </>
            )}
            {activeTool === "map" && <DeltaMapPrototype entities={orderedEntities} tiles={session.mapTiles ?? []} size={session.mapSize ?? "M"} />}
            {activeTool === "history" && (
              <div className="stack">
                <div className="section-title"><h2>Archive</h2><div className="split-actions"><span>{archivedSessions.length}</span><button className={`icon-button ${archiveSettingsOpen ? "picked" : ""}`} onClick={() => setArchiveSettingsOpen(!archiveSettingsOpen)} aria-label="Archive settings" title="Archive settings"><Settings size={16} /></button></div></div>
                {archiveSettingsOpen && <div className="stack archive-settings">
                  <label className="range-row">
                    <span>Archived engagements <b>{settingsDraft.maxHistoryMessages === undefined ? "infinite" : settingsDraft.maxHistoryMessages}</b></span>
                    <input
                      type="range"
                      min={0}
                      max={archiveLimitOptions.length - 1}
                      value={settingsDraft.maxHistoryMessages === undefined ? archiveLimitOptions.length - 1 : Math.max(0, archiveLimitOptions.findIndex((value) => value === settingsDraft.maxHistoryMessages))}
                      onChange={(event) => {
                        const value = archiveLimitOptions[Number(event.target.value)];
                        setSettingsDraft({ ...settingsDraft, maxHistoryMessages: value === Infinity ? undefined : value });
                      }}
                    />
                  </label>
                  <div className="split-actions"><button onClick={saveSettings}><Save size={18} /> Save</button>{saved && <span className="save-status">Saved</span>}</div>
                </div>}
                {finishError && <p className="import-errors">{finishError}</p>}
                <div className="delta-history-list">
                  {archivedSessions.length === 0 && <p className="notice">No archived Delta engagements for this chat yet.</p>}
                  {archivedSessions.map((item) => (
                    <button key={item.id} onClick={() => openArchived(item)}>
                      <span>{item.title}</span>
                      <small>{formatDate(item.archivedAt ?? item.updatedAt)}</small>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
        <div className="delta-body" ref={deltaBodyRef}>
          {isArchivedSession ? (
            <section className="delta-archived-state">
              <Archive size={22} />
              <strong>No active engagement</strong>
              <span>Open Archive to review past engagements.</span>
            </section>
          ) : <div className="delta-messages">
            {messages.map((message) => {
              if (message.role === "system") {
                if (message.rollReceipt) {
                  const rollerEntity = entityByDisplayName.get(message.rollReceipt.rollerName.trim().toLowerCase());
                  const animateRoll = revealTextEnabled && revealMessageIds.has(message.id);
                  const revealDelayMs = animateRoll ? revealCursorMs : 0;
                  if (animateRoll) revealCursorMs += revealStepMs;
                  return (
                    <DeltaVerifiedRollRow
                      key={message.id}
                      message={message}
                      relationship={relationshipForEntity(rollerEntity)}
                      expanded={expandedRollId === message.id}
                      onToggle={() => setExpandedRollId(expandedRollId === message.id ? undefined : message.id)}
                      animate={animateRoll}
                      revealDelayMs={revealDelayMs}
                      onReveal={scrollDeltaToLatest}
                    />
                  );
                }
                const initiativeLines = message.body.startsWith("Initiative order")
                  ? message.body.split("\n").slice(1).filter((line) => line.trim())
                  : [];
                const isRollNotice = isDeltaRollNotice(message.body);
                if (isRollNotice) legacyRollPendingResolution = displayedTurnNumber > 0;
                return (
                  <article className={`delta-log-brief ${isRollNotice ? "delta-roll-notice" : ""}`} key={message.id}>
                    {initiativeLines.length > 0 ? (
                      <div className="delta-initiative-list">
                        <strong>Initiative order</strong>
                        {initiativeLines.map((line) => (
                          <span className={relationshipForInitiativeLine(line)} key={line}>{line}</span>
                        ))}
                      </div>
                    ) : (
                      <div className="message-body"><MarkdownText text={message.body} inventoryMarkers /></div>
                    )}
                  </article>
                );
              }
              const visibleBody = cleanDeltaToolCallText(message.body);
              if (!visibleBody) return null;
              const cinematicSplit = splitDeltaCinematic(visibleBody);
              const bodyText = cinematicSplit.turn;
              const cinematicOnly = Boolean(cinematicSplit.cinematic && !bodyText);
              const isLoading = message.status === "pending" && bodyText.trim() === "...";
              const animateMessage = revealTextEnabled && revealMessageIds.has(message.id) && !isLoading;
              const cinematicDelayMs = animateMessage ? revealCursorMs : 0;
              if (animateMessage && cinematicSplit.cinematic) revealCursorMs += deltaRevealLines(cinematicSplit.cinematic).length * revealStepMs;
              if (cinematicOnly) {
                return (
                  <article className="delta-cinematic-beat" key={message.id}>
                    <span className="delta-log-number delta-cinematic-icon">{cinematicMarker()}</span>
                    <div className="message-body"><DeltaTurnText text={cinematicSplit.cinematic} animate={animateMessage} startDelayMs={cinematicDelayMs} stepMs={revealStepMs} onReveal={scrollDeltaToLatest} /></div>
                  </article>
                );
              }
              const bodyDelayMs = animateMessage ? revealCursorMs : 0;
              if (animateMessage) revealCursorMs += deltaRevealLines(bodyText).length * revealStepMs;
              const numberLabel = numberForMessage(message);
              const effectiveTurnNumber = message.turnNumber ?? displayedTurnNumber;
              const rowEntity = session.initiativeStarted && activeOrderedEntities.length > 0
                ? activeOrderedEntities[Math.max(0, effectiveTurnNumber - 1) % activeOrderedEntities.length]
                : undefined;
              return (
                <Fragment key={message.id}>
                  {cinematicSplit.cinematic && (
                    <article className="delta-cinematic-beat">
                      <span className="delta-log-number delta-cinematic-icon">{cinematicMarker()}</span>
                      <div className="message-body"><DeltaTurnText text={cinematicSplit.cinematic} animate={animateMessage} startDelayMs={cinematicDelayMs} stepMs={revealStepMs} onReveal={scrollDeltaToLatest} /></div>
                    </article>
                  )}
                  <article className={`delta-log-row ${message.role === "user" ? "user" : "assistant"} ${relationshipForEntity(rowEntity)}`}>
                    <span className="delta-log-number">{numberLabel}</span>
                    <div className="message-body">{isLoading ? <LoadingSignal /> : <DeltaTurnText text={bodyText} animate={animateMessage} startDelayMs={bodyDelayMs} stepMs={revealStepMs} onReveal={scrollDeltaToLatest} />}</div>
                  </article>
                </Fragment>
              );
            })}
          </div>}
        </div>
        {!isArchivedSession && <div className="delta-turn-status">
          <span className="delta-ap-box"><b>AP</b><strong>4/4</strong></span>
          <div className="delta-current-turn">Turn {currentTurnNumber}: {currentTurnLabel}</div>
          {session.awaitingPlayerAction && !session.awaitingPlayerRoll && (
            <div className={`delta-turn-callout ${session.reactionState === "available" ? "reaction" : ""}`}>
              {session.reactionState === "available" ? session.actionPrompt || "Reaction available." : "It is your turn."}
            </div>
          )}
        </div>}
        {!isArchivedSession && session.awaitingPlayerRoll && <div className="delta-floating-prompt roll">{requiredRollText}</div>}
        {!isArchivedSession && session.awaitingPlayerRoll && deltaDiceImages[session.requiredRollDie ?? 20] && (
          <button className="delta-roll-image" type="button" onClick={() => rollDeltaDie(session.requiredRollDie ?? 20)} disabled={deltaBusy} aria-label={`Roll d${session.requiredRollDie ?? 20}`}>
            <img src={deltaDiceImages[session.requiredRollDie ?? 20]} alt={`d${session.requiredRollDie ?? 20}`} />
          </button>
        )}
        {!isArchivedSession && session.finishReady && (
          <section className="delta-finish-ready-bar">
            <button className="delta-end-engagement" onClick={startFinishFlow} disabled={finishLoading || finishAwaitingLootRoll}>{finishLoading ? "Finishing..." : "End Engagement"}</button>
          </section>
        )}
        {!isArchivedSession && !session.finishReady && <section className="composer delta-composer">
          <button className="delta-composer-tool" type="button" onClick={() => undefined} disabled={deltaBusy || session.awaitingPlayerRoll} aria-label="Movement" title="Movement"><Share2 size={18} /><span>MOVE</span></button>
          <button className="delta-composer-tool" type="button" onClick={() => { if (deltaBusy || session.awaitingPlayerRoll) return; setActiveTool(activeTool === "actions" ? undefined : "actions"); }} disabled={deltaBusy || session.awaitingPlayerRoll} aria-label="Actions" title="Actions"><Zap size={18} /><span>ACTIONS</span></button>
          <textarea ref={composerRef} value={body} onChange={(event) => setBody(event.target.value)} onFocus={() => keepComposerVisible(composerRef.current)} onClick={() => keepComposerVisible(composerRef.current)} disabled={inputDisabled} placeholder={session.awaitingPlayerRoll ? "Waiting on your roll..." : session.reactionState === "available" ? "Write your reaction" : session.awaitingPlayerAction ? "Write your move" : currentTurn ? `Next: ${currentTurn.name}` : "Write Delta message"} rows={2} />
          <button className="send-button" onClick={send} disabled={inputDisabled}>Send</button>
          <button className="delta-next-button" type="button" onClick={nextTurn} disabled={deltaBusy || !session.initiativeStarted || session.awaitingPlayerAction || session.awaitingPlayerRoll}>Next</button>
        </section>}
        {!isArchivedSession && activeTool === "actions" && !deltaBusy && !session.awaitingPlayerRoll && (
          <section className="delta-actions-panel">
            <div className="section-title">
              <h2>Actions</h2>
              <div className="split-actions">
                <label className="action-slot-header-select">Save slot
                  <select value={selectedActionSlotId} onChange={(event) => void changeActionSlot(event.target.value)} disabled={!actionCharacterId || actionSlots.length === 0}>
                    {actionSlots.map((slot, index) => <option key={slot.id} value={slot.id}>{actionSlotName(slot, index)}</option>)}
                  </select>
                </label>
                <button className={actionsEditMode ? "picked" : ""} onClick={() => setActionsEditMode(!actionsEditMode)} aria-label="Toggle action editing"><Pencil size={16} /></button>
                {actionsEditMode && actionCharacterId && <button onClick={addActionSlot}>+ Slot</button>}
                {actionsEditMode && selectedActionSlotId && <button onClick={() => addMacro(undefined, true)}>+ Menu</button>}
                {actionsEditMode && selectedActionSlotId && <button onClick={() => addMacro(undefined, false)}>+ Action</button>}
              </div>
            </div>
            <div className="action-library-controls">
              {actionsEditMode && (
                <label>Character
                  <select value={actionCharacterId} onChange={(event) => void changeActionCharacter(event.target.value)}>
                    <option value="">Choose character</option>
                    {projectCharacters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
                  </select>
                </label>
              )}
              {actionsEditMode && selectedActionSlotId && (
                <label>Slot name
                  <input value={actionSlots.find((slot) => slot.id === selectedActionSlotId)?.name ?? ""} onChange={(event) => void renameActionSlot(selectedActionSlotId, event.target.value)} placeholder={actionSlots.find((slot) => slot.id === selectedActionSlotId) ? actionSlotName(actionSlots.find((slot) => slot.id === selectedActionSlotId)!) : "Slot name"} />
                </label>
              )}
            </div>
            {!actionCharacterId && <p className="notice">Choose a character in edit mode to create action slots.</p>}
            {actionCharacterId && actionMacros.length === 0 && <p className="notice">Create text macros here. Selecting a macro inserts text into the composer without sending it.</p>}
            {actionCharacterId && <DeltaActionTree macros={actionMacros} parentId={undefined} editMode={actionsEditMode} onChoose={chooseMacro} onAdd={addMacro} onEdit={editMacro} onDelete={deleteMacro} />}
          </section>
        )}
      </aside>
      {macroDraft && (
        <div className="modal-backdrop" onClick={() => setMacroDraft(undefined)}>
          <section className="modal macro-editor" onClick={(event) => event.stopPropagation()}>
            <div className="section-title">
              <h2>{macroDraft.macro ? "Edit Action" : macroDraft.folder ? "New Menu" : "New Action"}</h2>
              <button className="icon-button" onClick={() => setMacroDraft(undefined)} aria-label="Close action editor"><X size={18} /></button>
            </div>
            <label>Name<input value={macroDraft.label} onChange={(event) => setMacroDraft({ ...macroDraft, label: event.target.value })} /></label>
            {!macroDraft.folder && (
              <>
                <label>Text template<textarea value={macroDraft.template} onChange={(event) => setMacroDraft({ ...macroDraft, template: event.target.value })} rows={4} placeholder="Halle uses basic attack on {target}" /></label>
                <label className="compact-check"><input type="checkbox" checked={macroDraft.requestEntitySelection} onChange={(event) => setMacroDraft({ ...macroDraft, requestEntitySelection: event.target.checked })} /> Ask me to choose one or more targets before inserting</label>
              </>
            )}
            <div className="split-actions">
              <button onClick={saveMacroDraft}><Save size={18} /> Save</button>
              <button onClick={() => setMacroDraft(undefined)}>Cancel</button>
            </div>
          </section>
        </div>
      )}
      {settingsLeaveOpen && (
        <div className="modal-backdrop confirm-backdrop" onClick={() => setSettingsLeaveOpen(false)}>
          <section className="confirm-modal delta-settings-leave-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-title">
              <h2>Unsaved Delta settings</h2>
              <button className="icon-button" onClick={() => setSettingsLeaveOpen(false)} aria-label="Stay in Delta settings"><X size={18} /></button>
            </div>
            <p>You have changes in this Delta workspace that have not been saved.</p>
            <div className="split-actions">
              <button onClick={saveSettingsAndContinue}><Save size={16} /> Save and continue</button>
              <button onClick={discardSettingsAndContinue}>Discard</button>
            </div>
          </section>
        </div>
      )}
      {clearCacheOpen && (
        <div className="modal-backdrop" onClick={() => setClearCacheOpen(false)}>
          <section className="modal macro-editor" onClick={(event) => event.stopPropagation()}>
            <div className="section-title">
              <h2>Clear Ally Cache</h2>
              <button className="icon-button" onClick={() => setClearCacheOpen(false)} aria-label="Close clear cache dialog"><X size={18} /></button>
            </div>
            <p className="notice">This removes generated ally cache entries for this chat only. It does not delete project characters or Delta messages.</p>
            <div className="split-actions">
              <button className="danger" onClick={clearAllyCache}><Trash2 size={18} /> Clear cache</button>
              <button onClick={() => setClearCacheOpen(false)}>Cancel</button>
            </div>
          </section>
        </div>
      )}
      {finishAwaitingLootRoll && !finishPacket && (
        <div className="modal-backdrop delta-finish-backdrop" onClick={() => undefined}>
          <section className="modal delta-loot-roll-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-title">
              <h2>Roll For Loot</h2>
              <button className="icon-button" type="button" onClick={() => { setFinishAwaitingLootRoll(false); setFinishLootRoll(undefined); setFinishCurrencyRoll(undefined); setFinishCurrencyPicked(0); }} aria-label="Cancel loot roll"><X size={18} /></button>
            </div>
            <p className="notice">Roll 1d6 to search the scene for recoverable loot. Currency is rolled separately in the background.</p>
            <button className="delta-loot-roll-button" type="button" onClick={rollFinishLoot} disabled={finishLoading} aria-label="Roll d6 for loot">
              <img src={deltaDiceImages[6]} alt="d6" />
            </button>
          </section>
        </div>
      )}
      {finishPacket && (
        <div className="modal-backdrop delta-finish-backdrop" onClick={() => undefined}>
          <section className="modal delta-finish-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-title">
              <h2>Finish Engagement</h2>
              <button className="icon-button" type="button" onClick={() => { setFinishPacket(undefined); setFinishLootRoll(undefined); setFinishCurrencyRoll(undefined); setFinishCurrencyPicked(0); setFinishAwaitingLootRoll(false); }} aria-label="Close finish review"><X size={18} /></button>
            </div>
            <section className="stack">
              <h3>Outcome</h3>
              <MarkdownText text={finishPacket.outcomeSummary} />
            </section>
            {finishCurrencyRoll && (
              <section className="stack">
                <h3>Currency</h3>
                <small className="loot-roll-note">Currency roll: 3d4 digits = {finishCurrencyRoll.dice.join(", ")} ({finishCurrencyRoll.amount})</small>
                <div className="loot-review-row currency-recovery-row">
                  <div className="loot-item-name">
                    <strong>{project.currencyName?.trim() || "money"}</strong>
                    <small>{finishCurrencyPicked}/{finishCurrencyRoll.amount}</small>
                  </div>
                  <div className="quantity-stepper">
                    <button type="button" onClick={() => setFinishCurrencyPicked(Math.max(0, finishCurrencyPicked - 1))} aria-label="Take less currency">-</button>
                    <input
                      type="number"
                      min={0}
                      max={finishCurrencyRoll.amount}
                      value={finishCurrencyPicked}
                      onChange={(event) => setFinishCurrencyPicked(Math.max(0, Math.min(finishCurrencyRoll.amount, Math.floor(Number(event.target.value) || 0))))}
                      aria-label={`${project.currencyName?.trim() || "money"} amount to recover`}
                    />
                    <button type="button" onClick={() => setFinishCurrencyPicked(Math.min(finishCurrencyRoll.amount, finishCurrencyPicked + 1))} aria-label="Take more currency">+</button>
                  </div>
                  <div className="loot-row-actions">
                    <button type="button" onClick={() => setFinishCurrencyPicked(finishCurrencyRoll.amount)}>Pick Up</button>
                    <button type="button" onClick={() => setFinishCurrencyPicked(0)}>Drop All</button>
                  </div>
                </div>
              </section>
            )}
            <section className="stack">
              <div className="section-title">
                <h3>Loot</h3>
                {finishPacket.lootItems.length > 0 && (
                  <div className="split-actions compact">
                    <button type="button" onClick={pickUpAllLoot}>Pick Up All</button>
                    <button type="button" onClick={dropAllLoot}>Drop All</button>
                  </div>
                )}
              </div>
              {finishLootRoll && <small className="loot-roll-note">Loot roll: 1d6 = {finishLootRoll}</small>}
              {finishPacket.lootItems.length > 0 ? (
                <div className="loot-review-list">
                  {finishPacket.lootItems.map((item) => (
                    <div className="loot-review-row" key={item.id}>
                      <div className="loot-item-name">
                        <strong>{item.name}</strong>
                        <small>{item.pickedQuantity}/{item.quantity}</small>
                      </div>
                      <div className="quantity-stepper">
                        <button type="button" onClick={() => updateLootItem(item.id, { pickedQuantity: item.pickedQuantity - 1 })} aria-label={`Take less ${item.name}`}>-</button>
                        <input
                          type="number"
                          min={0}
                          max={item.quantity}
                          value={item.pickedQuantity}
                          onChange={(event) => updateLootItem(item.id, { pickedQuantity: Number(event.target.value) })}
                          aria-label={`${item.name} quantity to pick up`}
                        />
                        <button type="button" onClick={() => updateLootItem(item.id, { pickedQuantity: item.pickedQuantity + 1 })} aria-label={`Take more ${item.name}`}>+</button>
                      </div>
                      <div className="loot-row-actions">
                        <button type="button" onClick={() => updateLootItem(item.id, { pickedQuantity: item.quantity })}>Pick Up</button>
                        <button type="button" onClick={() => updateLootItem(item.id, { pickedQuantity: 0 })}>Drop All</button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="notice">No recoverable loot was listed for this engagement.</p>
              )}
            </section>
            <div className="split-actions">
              <button className="send-button" type="button" onClick={() => continueFromFinish(false)}>Continue</button>
              <button type="button" onClick={() => { setFinishPacket(undefined); setFinishLootRoll(undefined); setFinishCurrencyRoll(undefined); setFinishCurrencyPicked(0); setFinishAwaitingLootRoll(false); }}>Cancel</button>
            </div>
          </section>
        </div>
      )}
      {forfeitConfirmOpen && (
        <div className="modal-backdrop delta-finish-backdrop" onClick={() => setForfeitConfirmOpen(false)}>
          <section className="modal macro-editor" onClick={(event) => event.stopPropagation()}>
            <div className="section-title">
              <h2>Continue in main chat?</h2>
              <button className="icon-button" type="button" onClick={() => setForfeitConfirmOpen(false)} aria-label="Close loot warning"><X size={18} /></button>
            </div>
            <p className="notice">You will forfeit any untouched loot.</p>
            <div className="split-actions">
              <button className="danger" type="button" onClick={() => continueFromFinish(true)}>Continue</button>
              <button type="button" onClick={() => setForfeitConfirmOpen(false)}>Review loot</button>
            </div>
          </section>
        </div>
      )}
      {previewSession && (
        <div className="modal-backdrop" onClick={() => setPreviewSession(undefined)}>
          <section className="modal delta-archive-preview" onClick={(event) => event.stopPropagation()}>
            <div className="section-title">
              <h2>{previewSession.title}</h2>
              <button onClick={() => renameArchived(previewSession)}><Edit3 size={16} /> Rename</button>
              <button className="icon-button" onClick={() => setPreviewSession(undefined)} aria-label="Close archived engagement"><X size={18} /></button>
            </div>
            <p className="notice">Archived Delta engagements are read-only reference records and are not used for future Delta prompts, summaries, or compaction.</p>
            <div className="delta-messages delta-archive-log">
              {previewMessages.map((message) => {
                if (message.role === "system") {
                  if (message.rollReceipt) {
                    const rollerEntity = previewEntityByName.get(message.rollReceipt.rollerName.trim().toLowerCase());
                    return (
                      <DeltaVerifiedRollRow
                        key={message.id}
                        message={message}
                        relationship={relationshipForEntity(rollerEntity)}
                        expanded={expandedRollId === message.id}
                        onToggle={() => setExpandedRollId(expandedRollId === message.id ? undefined : message.id)}
                      />
                    );
                  }
                  const initiativeLines = message.body.startsWith("Initiative order")
                    ? message.body.split("\n").slice(1).filter((line) => line.trim())
                    : [];
                  if (isDeltaRollNotice(message.body)) previewLegacyRollPendingResolution = previewTurnNumber > 0;
                  return (
                    <article className="delta-log-brief" key={message.id}>
                      {initiativeLines.length > 0 ? (
                        <div className="delta-initiative-list">
                          <strong>Initiative order</strong>
                          {initiativeLines.map((line) => {
                            const name = line.replace(/^\s*\d+\.\s*/, "").split(":")[0]?.trim().toLowerCase();
                            return <span className={relationshipForEntity(name ? previewEntityByName.get(name) : undefined)} key={line}>{line}</span>;
                          })}
                        </div>
                      ) : <div className="message-body"><DeltaTurnText text={message.body} /></div>}
                    </article>
                  );
                }
                const cinematicSplit = splitDeltaCinematic(message.body);
                const bodyText = cinematicSplit.turn;
                if (cinematicSplit.cinematic && !bodyText) {
                  return (
                    <article className="delta-cinematic-beat" key={message.id}>
                      <span className="delta-log-number delta-cinematic-icon">{cinematicMarker()}</span>
                      <div className="message-body"><DeltaTurnText text={cinematicSplit.cinematic} /></div>
                    </article>
                  );
                }
                const numberLabel = numberForPreviewMessage(message);
                const effectiveTurnNumber = message.turnNumber ?? previewTurnNumber;
                const rowEntity = previewSession.initiativeStarted && previewEntities.length > 0
                  ? previewEntities[Math.max(0, effectiveTurnNumber - 1) % previewEntities.length]
                  : undefined;
                return (
                  <Fragment key={message.id}>
                    {cinematicSplit.cinematic && (
                      <article className="delta-cinematic-beat">
                        <span className="delta-log-number delta-cinematic-icon">{cinematicMarker()}</span>
                        <div className="message-body"><DeltaTurnText text={cinematicSplit.cinematic} /></div>
                      </article>
                    )}
                    <article className={`delta-log-row ${message.role === "user" ? "user" : "assistant"} ${relationshipForEntity(rowEntity)}`}>
                      <span className="delta-log-number">{numberLabel}</span>
                      <div className="message-body"><DeltaTurnText text={bodyText} /></div>
                    </article>
                  </Fragment>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function DeltaActionTree({
  macros,
  parentId,
  editMode,
  onChoose,
  onAdd,
  onEdit,
  onDelete
}: {
  macros: CharacterActionMacro[];
  parentId?: string;
  editMode: boolean;
  onChoose: (macro: CharacterActionMacro) => void;
  onAdd: (parentId: string | undefined, folder: boolean) => void;
  onEdit: (macro: CharacterActionMacro) => void;
  onDelete: (macro: CharacterActionMacro) => void;
}) {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const children = macros.filter((macro) => macro.parentId === parentId).sort((a, b) => a.orderIndex - b.orderIndex);
  if (children.length === 0) return null;
  return (
    <div className="delta-action-tree">
      {children.map((macro) => {
        const isMenu = macro.template === undefined;
        const open = openIds.has(macro.id);
        return (
          <div className="delta-action-node" key={macro.id}>
            <div className="delta-action-row">
              <button
                type="button"
                onClick={() => {
                  if (!isMenu) {
                    onChoose(macro);
                    return;
                  }
                  setOpenIds((current) => {
                    const next = new Set(current);
                    if (next.has(macro.id)) next.delete(macro.id);
                    else next.add(macro.id);
                    return next;
                  });
                }}
              >
                {isMenu ? (open ? "v " : "> ") : ""}{macro.label}
              </button>
              {editMode && isMenu && <button type="button" onClick={() => onAdd(macro.id, true)}>+ Menu</button>}
              {editMode && isMenu && <button type="button" onClick={() => onAdd(macro.id, false)}>+ Action</button>}
              {editMode && <button type="button" onClick={() => onEdit(macro)}>Edit</button>}
              {editMode && <button type="button" onClick={() => onDelete(macro)}>-</button>}
            </div>
            {isMenu && open && (
              <DeltaActionTree
                macros={macros}
                parentId={macro.id}
                editMode={editMode}
                onChoose={onChoose}
                onAdd={onAdd}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function InventoryLogList({ logs, onRefresh }: { logs: InventoryLog[]; onRefresh: () => Promise<void> }) {
  const [activeLogId, setActiveLogId] = useState<string>();
  const [editLogId, setEditLogId] = useState<string>();
  const [deleteLogId, setDeleteLogId] = useState<string>();
  const [draft, setDraft] = useState("");
  const [pressTimer, setPressTimer] = useState<number>();
  async function remove(id: string) {
    await db.inventoryLogs.delete(id);
    setActiveLogId(undefined);
    setDeleteLogId(undefined);
    await onRefresh();
  }
  async function save(id: string) {
    await db.inventoryLogs.update(id, { sentence: draft, updatedAt: now() });
    setEditLogId(undefined);
    setActiveLogId(undefined);
    await onRefresh();
  }
  return (
    <div className="stack">
      {logs.length === 0 && <p className="muted-pad">No inventory changes logged yet.</p>}
      {logs.map((log) => (
        <section
          className="inventory-log"
          key={log.id}
          onPointerDown={() => setPressTimer(window.setTimeout(() => setActiveLogId(log.id), 520))}
          onPointerUp={() => { if (pressTimer) window.clearTimeout(pressTimer); }}
          onContextMenu={(event) => { event.preventDefault(); setActiveLogId(log.id); }}
        >
          {editLogId === log.id ? <input value={draft} onChange={(event) => setDraft(event.target.value)} /> : <p>{log.sentence}</p>}
          {activeLogId === log.id && <div className="context-menu"><button onClick={() => { setDraft(log.sentence); setEditLogId(log.id); }}>Edit</button><button className="danger" onClick={() => setDeleteLogId(log.id)}>Delete</button></div>}
          {editLogId === log.id && <button onClick={() => save(log.id)}><Save size={16} /> Save</button>}
        </section>
      ))}
      {deleteLogId && (
        <div className="modal-backdrop inventory-confirm-backdrop" onClick={() => setDeleteLogId(undefined)}>
          <section className="confirm-modal inventory-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <h2>Delete Log Entry</h2>
            <p>Delete this inventory log entry?</p>
            <div className="split-actions">
              <button className="danger" onClick={() => remove(deleteLogId)}>Delete</button>
              <button onClick={() => setDeleteLogId(undefined)}>Cancel</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function MothMark() {
  return (
    <svg className="moth" viewBox="0 0 48 48" aria-hidden="true">
      <path d="M24 7 14 20l10 22 10-22z" />
      <path d="M21 18 5 10l7 22 9-4M27 18l16-8-7 22-9-4" />
      <path d="M24 7v35" />
    </svg>
  );
}

function Drawer(props: {
  open: boolean;
  projects: Project[];
  selectedProjectId?: string;
  chats: Chat[];
  selectedChatId?: string;
  onClose: () => void;
  onRoute: (route: RouteName) => void;
  onProject: (id: string) => void;
  onChat: (id: string) => void;
  onRenameChat: (id: string) => Promise<void>;
  onDeleteChat: (id: string) => Promise<void>;
  onToggleProjectPin: (id: string) => Promise<void>;
  onToggleChatPin: (id: string) => Promise<void>;
}) {
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [activeChatId, setActiveChatId] = useState<string>();
  const [activeProjectId, setActiveProjectId] = useState<string>();
  const pressTimer = useRef<number>();
  const longPressedItem = useRef<string>();
  const orderedProjects = [...props.projects].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || a.orderIndex - b.orderIndex);
  const visibleProjects = showAllProjects ? orderedProjects : orderedProjects.slice(0, 3);
  const hiddenProjectCount = Math.max(0, orderedProjects.length - 3);
  const selectedProject = props.projects.find((project) => project.id === props.selectedProjectId);
  const orderedChats = [...props.chats].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt);

  function clearPressTimer() {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = undefined;
  }

  function beginPress(itemId: string, onLongPress: () => void) {
    clearPressTimer();
    pressTimer.current = window.setTimeout(() => {
      longPressedItem.current = itemId;
      onLongPress();
    }, 520);
  }

  function runClick(itemId: string, action: () => void) {
    if (longPressedItem.current === itemId) {
      longPressedItem.current = undefined;
      return;
    }
    action();
  }
  return (
    <>
      {props.open && <button className="drawer-backdrop" onClick={props.onClose} aria-label="Close navigation" />}
      <aside className={`drawer ${props.open ? "open" : ""}`} aria-hidden={!props.open}>
        <div className="drawer-head">
          <MothMark />
          <div>
            <strong>Mirror 2.0</strong>
            <span>local-first workspace</span>
          </div>
          <button className="icon-button" onClick={props.onClose} aria-label="Close navigation">
            <X size={20} />
          </button>
        </div>
        <DrawerSection title="Projects">
          {visibleProjects.map((project) => (
            <div className="nav-project" key={project.id}>
              <button
                className={`nav-row ${project.id === props.selectedProjectId ? "active" : ""}`}
                onClick={() => runClick(`project:${project.id}`, () => props.onProject(project.id))}
                onPointerDown={() => beginPress(`project:${project.id}`, () => setActiveProjectId(project.id))}
                onPointerUp={clearPressTimer}
                onPointerLeave={clearPressTimer}
                onPointerCancel={clearPressTimer}
                onContextMenu={(event) => { event.preventDefault(); setActiveProjectId(project.id); }}
              >
                <ProjectIcon name={project.iconName} color={project.iconColor} /> <span>{project.name}</span>{project.pinned && <Pin className="nav-pin" size={13} fill="currentColor" aria-label="Pinned" />}
              </button>
              {activeProjectId === project.id && <div className="row-context-menu"><button onClick={async () => { await props.onToggleProjectPin(project.id); setActiveProjectId(undefined); }}><Pin size={15} /> {project.pinned ? "Unpin" : "Pin"}</button><button onClick={() => setActiveProjectId(undefined)}><X size={15} /> Close</button></div>}
            </div>
          ))}
          {hiddenProjectCount > 0 && <div className="drawer-project-more-row"><button className="drawer-expand-link" onClick={() => setShowAllProjects((current) => !current)}>{showAllProjects ? "Show fewer projects" : `… and ${hiddenProjectCount} other project${hiddenProjectCount === 1 ? "" : "s"}`}</button><button className="icon-button drawer-manage-button" onClick={() => props.onRoute("projects")} aria-label="Manage projects" title="Manage projects"><Settings size={15} /></button></div>}
        </DrawerSection>
        {selectedProject ? (
          <DrawerSection title="Selected project">
            <div className="selected-project-row"><div className="selected-project-display"><ProjectIcon name={selectedProject.iconName} color={selectedProject.iconColor} /> <span>{selectedProject.name}</span></div><button className="icon-button" onClick={() => props.onRoute("projectEdit")} aria-label={`Open ${selectedProject.name} settings`} title="Project settings"><Settings size={18} /></button></div>
            <div className="drawer-project-tools">
            {(["stars", "characters", "archives", "memories"] as RouteName[]).map((route) => (
              <button className="nav-row" key={route} onClick={() => props.onRoute(route)}>
                {routeIcon(route)} {routeLabels[route]}
              </button>
            ))}
            </div>
          </DrawerSection>
        ) : (
          <p className="muted-pad">Choose a project before starting a chat.</p>
        )}
        <DrawerSection title="Chats">
          {props.chats.length === 0 && <p className="muted-pad">No chats yet.</p>}
          {orderedChats.map((chat) => (
            <div className="nav-chat" key={chat.id}>
              <button
                className={`nav-row ${chat.id === props.selectedChatId ? "active" : ""}`}
                onClick={() => runClick(`chat:${chat.id}`, () => props.onChat(chat.id))}
                onPointerDown={() => beginPress(`chat:${chat.id}`, () => setActiveChatId(chat.id))}
                onPointerUp={clearPressTimer}
                onPointerLeave={clearPressTimer}
                onPointerCancel={clearPressTimer}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setActiveChatId(chat.id);
                }}
              >
                <MessageSquare size={18} /> <span>{chat.title}</span>{chat.pinned && <Pin className="nav-pin" size={13} fill="currentColor" aria-label="Pinned" />}
              </button>
              {activeChatId === chat.id && (
                <div className="row-context-menu">
                  <button onClick={async () => { await props.onToggleChatPin(chat.id); setActiveChatId(undefined); }}><Pin size={15} /> {chat.pinned ? "Unpin" : "Pin"}</button>
                  <button onClick={async () => { await props.onRenameChat(chat.id); setActiveChatId(undefined); }}><Edit3 size={15} /> Rename</button>
                  <button className="danger" onClick={async () => { await props.onDeleteChat(chat.id); setActiveChatId(undefined); }}><Trash2 size={15} /> Delete</button>
                  <button onClick={() => setActiveChatId(undefined)}><X size={15} /> Close</button>
                </div>
              )}
            </div>
          ))}
        </DrawerSection>
        <div className="drawer-foot">
          <button className="nav-row" onClick={() => props.onRoute("settings")}>
            <Settings size={18} /> App Settings
          </button>
        </div>
      </aside>
    </>
  );
}

function DrawerSection({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <section className="drawer-section">
      <div className="section-title"><button className="drawer-section-toggle" onClick={() => setCollapsed((current) => !current)} aria-expanded={!collapsed}><h2>{title}</h2><ChevronRight className={collapsed ? "" : "expanded"} size={15} /></button>{action}</div>
      {!collapsed && children}
    </section>
  );
}

function routeIcon(route: RouteName) {
  const icons: Partial<Record<RouteName, JSX.Element>> = {
    stars: <Star size={18} />,
    characters: <UserRound size={18} />,
    archives: <Archive size={18} />,
    memories: <BookOpen size={18} />,
    projects: <Archive size={18} />,
    projectEdit: <Settings size={18} />,
    sourceFiles: <Folder size={18} />
  };
  return icons[route] ?? <MessageSquare size={18} />;
}

function ChatScreen({
  project,
  chat,
  messages,
  settings,
  onRefresh,
  onChatCreated,
  onRoute,
  selectedModelId,
  models,
  deltaLocked,
  onOpenDelta,
  onSettingsSaved
}: {
  project?: Project;
  chat?: Chat;
  messages: Message[];
  settings: AppSettings;
  onRefresh: () => Promise<void>;
  onChatCreated: (id: string) => void | Promise<void>;
  onRoute: (route: RouteName) => void;
  selectedModelId: string;
  models: { modelId: string; cosmeticName: string }[];
  deltaLocked: boolean;
  onOpenDelta: (chat: Chat, startContext: string, mapSize?: DeltaMapSize) => Promise<void>;
  onSettingsSaved: (modelId: string) => Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [contextOpen, setContextOpen] = useState(false);
  const [chatSettingsOpen, setChatSettingsOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelSaving, setModelSaving] = useState(false);
  const [modelSaveError, setModelSaveError] = useState("");
  const [draftModelId, setDraftModelId] = useState(selectedModelId);
  const [includeWorld, setIncludeWorld] = useState(settings.includeWorld ?? true);
  const [includeInstructions, setIncludeInstructions] = useState(settings.includeInstructions ?? true);
  const [includeCharacters, setIncludeCharacters] = useState(settings.includeCharacters ?? false);
  const [includeSourceFiles, setIncludeSourceFiles] = useState(settings.includeSourceFiles ?? false);
  const [temperature, setTemperature] = useState(settings.temperature?.toString() ?? "0");
  const [topP, setTopP] = useState(settings.topP?.toString() ?? "0");
  const [maxTokens, setMaxTokens] = useState(settings.maxTokens?.toString() ?? "");
  const [maxHistory, setMaxHistory] = useState(settings.maxHistoryMessages?.toString() ?? "");
  const [historyNoLimit, setHistoryNoLimit] = useState(!settings.maxHistoryMessages);
  const [infiniteWarningOpen, setInfiniteWarningOpen] = useState(false);
  const [compactionEnabled, setCompactionEnabled] = useState(settings.compactionEnabled ?? false);
  const [streamingEnabled, setStreamingEnabled] = useState(settings.streamingEnabled ?? true);
  const [autoManageInventory, setAutoManageInventory] = useState(settings.autoManageInventory ?? false);
  const [confirmInventoryUpdates, setConfirmInventoryUpdates] = useState(settings.confirmInventoryUpdates ?? true);
  const [autoManageGear, setAutoManageGear] = useState(settings.autoManageGear ?? false);
  const [confirmGearUpdates, setConfirmGearUpdates] = useState(settings.confirmGearUpdates ?? true);
  const [inventoryEnabled, setInventoryEnabled] = useState(project?.inventoryEnabled ?? false);
  const [gearEnabled, setGearEnabled] = useState(project?.gearEnabled ?? false);
  const [attachedImages, setAttachedImages] = useState<File[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [previewImageIndex, setPreviewImageIndex] = useState<number>();
  const [expandedMessageId, setExpandedMessageId] = useState<string>();
  const [saved, showSaved] = useSavedNotice();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const imagePickerRef = useRef<HTMLInputElement>(null);
  const filePickerRef = useRef<HTMLInputElement>(null);
  const imagePreviewUrls = useMemo(() => attachedImages.map((file) => ({ file, url: URL.createObjectURL(file) })), [attachedImages]);
  useEffect(() => () => imagePreviewUrls.forEach((item) => URL.revokeObjectURL(item.url)), [imagePreviewUrls]);
  useEffect(() => {
    setDraftModelId(selectedModelId);
    setIncludeWorld(settings.includeWorld ?? true);
    setIncludeInstructions(settings.includeInstructions ?? true);
    setIncludeCharacters(settings.includeCharacters ?? false);
    setIncludeSourceFiles(settings.includeSourceFiles ?? false);
    setTemperature(settings.temperature?.toString() ?? "0");
    setTopP(settings.topP?.toString() ?? "0");
    setMaxTokens(settings.maxTokens?.toString() ?? "");
    setMaxHistory(settings.maxHistoryMessages?.toString() ?? "");
    setHistoryNoLimit(Boolean(chat?.infiniteHistoryLocked) || !settings.maxHistoryMessages);
    setCompactionEnabled(settings.compactionEnabled ?? false);
    setStreamingEnabled(settings.streamingEnabled ?? true);
    setAutoManageInventory(settings.autoManageInventory ?? false);
    setConfirmInventoryUpdates(settings.confirmInventoryUpdates ?? true);
    setAutoManageGear(settings.autoManageGear ?? false);
    setConfirmGearUpdates(settings.confirmGearUpdates ?? true);
  }, [settings, selectedModelId, chat?.id, chat?.infiniteHistoryLocked]);
  useEffect(() => {
    setInventoryEnabled(project?.inventoryEnabled ?? false);
    setGearEnabled(project?.gearEnabled ?? false);
    setInfiniteWarningOpen(false);
  }, [project?.id, project?.inventoryEnabled, project?.gearEnabled]);
  useEffect(() => setInfiniteWarningOpen(false), [chat?.id]);
  useEffect(() => {
    const composer = composerRef.current;
    fitComposerTextarea(composer);
    keepComposerVisible(composer);
  }, [body]);
  useEffect(() => {
    const handleViewportChange = () => {
      fitComposerTextarea(composerRef.current);
      keepComposerVisible(composerRef.current);
    };
    window.visualViewport?.addEventListener("resize", handleViewportChange);
    window.visualViewport?.addEventListener("scroll", handleViewportChange);
    return () => {
      window.visualViewport?.removeEventListener("resize", handleViewportChange);
      window.visualViewport?.removeEventListener("scroll", handleViewportChange);
    };
  }, []);
  useEffect(() => {
    if (!chatSettingsOpen) return;
    const closeFromHistory = (event: PopStateEvent) => {
      if (!(event.state as { mirrorChatSettings?: boolean } | null)?.mirrorChatSettings) {
        setChatSettingsOpen(false);
        setModelMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeChatSettings();
    };
    window.addEventListener("popstate", closeFromHistory);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("popstate", closeFromHistory);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [chatSettingsOpen]);
  const infiniteHistoryLocked = Boolean(chat?.infiniteHistoryLocked);
  const effectiveHistoryNoLimit = infiniteHistoryLocked || historyNoLimit;
  async function persistChatSettings(lockInfiniteHistory = false) {
    const timestamp = now();
    await db.settings.update("settings", {
      defaultModelId: draftModelId || undefined,
      temperature: optionalNumber(temperature),
      topP: optionalNumber(topP),
      maxTokens: optionalNumber(maxTokens),
      maxHistoryMessages: effectiveHistoryNoLimit ? undefined : optionalNumber(maxHistory),
      compactionEnabled,
      includeWorld,
      includeInstructions,
      includeCharacters,
      includeSourceFiles,
      streamingEnabled,
      autoManageInventory,
      confirmInventoryUpdates,
      autoManageGear,
      confirmGearUpdates,
      updatedAt: timestamp
    });
    if (project) await db.projects.update(project.id, { inventoryEnabled, gearEnabled, updatedAt: timestamp });
    if (chat && lockInfiniteHistory) await db.chats.update(chat.id, { infiniteHistoryLocked: true, updatedAt: timestamp });
    setInfiniteWarningOpen(false);
    showSaved();
    await onSettingsSaved(draftModelId);
  }
  async function saveChatSettings() {
    if (chat && effectiveHistoryNoLimit && !infiniteHistoryLocked) {
      setInfiniteWarningOpen(true);
      return;
    }
    await persistChatSettings();
  }
  function openChatSettings() {
    setContextOpen(false);
    setModelMenuOpen(false);
    setChatSettingsOpen(true);
    window.history.pushState({ ...window.history.state, mirrorChatSettings: true }, "", window.location.href);
  }
  function closeChatSettings() {
    setModelMenuOpen(false);
    if (window.history.state?.mirrorChatSettings) window.history.back();
    else setChatSettingsOpen(false);
  }
  async function chooseChatModel(modelId: string) {
    if (modelSaving) return;
    setModelSaving(true);
    setModelSaveError("");
    try {
      const updated = await db.settings.update("settings", { defaultModelId: modelId, updatedAt: now() });
      if (!updated) throw new Error("Chat settings were unavailable.");
      setDraftModelId(modelId);
      setModelMenuOpen(false);
      showSaved();
      await onSettingsSaved(modelId);
    } catch (error) {
      setModelSaveError(error instanceof Error ? `Couldn't save model: ${error.message}` : "Couldn't save model. Please try again.");
    } finally {
      setModelSaving(false);
    }
  }

  function openRouterPayload(messagesToSend: OpenRouterMessage[], stream: boolean, imageContextMessageId?: string, forceImageContextTool = false) {
    const payload: Record<string, unknown> = {
      model: draftModelId,
      messages: messagesToSend,
      stream
    };
    const temperatureValue = optionalNumber(temperature || "0");
    const topPValue = optionalNumber(topP || "0");
    const maxTokensValue = optionalNumber(maxTokens);
    if (temperatureValue !== undefined) payload.temperature = temperatureValue;
    if (topPValue !== undefined) payload.top_p = topPValue;
    if (maxTokensValue !== undefined) payload.max_tokens = maxTokensValue;
    const deltaAvailable = deltaEngagementEnabled();
    const activeTools = [
      ...(deltaAvailable ? [...deltaImminentTools] : []),
      ...(includeCharacters ? [...characterTools] : []),
      ...(project?.inventoryEnabled && autoManageInventory ? [...inventoryTools] : []),
      ...(imageContextMessageId ? [...imageContextTools] : [])
    ];
    if (activeTools.length) payload.tools = activeTools;
    if (forceImageContextTool) payload.tool_choice = { type: "function", function: { name: "save_image_context" } };
    if (stream) payload.stream_options = { include_usage: true };
    return payload;
  }

  async function characterLibraryContext() {
    if (!project || !includeCharacters) return "";
    const characters = (await db.characters.where("projectId").equals(project.id).toArray())
      .sort((a, b) => (a.orderIndex ?? Number.MAX_SAFE_INTEGER) - (b.orderIndex ?? Number.MAX_SAFE_INTEGER) || a.normalisedName.localeCompare(b.normalisedName));
    if (!characters.length) return "Project character library:\n(none)";
    const rows = await Promise.all(characters.map(async (character) => {
      const stats = await characterTemplateStats(project, character);
      return [
        `## ${character.name}`,
        "Identity:",
        `- Age: ${character.age || ""}`,
        `- Gender: ${character.gender || ""}`,
        `- Personality: ${character.personality || ""}`,
        `- Misc: ${character.misc || ""}`,
        `Bio:\n${character.bio || ""}`,
        `Stats: STR ${stats.STR}, DEX ${stats.DEX}, CON ${stats.CON}, INT ${stats.INT}, WIS ${stats.WIS}, CHA ${stats.CHA}`,
        stats.templateTag ? `Template tag: ${stats.templateTag}` : ""
      ].filter(Boolean).join("\n");
    }));
    return `Project character library:\n${rows.join("\n\n")}`;
  }

  async function inventoryContext(chatId: string) {
    if (!project || !project.inventoryEnabled) return "";
    const [items, activeChat] = await Promise.all([
      db.inventoryItems.where("chatId").equals(chatId).toArray(),
      db.chats.get(chatId)
    ]);
    const inventoryRows = project.inventoryEnabled
      ? items.filter((item) => item.kind === "inventory" && item.name.trim()).map((item) => {
        const totalKg = (item.unitWeightKg ?? 0) * item.quantity;
        return `- ${item.name}: ${item.quantity}${item.unitWeightKg ? `, ${formatInventoryKg(item.unitWeightKg)}kg each, ${formatInventoryKg(totalKg)}kg total` : ""}`;
      })
      : [];
    const managementLines = [
      project.inventoryEnabled && autoManageInventory ? "Inventory auto-management is enabled: use update_inventory_item for inventory or currency changes." : "",
      !autoManageInventory && project.inventoryEnabled ? "If auto-management is disabled, use the listed inventory as read-only context and do not claim you cannot access it." : "",
      "When using update_inventory_item, include the exact item or currency name, signed quantity delta, and a terse one-line log sentence that says where the item came from or went. Use kind currency for the listed currency amount.",
      "The user's [i] marker means they are explicitly flagging that the nearby action should be treated as an inventory action. It is only a signal; do not echo it back unless quoting."
    ].filter(Boolean);
    const parts = [
      inventoryRows.length || project.currencyName ? `Inventory:\n${project.currencyName ? `- ${project.currencyName}: ${activeChat?.currencyAmount ?? 0}` : ""}${project.currencyName && inventoryRows.length ? "\n" : ""}${inventoryRows.join("\n") || ""}` : "",
      managementLines.join("\n")
    ].filter(Boolean);
    return parts.length ? parts.join("\n\n") : "";
  }

  async function memoryContext(currentUserMessage: string, selectedHistory: Message[]) {
    if (!project || project.memoryMode === "manual") return { text: "", query: "", concepts: [] as string[], hits: [] as MainChatRequestAudit["memoryRetrieval"]["hits"] };
    const recentScene = selectedHistory.slice(-4).map((message) => message.body);
    const characterNames = includeCharacters
      ? (await db.characters.where("projectId").equals(project.id).toArray()).map((character) => character.name)
      : [];
    const concepts = extractMemoryConcepts([
      currentUserMessage,
      ...recentScene,
      project.name,
      includeWorld ? project.worldSetting : "",
      includeInstructions ? project.instructions : "",
      ...characterNames
    ]);
    const query = concepts.join(" ");
    const memories = query ? await searchMemories(project.id, concepts, query, 8) : [];
    if (memories.length) {
      const timestamp = now();
      await Promise.all(memories.map(async (memory) => {
        const row = await db.memories.get(memory.id);
        if (row) await db.memories.update(row.id, { lastRecalledAt: timestamp, recallCount: (row.recallCount ?? 0) + 1, updatedAt: timestamp });
      }));
    }
    const text = [
      `Memory instruction:\n${project.memoryInstruction}`,
      `Memory retrieval query:\n${query || "(none)"}`,
      memories.length
        ? `Retrieved memories for this reply only:\n${memories.map((memory) => `- ${memory.text}${memory.tags.length ? ` [${memory.tags.join(", ")}]` : ""}`).join("\n")}`
        : "Retrieved memories for this reply only:\n(none)"
    ].join("\n\n");
    return {
      text,
      query,
      concepts,
      hits: memories.map((memory) => ({ id: memory.id, text: memory.text, tags: memory.tags, relevance: memory.relevance }))
    };
  }

  async function storeContextCondensations(sourceMessages: Message[], responseText: string) {
    const byId = new Map(sourceMessages.map((message) => [message.id, message]));
    for (const candidate of parseContextCondensations(responseText)) {
      const source = byId.get(candidate.id);
      if (!source || source.body.length < contextCondensationMinimumCharacters) continue;
      const limit = contextCondensationLimit(source);
      if (candidate.text.length >= source.body.length || candidate.text.length > limit) continue;
      const latest = await db.messages.get(source.id);
      if (!latest || latest.updatedAt !== source.updatedAt || latest.body !== source.body) continue;
      await db.messages.update(source.id, {
        contextCondensation: candidate.text,
        contextCondensationSourceUpdatedAt: source.updatedAt
      });
    }
  }

  async function ensureContextCondensations(history: Message[], currentMessageId?: string) {
    if (!settings.apiKey?.trim() || !draftModelId) return history;
    const candidates = history.filter((message) =>
      message.id !== currentMessageId
      && message.body.length >= contextCondensationMinimumCharacters
      && (!message.contextCondensation || message.contextCondensationSourceUpdatedAt !== message.updatedAt)
    );
    if (!candidates.length) return history;
    try {
      const response = await openRouterRequest({
        model: draftModelId,
        messages: [
          {
            role: "system",
            content: [
              "Create high-fidelity context condensations for the supplied prior chat messages. Return only valid JSON with shape {\"condensedMessages\":[{\"id\":\"\",\"text\":\"\"}] }.",
              "Condense each message independently. Preserve names, actions, outcomes, dialogue and its tone, intentions, emotional and relationship subtext, locations, positions, injuries, discoveries, consequences, exact codes, quantities, unresolved ambiguity, and who knows what.",
              "Remove only redundant wording, repeated atmosphere, decorative prose, and sentences that restate the same fact. Do not add interpretation, explanations, headings, facts, or connective details.",
              "Aim to retain roughly 70-80% of the original when it carries meaningful nuance. Prefer a longer faithful condensation over stripping subtext; go shorter only when the source is genuinely repetitive or mostly decorative.",
              "Never expand a message. Obey each exact maximum-character limit. If a message cannot be shortened safely without losing important nuance, omit that message from condensedMessages so the original remains in use."
            ].join("\n")
          },
          {
            role: "user",
            content: candidates.map((message) => `MESSAGE ${message.id}\nROLE: ${message.role}\nMAXIMUM CHARACTERS: ${contextCondensationLimit(message)}\nORIGINAL:\n${message.body}`).join("\n\n")
          }
        ],
        temperature: 0,
        top_p: 0,
        max_tokens: Math.min(16000, Math.max(300, Math.ceil(candidates.reduce((total, message) => total + estimateTokens(message.body), 0) * contextCondensationRatio) + 200))
      });
      const json = await response.json() as OpenRouterResponse;
      await storeContextCondensations(candidates, json.choices?.[0]?.message?.content ?? "");
      const refreshed = await db.messages.bulkGet(history.map((message) => message.id));
      return refreshed.map((message, index) => message ?? history[index]);
    } catch {
      return history;
    }
  }

  async function reviewTurnForMemories(chatId: string, userText: string, assistantText: string, sourceMessageIds: string[]): Promise<MainChatMemoryReviewAudit> {
    const skipped = (reason: string): MainChatMemoryReviewAudit => ({ status: "skipped", reason, condensationMessageIds: [], candidates: [] });
    if (!project) return skipped("No active project.");
    if (!settings.apiKey?.trim() || !draftModelId) return skipped("No API key or model was available for post-response memory review.");
    if (!assistantText.trim()) return skipped("The assistant response was empty.");
    const sourceMessages = (await db.messages.bulkGet(sourceMessageIds)).filter((message): message is Message => Boolean(message));
    const condensationCandidates = sourceMessages.filter((message) => message.body.length >= contextCondensationMinimumCharacters);
    if (project.memoryMode === "manual" && !condensationCandidates.length) return skipped("Memory mode is manual and no message needed context condensation.");
    let reviewPayload: Record<string, unknown> | undefined;
    try {
      reviewPayload = {
        model: draftModelId,
        messages: [
          {
            role: "system",
            content: [
              "Review one completed conversation turn. Return only valid JSON with shape {\"condensedMessages\":[{\"id\":\"\",\"text\":\"\"}],\"memories\":[{\"text\":\"\",\"tags\":[],\"reason\":\"\",\"confidence\":0.0}] }.",
              "For each supplied message eligible for condensation, create an independent high-fidelity condensation within its exact maximum-character limit. Preserve dialogue and tone, actions, outcomes, intentions, emotional and relationship subtext, names, locations, injuries, discoveries, consequences, exact terms, ambiguity, and who knows what. Remove only redundancy and decorative prose. Aim to retain roughly 70-80% when meaningful nuance exists; go shorter only for genuinely repetitive or mostly decorative text. Never add interpretation or facts. Omit a condensation when shortening would lose important nuance.",
              project.memoryMode === "manual" ? "Return an empty memories array because project memory saving is manual." : "Return an empty memories array when nothing qualifies. Maximum three memories. Follow the project's memory instruction exactly. Do not save ordinary narration, transient actions, momentary emotion, speculation, duplicate facts, inventory/log details, or technical/tool text.",
              `Project memory instruction:\n${project.memoryInstruction || defaultMemoryInstruction}`
            ].join("\n\n")
          },
          {
            role: "user",
            content: [
              `User message ID ${sourceMessageIds[0] ?? "user"}${condensationCandidates.some((message) => message.id === sourceMessageIds[0]) ? `; maximum ${contextCondensationLimit(condensationCandidates.find((message) => message.id === sourceMessageIds[0])!)} characters` : "; do not condense"}:\n${userText}`,
              `Assistant message ID ${sourceMessageIds[1] ?? "assistant"}${condensationCandidates.some((message) => message.id === sourceMessageIds[1]) ? `; maximum ${contextCondensationLimit(condensationCandidates.find((message) => message.id === sourceMessageIds[1])!)} characters` : "; do not condense"}:\n${assistantText}`
            ].join("\n\n")
          }
        ],
        temperature: 0,
        top_p: 0,
        max_tokens: Math.min(16000, Math.max(300, Math.ceil(condensationCandidates.reduce((total, message) => total + estimateTokens(message.body), 0) * contextCondensationRatio) + 300))
      };
      const response = await openRouterRequest(reviewPayload);
      const json = await response.json() as OpenRouterResponse;
      const responseText = json.choices?.[0]?.message?.content ?? "";
      await storeContextCondensations(condensationCandidates, responseText);
      const auditRequest = auditSafeValue(reviewPayload) as Record<string, unknown>;
      if (project.memoryMode === "manual") return { status: "completed", reason: "Only context condensation was reviewed; memory saving is manual.", requestPayload: auditRequest, rawResponse: responseText, condensationMessageIds: condensationCandidates.map((message) => message.id), candidates: [] };
      const candidates = parseMemoryReview(responseText);
      if (!candidates.length) return { status: "completed", reason: "The review proposed no memories.", requestPayload: auditRequest, rawResponse: responseText, condensationMessageIds: condensationCandidates.map((message) => message.id), candidates: [] };
      const [saved, pending] = await Promise.all([
        db.memories.where("projectId").equals(project.id).toArray(),
        db.pendingMemories.where("projectId").equals(project.id).toArray()
      ]);
      const existing = new Set([...saved.map((memory) => memory.text), ...pending.map((memory) => memory.text)].map((text) => text.trim().toLocaleLowerCase()));
      const auditedCandidates: MainChatMemoryReviewAudit["candidates"] = [];
      for (const candidate of candidates) {
        const identity = candidate.text.toLocaleLowerCase();
        if (existing.has(identity)) {
          auditedCandidates.push({ text: candidate.text, tags: candidate.tags, action: "duplicate" });
          continue;
        }
        existing.add(identity);
        if (project.memoryMode === "approval") {
          const timestamp = now();
          await db.pendingMemories.add({
            id: uid(),
            projectId: project.id,
            text: candidate.text,
            tags: candidate.tags,
            reason: candidate.reason,
            confidence: candidate.confidence,
            sourceMessageIds,
            createdAt: timestamp,
            updatedAt: timestamp
          });
          auditedCandidates.push({ text: candidate.text, tags: candidate.tags, action: "pending approval" });
        } else {
          const memory = await createMemory(project.id, candidate.text, candidate.tags, "automatic", sourceMessageIds);
          await db.memories.update(memory.id, { sourceChatId: chatId });
          auditedCandidates.push({ text: candidate.text, tags: candidate.tags, action: "saved" });
        }
      }
      return { status: "completed", requestPayload: auditRequest, rawResponse: responseText, condensationMessageIds: condensationCandidates.map((message) => message.id), candidates: auditedCandidates };
    } catch (error) {
      // Memory review must never turn a successful chat reply into a failed send.
      return { status: "failed", error: error instanceof Error ? error.message : "Unknown memory review error.", requestPayload: reviewPayload ? auditSafeValue(reviewPayload) as Record<string, unknown> : undefined, condensationMessageIds: condensationCandidates.map((message) => message.id), candidates: [] };
    }
  }

  async function updateCompactionMemory(activeChat: Chat, orderedHistory: Message[], historyLimit: number, rebuild = false) {
    if (!compactionEnabled || historyLimit < 1 || !settings.apiKey?.trim() || !draftModelId) return activeChat.compactionMemory;
    const hasExistingCompaction = Boolean(activeChat.compactionMemory || activeChat.compactedThroughSequence !== undefined);
    const historyLimitChanged = hasExistingCompaction && activeChat.compactionHistoryLimit !== undefined && activeChat.compactionHistoryLimit !== historyLimit;
    rebuild = rebuild || Boolean(activeChat.compactionNeedsRebuild) || historyLimitChanged;
    const compactedThrough = rebuild ? -1 : activeChat.compactedThroughSequence ?? -1;
    const expired = messagesForIncrementalCompaction(orderedHistory, historyLimit, compactedThrough);
    if (!expired.length) {
      if (rebuild) await db.chats.update(activeChat.id, { compactionMemory: "", compactedThroughSequence: undefined, compactionNeedsRebuild: false, compactionHistoryLimit: historyLimit, updatedAt: now() });
      else if (hasExistingCompaction && activeChat.compactionHistoryLimit === undefined) await db.chats.update(activeChat.id, { compactionHistoryLimit: historyLimit, updatedAt: now() });
      return rebuild ? "" : activeChat.compactionMemory;
    }
    try {
      const response = await openRouterRequest({
        model: draftModelId,
        messages: [
          {
            role: "system",
            content: [
              "Maintain a compact continuity outline for chat messages that have fallen outside the active message-history limit.",
              "Return only the updated outline as terse bullet points, not prose and not JSON.",
              "Preserve major plot events, decisions, relationships, injuries and their causes, deaths, discoveries, unresolved conflicts, exact names, locations, and lasting narrative state changes.",
              "Do not preserve inventory or gear acquisitions, losses, quantities, currency amounts, item provenance, or inventory-log details. Those are maintained by separate live systems.",
              "Discard small talk, routine actions, repeated facts, decorative prose, and minor moment-to-moment details. Never add facts that are not present.",
              rebuild ? "Rebuild the outline only from the supplied expired messages." : "Merge the newly expired messages into the existing outline without duplicating facts."
            ].join("\n")
          },
          {
            role: "user",
            content: [
              !rebuild && activeChat.compactionMemory ? `Existing outline:\n${activeChat.compactionMemory}` : "Existing outline:\n(none)",
              `Newly expired messages:\n${expired.map((message) => `${message.role}: ${message.body}`).join("\n\n")}`
            ].join("\n\n")
          }
        ],
        temperature: 0,
        top_p: 0
      });
      const json = await response.json() as OpenRouterResponse;
      const summary = json.choices?.[0]?.message?.content?.trim();
      if (!summary) return activeChat.compactionMemory;
      const compactedThroughSequence = Math.max(...expired.map((message) => message.sequence));
      await db.chats.update(activeChat.id, { compactionMemory: summary, compactedThroughSequence, compactionNeedsRebuild: false, compactionHistoryLimit: historyLimit, updatedAt: now() });
      return summary;
    } catch {
      return activeChat.compactionMemory;
    }
  }

  function shouldConfirmInventoryUpdate(kind: InventoryUpdateRequest["kind"]) {
    return confirmInventoryUpdates;
  }

  function inventoryToolEnabled(kind: InventoryUpdateRequest["kind"]) {
    if (!project) return false;
    if (kind === "gear") return false;
    return project.inventoryEnabled && autoManageInventory;
  }

  function deltaEngagementEnabled() {
    return Boolean(project?.deltaEnabled && project.inventoryEnabled && project.gearEnabled);
  }

  function toolsEnabled(imageContextMessageId?: string) {
    return Boolean(
      imageContextMessageId
      || includeCharacters
      || deltaEngagementEnabled()
      || (project?.inventoryEnabled && autoManageInventory)
    );
  }

  function createMainChatAudit(options: {
    requestKind: MainChatRequestAudit["requestKind"];
    chatId: string;
    userMessageId?: string;
    preparedHistory: Message[];
    memoryDetails: Awaited<ReturnType<typeof memoryContext>>;
    requestPayload: Record<string, unknown>;
    sourceFiles: Array<{ name: string; textContent?: string }>;
    characterDetails: string;
    inventoryDetails: string;
    compactionMemory: string;
    compactionIncluded: boolean;
    imageCount: number;
    attachedFileCount: number;
    toolEvents: MainChatAuditToolEvent[];
  }): MainChatRequestAudit {
    return {
      version: 1,
      capturedAt: now(),
      requestKind: options.requestKind,
      projectId: project?.id ?? "",
      projectName: project?.name ?? "",
      chatId: options.chatId,
      userMessageId: options.userMessageId,
      selectedHistory: options.preparedHistory.map((message) => ({
        id: message.id,
        sequence: message.sequence,
        role: message.role,
        usedCondensation: Boolean(message.contextCondensation && message.contextCondensationSourceUpdatedAt === message.updatedAt && message.id !== options.userMessageId)
      })),
      contextSources: [
        { name: "Project instructions", included: Boolean(includeInstructions && project?.instructions), detail: project?.instructions ? `${project.instructions.length} characters` : undefined },
        { name: "World setting", included: Boolean(includeWorld && project?.worldSetting), detail: project?.worldSetting ? `${project.worldSetting.length} characters` : undefined },
        { name: "Character library", included: Boolean(options.characterDetails), detail: options.characterDetails ? `${options.characterDetails.length} characters` : undefined },
        { name: "Source files", included: options.sourceFiles.length > 0, detail: options.sourceFiles.length ? options.sourceFiles.map((file) => `${file.name} (${file.textContent?.length ?? 0} characters)`).join(", ") : undefined },
        { name: "Compaction memory", included: options.compactionIncluded, detail: options.compactionIncluded ? `${options.compactionMemory.length} characters` : undefined },
        { name: "Retrieved project memories", included: options.memoryDetails.hits.length > 0, detail: `${options.memoryDetails.hits.length} hit${options.memoryDetails.hits.length === 1 ? "" : "s"}` },
        { name: "Live inventory", included: Boolean(options.inventoryDetails), detail: options.inventoryDetails ? `${options.inventoryDetails.length} characters` : undefined },
        { name: "Attached images", included: options.imageCount > 0, detail: `${options.imageCount}` },
        { name: "Attached files", included: options.attachedFileCount > 0, detail: `${options.attachedFileCount}` }
      ],
      memoryRetrieval: {
        mode: project?.memoryMode ?? "manual",
        query: options.memoryDetails.query,
        concepts: options.memoryDetails.concepts,
        hits: options.memoryDetails.hits
      },
      requestPayload: auditSafeValue(options.requestPayload) as Record<string, unknown>,
      toolEvents: options.toolEvents
    };
  }

  async function storePostResponseMemoryAudit(messageId: string, audit: MainChatMemoryReviewAudit) {
    const latest = await db.messages.get(messageId);
    if (!latest?.requestInfo?.audit) return;
    await db.messages.update(messageId, {
      requestInfo: {
        ...latest.requestInfo,
        audit: { ...latest.requestInfo.audit, postResponseMemory: audit }
      }
    });
  }


  async function openRouterRequest(payload: Record<string, unknown>) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 90_000);
    let response: Response;
    try {
      response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${(settings.apiKey ?? "").trim()}`,
          "Content-Type": "application/json",
          "HTTP-Referer": location.origin,
          "X-Title": "Mirror 2.0"
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted) throw new Error("The AI provider did not start responding within 90 seconds. Please resend the message.");
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `OpenRouter request failed (${response.status})`);
    }
    return response;
  }

  async function runCharacterTool(toolCall: OpenRouterToolCall) {
    if (!project) return null;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(toolCall.function.arguments || "{}") as Record<string, unknown>;
    } catch {
      return { error: "Invalid tool arguments." };
    }
    const characterId = typeof args.characterId === "string" ? args.characterId : "";
    switch (toolCall.function.name) {
      case "find_characters":
        return findCharacters(project.id, typeof args.nameQuery === "string" ? args.nameQuery : "");
      case "get_character_identity":
        return characterId ? getCharacterIdentity(project.id, characterId) : { error: "characterId is required." };
      case "get_character_bio":
        return characterId ? getCharacterBio(project.id, characterId) : { error: "characterId is required." };
      case "get_character_stats":
        return characterId ? getCharacterStats(project.id, characterId) : { error: "characterId is required." };
      default:
        return { error: `Unknown tool ${toolCall.function.name}.` };
    }
  }

  async function applyInventoryUpdate(projectId: string, chatId: string, update: InventoryUpdateRequest) {
    if (update.kind !== "currency") {
      return applyInventoryChange(projectId, chatId, update.kind, update.name, update.delta, update.logSentence, update.unitWeightKg);
    }
    const timestamp = now();
    const activeChat = await db.chats.get(chatId);
    const quantity = Math.max(0, (activeChat?.currencyAmount ?? 0) + update.delta);
    await db.transaction("rw", db.chats, db.inventoryLogs, async () => {
      await db.chats.update(chatId, { currencyAmount: quantity, updatedAt: timestamp });
      await db.inventoryLogs.add({ id: uid(), projectId, chatId, sentence: update.logSentence.trim(), createdAt: timestamp, updatedAt: timestamp });
    });
    return { item: update.name, quantity };
  }

  async function runInventoryTool(toolCall: OpenRouterToolCall, chatId: string, inventoryUpdates: InventoryUpdateRequest[]) {
    if (!project) return { error: "No active project." };
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(toolCall.function.arguments || "{}") as Record<string, unknown>;
    } catch {
      return { error: "Invalid tool arguments." };
    }
    const kind: InventoryUpdateRequest["kind"] = args.kind === "gear" ? "gear" : args.kind === "currency" ? "currency" : "inventory";
    if (!inventoryToolEnabled(kind)) return { error: `${kind} auto-management is disabled.` };
    const name = kind === "currency" ? (project.currencyName?.trim() || (typeof args.name === "string" ? args.name.trim() : "")) : typeof args.name === "string" ? normaliseInventoryName(args.name) : "";
    const delta = typeof args.delta === "number" ? args.delta : Number(args.delta);
    const unitWeightKg = typeof args.unitWeightKg === "number" ? args.unitWeightKg : Number(args.unitWeightKg);
    const logSentence = typeof args.logSentence === "string" ? args.logSentence.trim() : "";
    if (!name || !Number.isFinite(delta) || delta === 0) return { error: "A non-empty item name and non-zero delta are required." };
    if (!logSentence) return { error: "A one-line log sentence is required." };
    const update: InventoryUpdateRequest = {
      id: uid(),
      kind,
      name,
      delta,
      ...(Number.isFinite(unitWeightKg) && unitWeightKg > 0 ? { unitWeightKg } : {}),
      logSentence,
      status: shouldConfirmInventoryUpdate(kind) ? "pending" : "applied"
    };
    inventoryUpdates.push(update);
    if (update.status === "pending") {
      return { queuedForConfirmation: true, kind, name, delta };
    }
    const result = await applyInventoryUpdate(project.id, chatId, update);
    return { applied: Boolean(result), kind, name, delta, quantity: result?.quantity };
  }

  async function runMemoryTool(toolCall: OpenRouterToolCall, chatId: string, sourceMessageIds: string[]) {
    if (!project) return { error: "No active project." };
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(toolCall.function.arguments || "{}") as Record<string, unknown>;
    } catch {
      return { error: "Invalid tool arguments." };
    }
    if (toolCall.function.name === "save_memory") {
      if (project.memoryMode === "manual") return { disabled: true, reason: "Project memory mode is manual." };
      const text = typeof args.text === "string" ? args.text.trim() : "";
      const tags = Array.isArray(args.tags) ? args.tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean) : [];
      const reason = typeof args.reason === "string" ? args.reason.trim() : "";
      const confidence = typeof args.confidence === "number" ? args.confidence : Number(args.confidence);
      if (!text) return { error: "Memory text is required." };
      if (project.memoryMode === "approval") {
        const timestamp = now();
        await db.pendingMemories.add({
          id: uid(),
          projectId: project.id,
          text,
          tags,
          reason,
          confidence: Number.isFinite(confidence) ? confidence : 0.5,
          sourceMessageIds,
          createdAt: timestamp,
          updatedAt: timestamp
        });
        return { proposedForApproval: true };
      }
      const memory = await createMemory(project.id, text, tags, "automatic", sourceMessageIds);
      return { saved: true, id: memory.id };
    }
    return { error: `Unknown tool ${toolCall.function.name}.` };
  }

  async function runImageContextTool(toolCall: OpenRouterToolCall, messageId?: string) {
    if (!messageId) return { error: "No attached image message is available." };
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(toolCall.function.arguments || "{}") as Record<string, unknown>;
    } catch {
      return { error: "Invalid image context arguments." };
    }
    const context = typeof args.context === "string" ? args.context.trim() : "";
    if (!context) return { error: "Image context is required." };
    await db.messages.update(messageId, { attachmentContext: context, updatedAt: now() });
    return { saved: true, context };
  }

  function runDeltaImminentTool(toolCall: OpenRouterToolCall, proposals: DeltaImminentProposal[]) {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(toolCall.function.arguments || "{}") as Record<string, unknown>;
    } catch {
      return { error: "Invalid Delta imminent arguments." };
    }
    const brief = typeof args.brief === "string" ? args.brief.trim() : "";
    if (!brief) return { error: "brief is required." };
    const handoffContext = typeof args.handoffContext === "string" ? args.handoffContext.trim() : "";
    const playerCharacterName = typeof args.playerCharacterName === "string" ? args.playerCharacterName.trim() : "";
    const roster = normaliseDeltaBriefRoster({ team: args.team, neutral: args.neutral, enemies: args.enemies });
    if (playerCharacterName && ![...roster.team, ...roster.neutral, ...roster.enemies].some((name) => name.toLowerCase() === playerCharacterName.toLowerCase())) {
      roster.team.unshift(playerCharacterName);
    }
    const abstractName = [...roster.team, ...roster.neutral, ...roster.enemies].find(abstractDeltaRosterName);
    if (abstractName) return { error: `Roster entry "${abstractName}" is abstract. Identify the visible person, animal, species, or concrete role instead.` };
    if (![...roster.team, ...roster.neutral, ...roster.enemies].length) return { error: "A Delta engagement needs a concrete participant roster." };
    const proposal: DeltaImminentProposal = {
      brief,
      handoffContext,
      playerCharacterName,
      roster,
      mapSize: normaliseDeltaMapSize(args.mapSize),
      avoidLabel: typeof args.avoidLabel === "string" ? args.avoidLabel.trim() : "",
      avoidPrompt: typeof args.avoidPrompt === "string" ? args.avoidPrompt.trim() : ""
    };
    proposals.push(proposal);
    return { prepared: true, message: "Delta Mode imminent card queued. Do not continue the engagement in ordinary chat." };
  }

  async function runToolCall(toolCall: OpenRouterToolCall, chatId: string, inventoryUpdates: InventoryUpdateRequest[], sourceMessageIds: string[], deltaImminentProposals: DeltaImminentProposal[], imageContextMessageId?: string) {
    if (toolCall.function.name === "prepare_delta_engagement") {
      return runDeltaImminentTool(toolCall, deltaImminentProposals);
    }
    if (toolCall.function.name === "save_image_context") {
      return runImageContextTool(toolCall, imageContextMessageId);
    }
    if (toolCall.function.name === "update_inventory_item") {
      return runInventoryTool(toolCall, chatId, inventoryUpdates);
    }
    if (toolCall.function.name === "save_memory") {
      return runMemoryTool(toolCall, chatId, sourceMessageIds);
    }
    return runCharacterTool(toolCall);
  }

  async function resolveToolCalls(messagesToSend: OpenRouterMessage[], toolLog: string[], toolEvents: MainChatAuditToolEvent[], inventoryUpdates: InventoryUpdateRequest[], chatId: string, sourceMessageIds: string[], imageContextMessageId?: string) {
    if (!toolsEnabled(imageContextMessageId)) return { messages: messagesToSend, usage: undefined as OpenRouterUsage | undefined };
    let nextMessages = [...messagesToSend];
    let usage: OpenRouterUsage | undefined;
    const deltaImminentProposals: DeltaImminentProposal[] = [];
    for (let index = 0; index < 4; index += 1) {
      const response = await openRouterRequest(openRouterPayload(nextMessages, false, imageContextMessageId, index === 0 && Boolean(imageContextMessageId)));
      const json = await response.json() as OpenRouterResponse;
      usage = json.usage ?? usage;
      const assistantMessage = json.choices?.[0]?.message;
      const toolCalls = assistantMessage?.tool_calls ?? [];
      if (!toolCalls.length) return { messages: nextMessages, assistantMessage, usage, deltaImminentProposal: deltaImminentProposals[deltaImminentProposals.length - 1] };
      nextMessages = [
        ...nextMessages,
        {
          role: "assistant",
          content: assistantMessage?.content ?? "",
          tool_calls: toolCalls
        }
      ];
      for (const toolCall of toolCalls) {
        const result = await runToolCall(toolCall, chatId, inventoryUpdates, sourceMessageIds, deltaImminentProposals, imageContextMessageId);
        toolLog.push(toolCall.function.name);
        toolEvents.push({
          round: index + 1,
          callId: toolCall.id,
          name: toolCall.function.name,
          arguments: toolCall.function.arguments || "{}",
          result: JSON.stringify(auditSafeValue(result), null, 2)
        });
        nextMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result)
        });
      }
      if (imageContextMessageId && toolCalls.some((toolCall) => toolCall.function.name === "save_image_context")) {
        nextMessages = nextMessages.map((message) => {
          if (!Array.isArray(message.content)) return message;
          const text = message.content.find((part) => typeof part === "object" && part !== null && "type" in part && (part as { type?: string }).type === "text") as { text?: string } | undefined;
          return { ...message, content: text?.text ?? "" };
        });
      }
    }
    return { messages: nextMessages, usage, deltaImminentProposal: deltaImminentProposals[deltaImminentProposals.length - 1] };
  }

  async function completeWithTools(messagesToSend: OpenRouterMessage[], toolLog: string[], toolEvents: MainChatAuditToolEvent[], inventoryUpdates: InventoryUpdateRequest[], chatId: string, sourceMessageIds: string[], imageContextMessageId?: string) {
    const resolved = await resolveToolCalls(messagesToSend, toolLog, toolEvents, inventoryUpdates, chatId, sourceMessageIds, imageContextMessageId);
    const replyText = typeof resolved.assistantMessage?.content === "string" ? resolved.assistantMessage.content : "";
    return {
      replyText,
      inputTokens: resolved.usage?.prompt_tokens,
      outputTokens: resolved.usage?.completion_tokens,
      deltaImminentProposal: resolved.deltaImminentProposal
    };
  }
  async function createDeltaBrief(command: string, activeChat: Chat) {
    const activeProject = project;
    if (!activeProject) return { brief: command, handoffContext: command, playerCharacterName: "", roster: normaliseDeltaBriefRoster(undefined), mapSize: "M" as DeltaMapSize };
    const history = await db.messages
      .where("[chatId+branchId+sequence]")
      .between([activeChat.id, activeChat.activeBranchId, Dexie.minKey], [activeChat.id, activeChat.activeBranchId, Dexie.maxKey])
      .toArray();
    const recent = history.sort((a, b) => a.sequence - b.sequence).slice(-8);
    const fallbackSource = [...recent].reverse().find((message) => message.role === "assistant")?.body || command;
    const fallbackBrief = fallbackSource.length > 1400 ? `${fallbackSource.slice(0, 1400).trim()}...` : fallbackSource;
    const fallbackHandoff = recent.map((message) => `${message.role}: ${message.body}`).join("\n\n").slice(-1800);
    if (!settings.apiKey?.trim() || !draftModelId) return { brief: fallbackBrief, handoffContext: fallbackHandoff, playerCharacterName: "", roster: deltaBriefRosterFromContext(fallbackHandoff), mapSize: "M" as DeltaMapSize };
    try {
      const response = await openRouterRequest({
        model: draftModelId,
        messages: [
          {
            role: "system",
            content: [
              "Create a concise immersive Delta Mode imminent scene beat from the recent chat context. Return only valid JSON.",
              "Shape: {\"brief\":\"\",\"handoffContext\":\"\",\"playerCharacterName\":\"\",\"roster\":{\"team\":[],\"neutral\":[],\"enemies\":[]},\"mapSize\":\"M\",\"avoidLabel\":\"\",\"avoidPrompt\":\"\"}",
              "brief: write one to three compact sentences in the same third-person narrative style as the user's roleplay. Continue the exact moment. State the immediate place, what is physically happening, and what pressure forces the engagement. Prefer useful concrete facts over lighting, scent, tension, mood, or movie-trailer atmosphere.",
              "brief: do not carry the participant roster inside prose when the roster rows communicate it more clearly. Do not introduce known characters, summarize a mission, or speak to the user.",
              "brief: do not introduce known characters back to the user with roles or biographies. Use names naturally. If Jaeger or another known character is present, include a brief immersive reaction, gesture, or line when context supports it.",
              "brief: do not use labels such as Allies, Hostiles, Objective, Mission, Target, or PLAYER CHARACTER inside the brief text. Do not speak to the user. Do not ask a question.",
              "brief length: maximum 80 words.",
              "roster.team: list every allied participant physically involved, including the likely player character when appropriate. roster.neutral and roster.enemies: list every concrete participant in those relationships. Preserve established names and quantities. If opposition is newly revealed, create only what this exact scene naturally calls for.",
              "roster naming: every entry must identify something observable: a person's name, a concrete human descriptor, an animal/species, or a recognizable role. Never use Unknown Figure, Unknown Creature, Mysterious Person, unidentified shape, presence, or similarly abstract labels. Distinguish multiples by visible role or trait rather than leaving them abstract.",
              "handoffContext: terse non-roster continuity anchors only. Use Location:, Objective:, Situation:, and Constraint: lines. Preserve exact names, codes, item labels, locations, factions, immediate physical situation, and constraints.",
              "handoffContext length: maximum 8 short lines.",
              "playerCharacterName: the likely player-controlled character name if the context implies one; otherwise use the lead/protagonist character name; otherwise empty.",
              "mapSize: choose exactly one map boundary based on the immediate scene: S (30m), M (50m), L (80m), XL (100m), or XXL (200m). It is the engagement boundary, not a zoom level. Choose the smallest fair scene boundary.",
              "avoidLabel: use Cancel for a proposed mission/commitment, Escape for immediate danger, or empty if avoidance does not make sense.",
              "avoidPrompt: short question for what the player does to avoid or cancel the engagement."
            ].join("\n")
          },
          {
            role: "user",
            content: [
              activeProject.worldSetting ? `World setting:\n${activeProject.worldSetting}` : "",
              `Recent chat:\n${recent.map((message) => `${message.role}: ${message.body}`).join("\n\n")}`,
              `User command:\n${command}`
            ].filter(Boolean).join("\n\n")
          }
        ],
        temperature: 0,
        top_p: 0
      });
      const json = await response.json() as OpenRouterResponse;
      const packet = parseDeltaBriefPacket(json.choices?.[0]?.message?.content ?? "");
      return { brief: packet.brief || fallbackBrief, handoffContext: packet.handoffContext || fallbackHandoff, playerCharacterName: packet.playerCharacterName, roster: packet.roster, mapSize: packet.mapSize, avoidLabel: packet.avoidLabel, avoidPrompt: packet.avoidPrompt };
    } catch {
      return { brief: fallbackBrief, handoffContext: fallbackHandoff, playerCharacterName: "", roster: deltaBriefRosterFromContext(fallbackHandoff), mapSize: "M" as DeltaMapSize };
    }
  }
  async function send() {
    if (deltaLocked) return;
    if (!project || !body.trim()) return;
    const text = body.trim();
    if (isDeltaModeRequest(text)) {
      setBody("");
      let deltaChat = chat;
      if (!deltaChat) {
        const deltaChatId = await createChat(project.id, text);
        deltaChat = await db.chats.get(deltaChatId);
        if (!deltaChat) return;
        await onChatCreated(deltaChatId);
      } else {
        await addMessage(deltaChat.id, deltaChat.activeBranchId, "user", text);
      }
      const pending = await addMessage(deltaChat.id, deltaChat.activeBranchId, "assistant", "...");
      await db.messages.update(pending.id, { status: "pending", updatedAt: now() });
      await onRefresh();
      const brief = await createDeltaBrief(text, deltaChat);
      await db.messages.update(pending.id, {
        body: `### Δ Delta mode imminent...\n\n${brief.brief}`,
        status: "complete",
        deltaBrief: {
          status: "pending",
          brief: brief.brief,
          handoffContext: brief.handoffContext,
          playerCharacterName: brief.playerCharacterName,
          roster: brief.roster,
          mapSize: brief.mapSize,
          avoidLabel: brief.avoidLabel,
          avoidPrompt: brief.avoidPrompt
        },
        updatedAt: now()
      });
      await onRefresh();
      return;
    }
    if (!settings.apiKey) {
      alert("Add your OpenRouter API key before sending AI requests. Your draft is still here.");
      return;
    }
    if (!draftModelId) {
      alert("Choose a model before sending.");
      return;
    }
    let images: { dataUrl: string; mimeType: string }[] = [];
    let attachedFileDetails = "";
    try {
      images = await Promise.all(attachedImages.map(imageForOpenRouter));
      attachedFileDetails = await chatFileContext(attachedFiles);
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "Could not prepare the attachment.");
      return;
    }
    setAttachmentError("");
    setBody("");
    let chatId = chat?.id;
    let branchId = chat?.activeBranchId;
    let userMessageId: string | undefined;
    let createdChatId: string | undefined;
    let requestFailed = false;
    if (!chatId || !branchId) {
      chatId = await createChat(project.id, text);
      createdChatId = chatId;
      const created = await db.chats.get(chatId);
      branchId = created?.activeBranchId;
      userMessageId = (await db.messages
        .where("[chatId+branchId+sequence]")
        .between([chatId, branchId!, Dexie.minKey], [chatId, branchId!, Dexie.maxKey])
        .last())?.id;
    } else {
      userMessageId = (await addMessage(chatId, branchId, "user", text)).id;
    }
    if (chatId && branchId) {
      if (userMessageId && (attachedImages.length || attachedFiles.length)) {
        const timestamp = now();
        await db.attachments.bulkAdd([...attachedImages, ...attachedFiles].map((file) => ({
          id: uid(),
          ownerType: "message" as const,
          ownerId: userMessageId!,
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          blob: file,
          createdAt: timestamp,
          updatedAt: timestamp
        })));
      }
      if (!createdChatId) await onRefresh();
      const toolLog: string[] = [];
      const toolEvents: MainChatAuditToolEvent[] = [];
      const inventoryUpdates: InventoryUpdateRequest[] = [];
      const requestInfo: NonNullable<Message["requestInfo"]> = {
        settings: [
          `Model: ${draftModelId}`,
          `Temperature: ${temperature || "0"}`,
          `Top P: ${topP || "0"}`,
          `Max output: ${maxTokens || "no limit"}`,
          effectiveHistoryNoLimit ? "History: no limit" : `History: ${maxHistory || "not set"} messages`,
          `Streaming: ${streamingEnabled ? "on" : "off"}`
        ],
        toggles: [
          `World setting: ${includeWorld ? "on" : "off"}`,
          `Instructions: ${includeInstructions ? "on" : "off"}`,
          `Characters: ${includeCharacters ? "on" : "off"}`,
          `Source files: ${includeSourceFiles ? "on" : "off"}`,
          `Compaction memory: ${compactionEnabled ? "on" : "off"}`,
          `Project memories: ${project.memoryMode !== "manual" ? project.memoryMode : "manual/off"}`,
          `Auto inventory: ${inventoryToolEnabled("inventory") ? "on" : "off"}`,
          `Confirm inventory: ${confirmInventoryUpdates ? "on" : "off"}`,
          `Auto gear: ${inventoryToolEnabled("gear") ? "on" : "off"}`,
          `Confirm gear: ${confirmGearUpdates ? "on" : "off"}`,
          `Images: ${attachedImages.length}`,
          `Files: ${attachedFiles.length}`
        ],
        toolCalls: toolLog,
        inventoryUpdates
      };
      const canStreamDirectly = streamingEnabled && !toolsEnabled(images.length ? userMessageId : undefined);
      const reply = await addMessage(chatId, branchId, "assistant", canStreamDirectly ? "" : "...");
      await db.messages.update(reply.id, { modelId: draftModelId, status: canStreamDirectly ? "streaming" : "pending", requestInfo });
      if (createdChatId) await onChatCreated(createdChatId);
      else await onRefresh();
      const sourceFiles = includeSourceFiles
        ? await db.sourceFiles.where("projectId").equals(project.id).and((file) => Boolean(file.textContent)).toArray()
        : [];
      const activeChat = await db.chats.get(chatId);
      const characterDetails = await characterLibraryContext();
      const inventoryDetails = await inventoryContext(chatId);
      const allHistory = await db.messages
        .where("[chatId+branchId+sequence]")
        .between([chatId, branchId, Dexie.minKey], [chatId, branchId, Dexie.maxKey])
        .toArray();
      const orderedHistory = allHistory.sort((a, b) => a.sequence - b.sequence);
      const contextHistory = orderedHistory.filter((message) => message.id !== reply.id);
      const historyLimit = effectiveHistoryNoLimit ? undefined : optionalNumber(maxHistory);
      const compactionMemory = activeChat && historyLimit
        ? await updateCompactionMemory(activeChat, contextHistory, historyLimit)
        : activeChat?.compactionMemory ?? "";
      const selectedHistory = historyLimit ? contextHistory.slice(-historyLimit) : contextHistory;
      const memoryDetails = await memoryContext(text, selectedHistory);
      // Condensation is handled after a reply. Keeping it out of the send path avoids
      // an extra full model request before the user sees any response.
      const preparedHistory = selectedHistory;
      const deltaAvailable = deltaEngagementEnabled();
      const systemParts = [
        `Project: ${project.name}`,
        deltaAvailable ? "Delta Mode boundary: the main chat must not run structured fights, hostile standoffs, tactical engagements, mission commitments, or combat-like confrontations as ordinary roleplay once they become imminent. When the current reply would initiate or clearly commit to that kind of engagement, call prepare_delta_engagement with a short in-world third-person scene beat instead of continuing the scene as normal chat. Use this only when the engagement is imminent, not for ordinary tension." : "",
        includeInstructions && project.instructions ? `Project instructions:\n${project.instructions}` : "",
        includeWorld && project.worldSetting ? `World setting:\n${project.worldSetting}` : "",
        characterDetails,
        compactionEnabled && historyLimit && compactionMemory ? `Compaction memory:\n${compactionMemory}` : "",
        sourceFiles.length ? `Source files:\n${sourceFiles.map((file) => `# ${file.name}\n${file.textContent}`).join("\n\n")}` : "",
        attachedFileDetails,
        images.length ? "An image is attached to the latest user message. First call save_image_context exactly once with a detailed concise visual extraction. It is hidden from the user. Then answer the user normally from the image." : "",
        memoryDetails.text,
        inventoryDetails
      ].filter(Boolean);
      const historyContent = chatHistoryContent(preparedHistory, userMessageId, images);
      const requestMessages: OpenRouterMessage[] = [
        ...(systemParts.length ? [{ role: "system" as const, content: systemParts.join("\n\n") }] : []),
        ...historyContent
      ];
      requestInfo.audit = createMainChatAudit({
        requestKind: "send",
        chatId,
        userMessageId,
        preparedHistory,
        memoryDetails,
        requestPayload: openRouterPayload(requestMessages, false, images.length ? userMessageId : undefined, images.length > 0),
        sourceFiles,
        characterDetails,
        inventoryDetails,
        compactionMemory,
        compactionIncluded: Boolean(compactionEnabled && historyLimit && compactionMemory),
        imageCount: images.length,
        attachedFileCount: attachedFiles.length,
        toolEvents
      });
      await db.messages.update(reply.id, { requestInfo, updatedAt: now() });
      try {
        if (toolsEnabled(images.length ? userMessageId : undefined)) {
          const completed = await completeWithTools(requestMessages, toolLog, toolEvents, inventoryUpdates, chatId, selectedHistory.map((message) => message.id), images.length ? userMessageId : undefined);
          const deltaProposal = completed.deltaImminentProposal;
          const completedReplyText = deltaProposal ? `### Δ Delta mode imminent...\n\n${deltaProposal.brief}` : completed.replyText || "(No response text returned.)";
          await db.messages.update(reply.id, {
            body: completedReplyText,
            deltaBrief: deltaProposal ? {
              status: "pending",
              brief: deltaProposal.brief,
              handoffContext: deltaProposal.handoffContext,
              playerCharacterName: deltaProposal.playerCharacterName,
              roster: deltaProposal.roster,
              mapSize: deltaProposal.mapSize,
              avoidLabel: deltaProposal.avoidLabel || "Escape",
              avoidPrompt: deltaProposal.avoidPrompt || "What do you do to avoid the engagement?"
            } : undefined,
            inputTokens: completed.inputTokens,
            outputTokens: completed.outputTokens ?? estimateTokens(deltaProposal?.brief ?? completed.replyText),
            estimatedTokens: !completed.outputTokens,
            status: "complete",
            requestInfo: { ...requestInfo, toolCalls: toolLog.length ? toolLog : ["None"], inventoryUpdates },
            updatedAt: now()
          });
          setAttachedImages([]);
          setAttachedFiles([]);
          if (createdChatId) await onChatCreated(createdChatId);
          else await onRefresh();
          const memoryReview = await reviewTurnForMemories(chatId, text, completedReplyText, [userMessageId, reply.id].filter((id): id is string => Boolean(id)));
          await storePostResponseMemoryAudit(reply.id, memoryReview);
          await onRefresh();
          return;
        }
        let completedReplyText = "";
        const response = await openRouterRequest(openRouterPayload(requestMessages, streamingEnabled));
        await db.messages.update(reply.id, { requestInfo: { ...requestInfo, toolCalls: toolLog.length ? toolLog : ["None"] } });
        if (streamingEnabled && response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let replyText = "";
          let inputTokens: number | undefined;
          let outputTokens: number | undefined;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              const clean = line.trim();
              if (!clean.startsWith("data:")) continue;
              const data = clean.slice(5).trim();
              if (data === "[DONE]") continue;
              const chunk = JSON.parse(data) as { choices?: { delta?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
              replyText += chunk.choices?.[0]?.delta?.content ?? "";
              inputTokens = chunk.usage?.prompt_tokens ?? inputTokens;
              outputTokens = chunk.usage?.completion_tokens ?? outputTokens;
              await db.messages.update(reply.id, { body: replyText, outputTokens: estimateTokens(replyText), updatedAt: now() });
              await onRefresh();
            }
          }
          completedReplyText = replyText || "(No response text returned.)";
          await db.messages.update(reply.id, { body: completedReplyText, inputTokens, outputTokens: outputTokens ?? estimateTokens(replyText), estimatedTokens: !outputTokens, status: "complete", updatedAt: now() });
        } else {
          const json = await response.json() as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
          const replyText = json.choices?.[0]?.message?.content ?? "";
          completedReplyText = replyText || "(No response text returned.)";
          await db.messages.update(reply.id, {
            body: completedReplyText,
            inputTokens: json.usage?.prompt_tokens,
            outputTokens: json.usage?.completion_tokens ?? estimateTokens(replyText),
            estimatedTokens: !json.usage?.completion_tokens,
            status: "complete",
            updatedAt: now()
          });
        }
        await onRefresh();
        const memoryReview = await reviewTurnForMemories(chatId, text, completedReplyText, [userMessageId, reply.id].filter((id): id is string => Boolean(id)));
        await storePostResponseMemoryAudit(reply.id, memoryReview);
        await onRefresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        requestFailed = true;
        setAttachmentError(message.includes("\"code\":401") ? "OpenRouter rejected the saved API key for this request. Re-save your OpenRouter key in API Settings, then resend the attached message." : message);
        await db.messages.update(reply.id, {
          body: `OpenRouter request failed: ${message}`,
          error: message,
          status: "failed",
          requestInfo: { ...requestInfo, toolCalls: toolLog.length ? toolLog : ["None"], inventoryUpdates },
          updatedAt: now()
        });
      }
    }
    if (!requestFailed) {
      setAttachedImages([]);
      setAttachedFiles([]);
    }
    if (createdChatId) await onChatCreated(createdChatId);
    else await onRefresh();
  }

  async function editMessage(message: Message, nextBody: string) {
    const clean = nextBody.trim();
    if (!clean) return message;
    const timestamp = now();
    await db.transaction("rw", db.messages, db.stars, db.chats, async () => {
      await db.messages.update(message.id, {
        body: clean,
        contextCondensation: undefined,
        contextCondensationSourceUpdatedAt: undefined,
        inputTokens: message.role === "user" ? estimateTokens(clean) : message.inputTokens,
        outputTokens: message.role === "assistant" ? estimateTokens(clean) : message.outputTokens,
        estimatedTokens: true,
        updatedAt: timestamp
      });
      const star = await db.stars.where("messageId").equals(message.id).first();
      if (star) await db.stars.update(star.id, { bodyCopy: clean, updatedAt: timestamp });
      if (compactionEnabled) await db.chats.update(message.chatId, { compactionNeedsRebuild: true, updatedAt: timestamp });
    });
    await onRefresh();
    return { ...message, body: clean, updatedAt: timestamp, estimatedTokens: true };
  }

  async function answeredUserMessage(message: Message) {
    if (message.role === "user") return (await db.messages.get(message.id)) ?? message;
    return db.messages
      .where("[chatId+branchId+sequence]")
      .between([message.chatId, message.branchId, Dexie.minKey], [message.chatId, message.branchId, message.sequence - 1])
      .and((row) => row.role === "user")
      .last();
  }

  async function resendFromMessage(message: Message) {
    if (!project || !settings.apiKey) {
      alert("Add your OpenRouter API key before regenerating.");
      return;
    }
    if (!draftModelId) {
      alert("Choose a model before regenerating.");
      return;
    }
    const promptMessage = await answeredUserMessage(message);
    if (!promptMessage) {
      alert("No user message was found to regenerate from.");
      return;
    }
    const chatId = message.chatId;
    const branchId = message.branchId;
    const timestamp = now();
    const sourceFiles = includeSourceFiles
      ? await db.sourceFiles.where("projectId").equals(project.id).and((file) => Boolean(file.textContent)).toArray()
      : [];
    const activeChat = await db.chats.get(chatId);
    const characterDetails = await characterLibraryContext();
    const inventoryDetails = await inventoryContext(chatId);
    const allHistory = await db.messages
      .where("[chatId+branchId+sequence]")
      .between([chatId, branchId, Dexie.minKey], [chatId, branchId, promptMessage.sequence])
      .toArray();
    const orderedHistory = allHistory.sort((a, b) => a.sequence - b.sequence);
    const historyLimit = effectiveHistoryNoLimit ? undefined : optionalNumber(maxHistory);
    const compactionMemory = activeChat && historyLimit
      ? await updateCompactionMemory(activeChat, orderedHistory, historyLimit, true)
      : activeChat?.compactionMemory ?? "";
    const limitedHistory = historyLimit ? orderedHistory.slice(-historyLimit) : orderedHistory;
    const selectedHistory = limitedHistory.some((row) => row.id === promptMessage.id) ? limitedHistory : [...limitedHistory, promptMessage].sort((a, b) => a.sequence - b.sequence);
    const memoryDetails = await memoryContext(promptMessage.body, selectedHistory);
    const preparedHistory = selectedHistory;
    const resendImages = promptMessage.attachmentContext ? [] : await storedMessageImages(promptMessage.id);
    const deltaAvailable = deltaEngagementEnabled();
    const systemParts = [
      `Project: ${project.name}`,
      deltaAvailable ? "Delta Mode boundary: the main chat must not run structured fights, hostile standoffs, tactical engagements, mission commitments, or combat-like confrontations as ordinary roleplay once they become imminent. When the current reply would initiate or clearly commit to that kind of engagement, call prepare_delta_engagement with a short in-world third-person scene beat instead of continuing the scene as normal chat. Use this only when the engagement is imminent, not for ordinary tension." : "",
      includeInstructions && project.instructions ? `Project instructions:\n${project.instructions}` : "",
      includeWorld && project.worldSetting ? `World setting:\n${project.worldSetting}` : "",
      characterDetails,
      compactionEnabled && historyLimit && compactionMemory ? `Compaction memory:\n${compactionMemory}` : "",
      sourceFiles.length ? `Source files:\n${sourceFiles.map((file) => `# ${file.name}\n${file.textContent}`).join("\n\n")}` : "",
      resendImages.length ? "An image is attached to the latest user message. First call save_image_context exactly once with a detailed concise visual extraction. It is hidden from the user. Then answer the user normally from the image." : "",
      memoryDetails.text,
      inventoryDetails
    ].filter(Boolean);
    const historyContent = chatHistoryContent(preparedHistory, promptMessage.id, resendImages);
    const requestMessages: OpenRouterMessage[] = [
      ...(systemParts.length ? [{ role: "system" as const, content: systemParts.join("\n\n") }] : []),
      ...historyContent
    ];
    const toolLog: string[] = [];
    const toolEvents: MainChatAuditToolEvent[] = [];
    const inventoryUpdates: InventoryUpdateRequest[] = [];
    const requestInfo: NonNullable<Message["requestInfo"]> = {
      settings: [
        `Model: ${draftModelId}`,
        `Temperature: ${temperature || "0"}`,
        `Top P: ${topP || "0"}`,
        `Max output: ${maxTokens || "no limit"}`,
        effectiveHistoryNoLimit ? "History: no limit" : `History: ${maxHistory || "not set"} messages`,
        `Streaming: ${streamingEnabled ? "on" : "off"}`
      ],
      toggles: [
        `World setting: ${includeWorld ? "on" : "off"}`,
        `Instructions: ${includeInstructions ? "on" : "off"}`,
        `Characters: ${includeCharacters ? "on" : "off"}`,
        `Source files: ${includeSourceFiles ? "on" : "off"}`,
        `Compaction memory: ${compactionEnabled ? "on" : "off"}`,
        `Project memories: ${project.memoryMode !== "manual" ? project.memoryMode : "manual/off"}`,
        `Auto inventory: ${inventoryToolEnabled("inventory") ? "on" : "off"}`,
        `Confirm inventory: ${confirmInventoryUpdates ? "on" : "off"}`,
        `Auto gear: ${inventoryToolEnabled("gear") ? "on" : "off"}`,
        `Confirm gear: ${confirmGearUpdates ? "on" : "off"}`,
        "Images: 0"
      ],
      toolCalls: toolLog,
      inventoryUpdates
    };
    requestInfo.audit = createMainChatAudit({
      requestKind: "resend",
      chatId,
      userMessageId: promptMessage.id,
      preparedHistory,
      memoryDetails,
      requestPayload: openRouterPayload(requestMessages, false, resendImages.length ? promptMessage.id : undefined, resendImages.length > 0),
      sourceFiles,
      characterDetails,
      inventoryDetails,
      compactionMemory,
      compactionIncluded: Boolean(compactionEnabled && historyLimit && compactionMemory),
      imageCount: resendImages.length,
      attachedFileCount: 0,
      toolEvents
    });
    let reply: Message | undefined;
    await db.transaction("rw", db.messages, db.stars, db.chats, async () => {
      const laterIds = await db.messages
        .where("[chatId+branchId+sequence]")
        .between([chatId, branchId, promptMessage.sequence + 1], [chatId, branchId, Dexie.maxKey])
        .primaryKeys();
      if (laterIds.length) {
        const messageIds = laterIds as string[];
        await db.stars.where("messageId").anyOf(messageIds).delete();
        await db.messages.bulkDelete(messageIds);
      }
      const canStreamDirectly = streamingEnabled && !toolsEnabled(resendImages.length ? promptMessage.id : undefined);
      reply = await addMessage(chatId, branchId, "assistant", canStreamDirectly ? "" : "...");
      await db.messages.update(reply.id, { modelId: draftModelId, status: canStreamDirectly ? "streaming" : "pending", requestInfo });
      await db.chats.update(chatId, { updatedAt: timestamp });
    });
    if (!reply) return;
    await onRefresh();
    try {
      if (toolsEnabled(resendImages.length ? promptMessage.id : undefined)) {
        const completed = await completeWithTools(requestMessages, toolLog, toolEvents, inventoryUpdates, chatId, selectedHistory.map((message) => message.id), resendImages.length ? promptMessage.id : undefined);
        const deltaProposal = completed.deltaImminentProposal;
        const completedReplyText = deltaProposal ? `### Δ Delta mode imminent...\n\n${deltaProposal.brief}` : completed.replyText || "(No response text returned.)";
        await db.messages.update(reply.id, {
          body: completedReplyText,
          deltaBrief: deltaProposal ? {
            status: "pending",
            brief: deltaProposal.brief,
            handoffContext: deltaProposal.handoffContext,
            playerCharacterName: deltaProposal.playerCharacterName,
            roster: deltaProposal.roster,
            mapSize: deltaProposal.mapSize,
            avoidLabel: deltaProposal.avoidLabel || "Escape",
            avoidPrompt: deltaProposal.avoidPrompt || "What do you do to avoid the engagement?"
          } : undefined,
          inputTokens: completed.inputTokens,
          outputTokens: completed.outputTokens ?? estimateTokens(deltaProposal?.brief ?? completed.replyText),
          estimatedTokens: !completed.outputTokens,
          status: "complete",
          requestInfo: { ...requestInfo, toolCalls: toolLog.length ? toolLog : ["None"], inventoryUpdates },
          updatedAt: now()
        });
        await onRefresh();
        const memoryReview = await reviewTurnForMemories(chatId, promptMessage.body, completedReplyText, [promptMessage.id, reply.id]);
        await storePostResponseMemoryAudit(reply.id, memoryReview);
        await onRefresh();
        return;
      }
      let completedReplyText = "";
      const response = await openRouterRequest(openRouterPayload(requestMessages, streamingEnabled));
      await db.messages.update(reply.id, { requestInfo: { ...requestInfo, toolCalls: toolLog.length ? toolLog : ["None"] } });
      if (streamingEnabled && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let replyText = "";
        let inputTokens: number | undefined;
        let outputTokens: number | undefined;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const clean = line.trim();
            if (!clean.startsWith("data:")) continue;
            const data = clean.slice(5).trim();
            if (data === "[DONE]") continue;
            const chunk = JSON.parse(data) as { choices?: { delta?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
            replyText += chunk.choices?.[0]?.delta?.content ?? "";
            inputTokens = chunk.usage?.prompt_tokens ?? inputTokens;
            outputTokens = chunk.usage?.completion_tokens ?? outputTokens;
            await db.messages.update(reply.id, { body: replyText, outputTokens: estimateTokens(replyText), updatedAt: now() });
            await onRefresh();
          }
        }
        completedReplyText = replyText || "(No response text returned.)";
        await db.messages.update(reply.id, { body: completedReplyText, inputTokens, outputTokens: outputTokens ?? estimateTokens(replyText), estimatedTokens: !outputTokens, status: "complete", updatedAt: now() });
      } else {
        const json = await response.json() as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
        const replyText = json.choices?.[0]?.message?.content ?? "";
        completedReplyText = replyText || "(No response text returned.)";
        await db.messages.update(reply.id, {
          body: completedReplyText,
          inputTokens: json.usage?.prompt_tokens,
          outputTokens: json.usage?.completion_tokens ?? estimateTokens(replyText),
          estimatedTokens: !json.usage?.completion_tokens,
          status: "complete",
          updatedAt: now()
        });
      }
      await onRefresh();
      const memoryReview = await reviewTurnForMemories(chatId, promptMessage.body, completedReplyText, [promptMessage.id, reply.id]);
      await storePostResponseMemoryAudit(reply.id, memoryReview);
      await onRefresh();
    } catch (error) {
      await db.messages.update(reply.id, {
        body: "OpenRouter request failed.",
        error: error instanceof Error ? error.message : "Unknown error",
        status: "failed",
        requestInfo: { ...requestInfo, toolCalls: toolLog.length ? toolLog : ["None"], inventoryUpdates },
        updatedAt: now()
      });
    }
    await onRefresh();
  }

  async function handleInventoryUpdateAction(message: Message, action: "confirm" | "edit" | "reject") {
    const updates = message.requestInfo?.inventoryUpdates ?? [];
    const pendingUpdates = updates.filter((update) => update.status === "pending");
    if (!pendingUpdates.length) return;
    const status: InventoryUpdateRequest["status"] = action === "confirm" ? "confirmed" : action === "edit" ? "edit" : "rejected";
    if (action === "confirm" && project) {
      for (const update of pendingUpdates) {
        await applyInventoryUpdate(project.id, message.chatId, update);
      }
    }
    await db.messages.update(message.id, {
      requestInfo: {
        ...message.requestInfo,
        settings: message.requestInfo?.settings ?? [],
        toggles: message.requestInfo?.toggles ?? [],
        toolCalls: message.requestInfo?.toolCalls ?? [],
        inventoryUpdates: updates.map((update) => update.status === "pending" ? { ...update, status } : update)
      },
      updatedAt: now()
    });
    const nextDraft =
      action === "confirm"
        ? "((OOC: Inventory update confirmed.))"
        : action === "edit"
          ? "((OOC: Inventory update edit;\n\n))"
          : "((OOC: Inventory update rejected because;\n\n))";
    setBody((current) => current.trim() ? `${current}\n${nextDraft}` : nextDraft);
    await onRefresh();
  }

  async function avoidDeltaBrief(message: Message, attempt: string) {
    const clean = attempt.trim();
    const brief = message.deltaBrief;
    if (!project || !chat || !clean || !brief) return;
    if (!settings.apiKey) {
      alert("Add your OpenRouter API key before resolving this.");
      return;
    }
    if (!draftModelId) {
      alert("Choose a model before resolving this.");
      return;
    }
    const userAttempt = await addMessage(message.chatId, message.branchId, "user", clean);
    await db.messages.update(message.id, { deltaBrief: undefined, updatedAt: now() });
    const pending = await addMessage(message.chatId, message.branchId, "assistant", "...");
    await db.messages.update(pending.id, { modelId: draftModelId, status: "pending", updatedAt: now() });
    await onRefresh();
    try {
      const history = await db.messages
        .where("[chatId+branchId+sequence]")
        .between([message.chatId, message.branchId, Dexie.minKey], [message.chatId, message.branchId, userAttempt.sequence])
        .toArray();
      const recent = history.sort((a, b) => a.sequence - b.sequence).slice(-10);
      const response = await openRouterRequest({
        model: draftModelId,
        messages: [
          {
            role: "system",
            content: [
              "Resolve the player's attempt to avoid an imminent Delta Mode engagement. Return only valid JSON.",
              "Shape: {\"escaped\":false,\"responseText\":\"\"}",
              "Always include an automatic in-world dice roll in responseText, such as Rolling 1d20 + CHA... *6 + 1 =* **7**. Success/failure should fit the attempt and scene.",
              "If escaped is true, the imminent engagement is cancelled or avoided for now and responseText should hand back to normal roleplay.",
              "If escaped is false, the engagement remains imminent and responseText should end with pressure that makes Begin Engagement the remaining path.",
              "Do not speak as an assistant. Keep it immersive and concise."
            ].join("\n")
          },
          {
            role: "user",
            content: [
              `Project: ${project.name}`,
              includeWorld && project.worldSetting ? `World setting:\n${project.worldSetting}` : "",
              `Imminent engagement setup:\n${brief.brief}`,
              `Recent chat:\n${recent.map((row) => `${row.role}: ${row.body}`).join("\n\n")}`,
              `Player attempt:\n${clean}`
            ].filter(Boolean).join("\n\n")
          }
        ],
        temperature: 0,
        top_p: 0
      });
      const json = await response.json() as OpenRouterResponse;
      const packet = parseDeltaAvoidPacket(json.choices?.[0]?.message?.content ?? "");
      await db.messages.update(pending.id, {
        body: packet.responseText || "(No response text returned.)",
        deltaBrief: packet.escaped ? undefined : {
          status: "pending",
          brief: brief.brief,
          handoffContext: brief.handoffContext,
          playerCharacterName: brief.playerCharacterName,
          roster: brief.roster,
          mapSize: brief.mapSize,
          avoidLabel: undefined,
          avoidPrompt: undefined
        },
        status: "complete",
        updatedAt: now()
      });
    } catch (error) {
      await db.messages.update(pending.id, {
        body: "OpenRouter request failed.",
        error: error instanceof Error ? error.message : "Unknown error",
        status: "failed",
        updatedAt: now()
      });
    }
    await onRefresh();
  }

  async function beginDeltaBrief(message: Message) {
    const latestMessage = await db.messages.get(message.id);
    const brief = latestMessage?.deltaBrief ?? message.deltaBrief;
    if (!brief || brief.status !== "pending") return;
    const deltaChat = await db.chats.get(message.chatId);
    if (!deltaChat) return;
    const timestamp = now();
    const selectedCharacterId = brief.playerCharacterId;
    const selectedCharacter = selectedCharacterId ? await db.characters.get(selectedCharacterId) : undefined;
    const selectedPlayerName = selectedCharacter?.name || brief.playerCharacterName || "";
    const baseRoster = brief.roster ?? deltaBriefRosterFromContext(brief.handoffContext);
    const roster = normaliseDeltaBriefRoster(baseRoster);
    if (selectedPlayerName) {
      roster.neutral = roster.neutral.filter((name) => name.toLowerCase() !== selectedPlayerName.toLowerCase());
      roster.enemies = roster.enemies.filter((name) => name.toLowerCase() !== selectedPlayerName.toLowerCase());
      if (!roster.team.some((name) => name.toLowerCase() === selectedPlayerName.toLowerCase())) roster.team.unshift(selectedPlayerName);
    }
    const continuity = deltaContinuityWithoutRosterLines(brief.handoffContext);
    const handoffContext = [...deltaBriefRosterLines(roster), continuity].filter(Boolean).join("\n");
    if (selectedCharacterId) await db.chats.update(deltaChat.id, { deltaPlayerCharacterId: selectedCharacterId, updatedAt: timestamp });
    await db.messages.update(message.id, {
      deltaBrief: { ...brief, status: "started", startedAt: timestamp },
      updatedAt: timestamp
    });
    await onRefresh();
    await onOpenDelta(deltaChat, [
      `DELTA BRIEF:\n${brief.brief}`,
      handoffContext ? `DELTA CONTINUITY ANCHORS:\n${handoffContext}` : "",
      selectedPlayerName ? `PLAYER CHARACTER:\n${selectedPlayerName}` : "",
      `MAP SIZE:\n${brief.mapSize ?? "M"}`,
      selectedCharacterId ? `PLAYER CHARACTER ID:\n${selectedCharacterId}` : ""
    ].filter(Boolean).join("\n\n"), brief.mapSize ?? "M");
  }

  const editMessageRef = useRef(editMessage);
  const resendFromMessageRef = useRef(resendFromMessage);
  const inventoryUpdateActionRef = useRef(handleInventoryUpdateAction);
  const beginDeltaBriefRef = useRef(beginDeltaBrief);
  const avoidDeltaBriefRef = useRef(avoidDeltaBrief);
  const onRefreshRef = useRef(onRefresh);
  editMessageRef.current = editMessage;
  resendFromMessageRef.current = resendFromMessage;
  inventoryUpdateActionRef.current = handleInventoryUpdateAction;
  beginDeltaBriefRef.current = beginDeltaBrief;
  avoidDeltaBriefRef.current = avoidDeltaBrief;
  onRefreshRef.current = onRefresh;
  const toggleExpandedMessage = useCallback((messageId: string) => {
    setExpandedMessageId((current) => current === messageId ? undefined : messageId);
  }, []);
  const editMessageStable = useCallback((message: Message, nextBody: string) => editMessageRef.current(message, nextBody), []);
  const resendFromMessageStable = useCallback((message: Message) => resendFromMessageRef.current(message), []);
  const inventoryUpdateActionStable = useCallback((message: Message, action: "confirm" | "edit" | "reject") => inventoryUpdateActionRef.current(message, action), []);
  const beginDeltaBriefStable = useCallback((message: Message) => beginDeltaBriefRef.current(message), []);
  const avoidDeltaBriefStable = useCallback((message: Message, attempt: string) => avoidDeltaBriefRef.current(message, attempt), []);
  const onRefreshStable = useCallback(() => onRefreshRef.current(), []);
  const openChatSettingsStable = useCallback(() => {
    openChatSettings();
  }, []);

  if (!project) {
    return <EmptyState title="Choose a project" body="Open the sidebar and select a project before starting a chat." />;
  }

  function chooseImages(files: FileList | null) {
    const next = Array.from(files ?? []).filter((file) => file.type.startsWith("image/"));
    if (!next.length) return;
    setAttachedImages((current) => [...current, ...next]);
    setAttachmentError("");
    setContextOpen(false);
  }
  function chooseFiles(files: FileList | null) {
    const next = Array.from(files ?? []);
    if (!next.length) return;
    setAttachedFiles((current) => [...current, ...next]);
    setAttachmentError("");
    setContextOpen(false);
  }

  return (
    <div className="chat-screen">
      {!chat && messages.length === 0 && <EmptyState title="Ready when you are" body="Start a new project chat from the composer." />}
      <div className={`message-list ${settings.bubbleMode === "minimal" ? "minimal" : "bubbles"}`}>
        {messages.map((message) => (
          <MemoMessageRow
            key={message.id}
            projectId={project.id}
            message={message}
            expanded={expandedMessageId === message.id}
            onExpand={toggleExpandedMessage}
            onEdit={editMessageStable}
            onResend={resendFromMessageStable}
            onInventoryUpdateAction={inventoryUpdateActionStable}
            onBeginDeltaBrief={beginDeltaBriefStable}
            onAvoidDeltaBrief={avoidDeltaBriefStable}
            deltaLocked={deltaLocked}
            onOpenChatSettings={openChatSettingsStable}
            onRefresh={onRefreshStable}
          />
        ))}
      </div>
      <section className={`composer ${deltaLocked ? "locked" : ""}`}>
        {deltaLocked && <div className="composer-lock">Resolve engagement to unlock chat.</div>}
        {contextOpen && (
          <div className="context-popover">
            <button className="model-row" type="button" onClick={() => setModelMenuOpen(!modelMenuOpen)}>
              <span>Current model</span>
              <strong>{models.find((model) => model.modelId === draftModelId)?.cosmeticName || draftModelId || "Choose model"}</strong>
            </button>
            {modelMenuOpen && <div className="model-menu">
              {models.length === 0 && <p className="muted-pad">Add models in API settings first.</p>}
              {models.map((model) => <button key={model.modelId} className={model.modelId === draftModelId ? "picked" : ""} type="button" disabled={modelSaving} onClick={() => void chooseChatModel(model.modelId)}><span>{model.cosmeticName}</span><small>{model.modelId}</small></button>)}
            </div>}
            {modelSaveError && <small className="error">{modelSaveError}</small>}
            <button className="drawer-action-row" type="button" onClick={openChatSettings}>
              <Settings size={18} /> Chat settings
            </button>
            <button className="drawer-action-row" type="button" onClick={() => imagePickerRef.current?.click()}><ImageIcon size={18} /> Attach Image</button>
            <button className="drawer-action-row" type="button" onClick={() => filePickerRef.current?.click()}><Paperclip size={18} /> Attach File</button>
            <input ref={filePickerRef} className="visually-hidden" type="file" multiple onChange={(event) => { chooseFiles(event.target.files); event.currentTarget.value = ""; }} />
            <input ref={imagePickerRef} className="visually-hidden" type="file" accept="image/*" multiple onChange={(event) => { chooseImages(event.target.files); event.currentTarget.value = ""; }} />
          </div>
        )}
        {chatSettingsOpen && createPortal(
          <div className="modal-backdrop chat-settings-backdrop" onClick={closeChatSettings}>
            <section className="modal chat-settings-modal" role="dialog" aria-modal="true" aria-labelledby="chat-settings-title" onClick={(event) => event.stopPropagation()}>
              <div className="section-title">
                <h2 id="chat-settings-title">Chat settings</h2>
                <button type="button" className="icon-button" onClick={closeChatSettings} aria-label="Close chat settings"><X size={18} /></button>
              </div>
              <div className="chat-settings-content">
                <label className="compact-check"><input type="checkbox" checked={includeWorld} onChange={(event) => setIncludeWorld(event.target.checked)} /> World Setting</label>
                <label className="compact-check"><input type="checkbox" checked={includeInstructions} onChange={(event) => setIncludeInstructions(event.target.checked)} /> Instructions</label>
                <label className="compact-check"><input type="checkbox" checked={includeCharacters} onChange={(event) => setIncludeCharacters(event.target.checked)} /> Characters</label>
                <label className="compact-check"><input type="checkbox" checked={includeSourceFiles} onChange={(event) => setIncludeSourceFiles(event.target.checked)} /> Source files</label>
                <label className="compact-check"><input type="checkbox" checked={inventoryEnabled} onChange={(event) => setInventoryEnabled(event.target.checked)} /> Enable inventory</label>
                {inventoryEnabled && <div className="inline-setting-pair"><label className="compact-check"><input type="checkbox" checked={autoManageInventory} onChange={(event) => setAutoManageInventory(event.target.checked)} /> Auto manage Inventory</label><label className="compact-check"><input type="checkbox" checked={confirmInventoryUpdates} onChange={(event) => setConfirmInventoryUpdates(event.target.checked)} /> Use confirmation</label></div>}
                <label className="compact-check"><input type="checkbox" checked={gearEnabled} onChange={(event) => setGearEnabled(event.target.checked)} /> Enable gear</label>
                {gearEnabled && <div className="inline-setting-pair"><label className="compact-check"><input type="checkbox" checked={autoManageGear} onChange={(event) => setAutoManageGear(event.target.checked)} /> Auto manage Gear</label><label className="compact-check"><input type="checkbox" checked={confirmGearUpdates} onChange={(event) => setConfirmGearUpdates(event.target.checked)} /> Use confirmation</label></div>}
                <label className="compact-check"><input type="checkbox" checked={compactionEnabled} onChange={(event) => setCompactionEnabled(event.target.checked)} /> Compaction memory</label>
                <button type="button" onClick={() => { closeChatSettings(); onRoute("compaction"); }}><BookOpen size={18} /> Open compaction memory</button>
                <label className="compact-check"><input type="checkbox" checked={streamingEnabled} onChange={(event) => setStreamingEnabled(event.target.checked)} /> Streaming</label>
                <label className="range-row"><span>Temperature <b>{temperature || "0"}</b></span><input type="range" min={0} max={2} step={0.05} value={temperature || "0"} onChange={(event) => setTemperature(event.target.value)} /></label>
                <label className="range-row"><span>Top P <b>{topP || "0"}</b></span><input type="range" min={0} max={1} step={0.05} value={topP || "0"} onChange={(event) => setTopP(event.target.value)} /></label>
                <label>Max output tokens<input type="number" min={1} max={16000} value={maxTokens} placeholder="no limit" onChange={(event) => setMaxTokens(event.target.value)} /></label>
                <label className="compact-check"><input type="checkbox" checked={effectiveHistoryNoLimit} disabled={infiniteHistoryLocked} onChange={(event) => setHistoryNoLimit(event.target.checked)} /> No message history limit</label>
                {infiniteHistoryLocked && <small className="setting-lock-note">This chat is permanently set to infinite context.</small>}
                {!effectiveHistoryNoLimit && <label>Message history limit<input type="number" min={10} max={500} value={maxHistory} onChange={(event) => setMaxHistory(event.target.value)} /></label>}
              </div>
              <div className="split-actions chat-settings-actions">
                <button type="button" onClick={() => void saveChatSettings()}><Save size={18} /> Save</button>
                {saved && <span className="save-status">Saved</span>}
                <button type="button" className="done-button" onClick={closeChatSettings}>Done</button>
              </div>
            </section>
          </div>,
          document.body
        )}
        {(imagePreviewUrls.length > 0 || attachedFiles.length > 0 || attachmentError) && (
          <div className="composer-attachments">
            {imagePreviewUrls.map((item, index) => (
              <div className="composer-image-thumb" key={`${item.file.name}-${index}`}>
                <button type="button" onClick={() => setPreviewImageIndex(previewImageIndex === index ? undefined : index)} aria-label={`Preview ${item.file.name}`}><img src={item.url} alt="" /></button>
                <button type="button" className="attachment-remove" onClick={() => setAttachedImages((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${item.file.name}`}><X size={13} /></button>
              </div>
            ))}
            {attachedFiles.map((file, index) => (
              <div className="composer-file-chip" key={`${file.name}-${index}`}><Paperclip size={14} /><span>{file.name}</span><button type="button" className="attachment-remove" onClick={() => setAttachedFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${file.name}`}><X size={13} /></button></div>
            ))}
            {attachmentError && <small className="error">{attachmentError}</small>}
          </div>
        )}
        {infiniteWarningOpen && (
          <div className="modal-backdrop" onClick={() => setInfiniteWarningOpen(false)}>
            <section className="modal infinite-context-confirm" onClick={(event) => event.stopPropagation()}>
              <div className="section-title"><h2>Use infinite context?</h2></div>
              <p>This chat cannot be changed back to a limited message history after you save it as infinite.</p>
              <div className="split-actions">
                <button type="button" className="save-button" onClick={() => void persistChatSettings(true)}>Save as infinite</button>
                <button type="button" onClick={() => setInfiniteWarningOpen(false)}>Cancel</button>
              </div>
            </section>
          </div>
        )}
        <button className="composer-plus" onClick={() => setContextOpen(!contextOpen)} disabled={deltaLocked} aria-label="Chat settings and attachments">
          <Plus size={20} />
        </button>
        <textarea ref={composerRef} className="composer-input" value={body} onChange={(event) => setBody(event.target.value)} onFocus={() => keepComposerVisible(composerRef.current)} onClick={() => keepComposerVisible(composerRef.current)} disabled={deltaLocked} placeholder={deltaLocked ? "Resolve engagement to unlock chat." : "Message this project"} rows={1} />
        <button className="send-button" onClick={send} disabled={deltaLocked}>Send</button>
      </section>
      {previewImageIndex !== undefined && imagePreviewUrls[previewImageIndex] && (
        <button className="composer-image-viewer" type="button" onClick={() => setPreviewImageIndex(undefined)} aria-label="Close image preview"><img src={imagePreviewUrls[previewImageIndex].url} alt="Attached preview" /></button>
      )}
    </div>
  );
}

function MessageRow({
  projectId,
  message,
  expanded,
  onExpand,
  onEdit,
  onResend,
  onInventoryUpdateAction,
  onBeginDeltaBrief,
  onAvoidDeltaBrief,
  deltaLocked,
  onOpenChatSettings,
  onRefresh
}: {
  projectId: string;
  message: Message;
  expanded: boolean;
  onExpand: (messageId: string) => void;
  onEdit: (message: Message, nextBody: string) => Promise<Message>;
  onResend: (message: Message) => Promise<void>;
  onInventoryUpdateAction: (message: Message, action: "confirm" | "edit" | "reject") => Promise<void>;
  onBeginDeltaBrief: (message: Message) => Promise<void>;
  onAvoidDeltaBrief: (message: Message, attempt: string) => Promise<void>;
  deltaLocked: boolean;
  onOpenChatSettings: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [infoOpen, setInfoOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [draftBody, setDraftBody] = useState(message.body);
  const [editAttachmentMenuOpen, setEditAttachmentMenuOpen] = useState(false);
  const [editAttachments, setEditAttachments] = useState<{ id: string; name?: string; mimeType: string; url: string }[]>([]);
  const [editImageIndex, setEditImageIndex] = useState<number>();
  const [deleteAttachmentId, setDeleteAttachmentId] = useState<string>();
  const [resendConfirm, setResendConfirm] = useState<"resend" | "edit-resend">();
  const [avoidOpen, setAvoidOpen] = useState(false);
  const [avoidText, setAvoidText] = useState("");
  const [avoidSaving, setAvoidSaving] = useState(false);
  const [deltaCharacters, setDeltaCharacters] = useState<Character[]>([]);
  const editImagePickerRef = useRef<HTMLInputElement>(null);
  const editFilePickerRef = useRef<HTMLInputElement>(null);
  const attachmentPressTimer = useRef<number>();
  useEffect(() => setDraftBody(message.body), [message.id, message.body]);
  async function loadDeltaCharacters() {
    const rows = await db.characters.where("projectId").equals(projectId).toArray();
    setDeltaCharacters(rows.sort((a, b) => (a.orderIndex ?? Number.MAX_SAFE_INTEGER) - (b.orderIndex ?? Number.MAX_SAFE_INTEGER) || a.normalisedName.localeCompare(b.normalisedName)));
  }
  useEffect(() => {
    if (message.deltaBrief?.status !== "pending") return;
    void loadDeltaCharacters();
  }, [message.id, message.deltaBrief?.status, projectId]);
  useEffect(() => {
    if (!editOpen) return;
    let alive = true;
    let urls: { url: string }[] = [];
    void db.attachments.where("[ownerType+ownerId]").equals(["message", message.id]).toArray().then((rows) => {
      const next = rows.map((attachment) => ({ id: attachment.id, name: attachment.name, mimeType: attachment.mimeType, url: URL.createObjectURL(attachment.blob) }));
      urls = next;
      if (alive) setEditAttachments(next);
      else next.forEach((attachment) => URL.revokeObjectURL(attachment.url));
    });
    return () => {
      alive = false;
      urls.forEach((attachment) => URL.revokeObjectURL(attachment.url));
      setEditAttachmentMenuOpen(false);
      setDeleteAttachmentId(undefined);
    };
  }, [editOpen, message.id]);
  async function star() {
    await toggleStar(projectId, message);
    await onRefresh();
  }
  async function copyMessage() {
    await navigator.clipboard.writeText(message.body);
  }
  async function resend() {
    if (deltaLocked) return;
    await onResend(message);
  }
  async function saveEdit() {
    if (deltaLocked) return;
    await onEdit(message, draftBody);
    setEditOpen(false);
  }
  async function saveEditAndResend() {
    if (deltaLocked) return;
    const updatedMessage = await onEdit(message, draftBody);
    setEditOpen(false);
    await onResend(updatedMessage);
  }
  async function confirmResendAction() {
    const action = resendConfirm;
    setResendConfirm(undefined);
    if (action === "edit-resend") await saveEditAndResend();
    else if (action === "resend") await resend();
  }
  async function addEditAttachments(files: FileList | null) {
    const next = Array.from(files ?? []);
    if (!next.length) return;
    const timestamp = now();
    await db.attachments.bulkAdd(next.map((file) => ({ id: uid(), ownerType: "message" as const, ownerId: message.id, name: file.name, mimeType: file.type || "application/octet-stream", size: file.size, blob: file, createdAt: timestamp, updatedAt: timestamp })));
    if (next.some((file) => file.type.startsWith("image/"))) await db.messages.update(message.id, { attachmentContext: undefined, updatedAt: timestamp });
    const rows = await db.attachments.where("[ownerType+ownerId]").equals(["message", message.id]).toArray();
    editAttachments.forEach((attachment) => URL.revokeObjectURL(attachment.url));
    setEditAttachments(rows.map((attachment) => ({ id: attachment.id, name: attachment.name, mimeType: attachment.mimeType, url: URL.createObjectURL(attachment.blob) })));
    setEditAttachmentMenuOpen(false);
  }
  function beginAttachmentPress(id: string) {
    window.clearTimeout(attachmentPressTimer.current);
    attachmentPressTimer.current = window.setTimeout(() => setDeleteAttachmentId(id), 520);
  }
  function cancelAttachmentPress() {
    window.clearTimeout(attachmentPressTimer.current);
  }
  async function removeEditAttachment() {
    if (!deleteAttachmentId) return;
    const deleting = editAttachments.find((attachment) => attachment.id === deleteAttachmentId);
    await db.attachments.delete(deleteAttachmentId);
    if (deleting?.mimeType.startsWith("image/")) await db.messages.update(message.id, { attachmentContext: undefined, updatedAt: now() });
    const removed = deleting;
    if (removed) URL.revokeObjectURL(removed.url);
    setEditAttachments((current) => current.filter((attachment) => attachment.id !== deleteAttachmentId));
    setDeleteAttachmentId(undefined);
  }
  async function submitAvoidDelta() {
    if (!avoidText.trim()) return;
    setAvoidSaving(true);
    try {
      await onAvoidDeltaBrief(message, avoidText);
      setAvoidText("");
      setAvoidOpen(false);
    } finally {
      setAvoidSaving(false);
    }
  }
  async function updateDeltaPlayerCharacter(playerCharacterId: string) {
    const brief = message.deltaBrief;
    if (!brief) return;
    const character = deltaCharacters.find((item) => item.id === playerCharacterId);
    await db.messages.update(message.id, {
      deltaBrief: { ...brief, playerCharacterId: character?.id, playerCharacterName: character?.name ?? "" },
      updatedAt: now()
    });
    await onRefresh();
  }
  const visibleDeltaRoster = (() => {
    const brief = message.deltaBrief;
    const roster = normaliseDeltaBriefRoster(brief?.roster ?? deltaBriefRosterFromContext(brief?.handoffContext));
    const selectedName = deltaCharacters.find((character) => character.id === brief?.playerCharacterId)?.name || brief?.playerCharacterName || "";
    if (selectedName) {
      roster.neutral = roster.neutral.filter((name) => name.toLowerCase() !== selectedName.toLowerCase());
      roster.enemies = roster.enemies.filter((name) => name.toLowerCase() !== selectedName.toLowerCase());
      if (!roster.team.some((name) => name.toLowerCase() === selectedName.toLowerCase())) roster.team.unshift(selectedName);
    }
    return roster;
  })();
  return (
    <>
      <article className={`message ${message.role}`} onClick={() => onExpand(message.id)}>
        {expanded && message.role === "assistant" && message.modelId && <div className="message-model">{message.modelId}</div>}
        {message.role === "user" && <MessageImageAttachments messageId={message.id} />}
        <div className="message-body">{message.status === "pending" && message.body.trim() === "..." ? <LoadingSignal /> : <MarkdownText text={message.body} inventoryMarkers />}</div>
        {message.deltaBrief?.status === "pending" && (
          <div className="delta-brief-panel" onClick={(event) => event.stopPropagation()}>
            <div className="delta-brief-preflight">
              <div className="delta-brief-player">
                <span>Player character</span>
                <select
                  value={message.deltaBrief.playerCharacterId || deltaCharacters.find((character) => character.name === message.deltaBrief?.playerCharacterName)?.id || ""}
                  onChange={(event) => void updateDeltaPlayerCharacter(event.target.value)}
                  aria-label="Player character for Delta engagement"
                >
                  <option value="">Player character</option>
                  {deltaCharacters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
                </select>
                <button className="icon-button" type="button" onClick={() => void loadDeltaCharacters()} aria-label="Refresh character list" title="Refresh characters"><RefreshCw size={14} /></button>
              </div>
              {(visibleDeltaRoster.team.length > 0 || visibleDeltaRoster.neutral.length > 0 || visibleDeltaRoster.enemies.length > 0) && (
                <dl className="delta-brief-roster">
                  {visibleDeltaRoster.team.length > 0 && <div><dt>Your team</dt><dd>{visibleDeltaRoster.team.join(", ")}</dd></div>}
                  {visibleDeltaRoster.neutral.length > 0 && <div><dt>Neutral</dt><dd>{visibleDeltaRoster.neutral.join(", ")}</dd></div>}
                  {visibleDeltaRoster.enemies.length > 0 && <div><dt>Enemies</dt><dd>{visibleDeltaRoster.enemies.join(", ")}</dd></div>}
                </dl>
              )}
              <span className="delta-brief-map-size">Map size: <b>{message.deltaBrief.mapSize ?? "M"}</b> ({deltaMapPreviewSizes[message.deltaBrief.mapSize ?? "M"].metres}m)</span>
            </div>
            <div className="delta-brief-actions">
              {message.deltaBrief.avoidLabel && (
                <button type="button" onClick={() => setAvoidOpen(true)}>{message.deltaBrief.avoidLabel}</button>
              )}
              <button type="button" onClick={() => void onBeginDeltaBrief(message)}>Begin Engagement</button>
            </div>
          </div>
        )}
        {message.role === "assistant" && (
          <InventoryUpdateCard
            updates={(message.requestInfo?.inventoryUpdates ?? []).filter((update) => update.status === "pending")}
            onAction={(action) => onInventoryUpdateAction(message, action)}
          />
        )}
        <div className={`message-meta ${expanded ? "show" : ""}`}>
          <button aria-label="Edit message" title={deltaLocked ? "Resolve engagement to unlock editing" : "Edit"} disabled={deltaLocked} onClick={(event) => { event.stopPropagation(); if (!deltaLocked) setEditOpen(true); }}><Edit3 size={16} /></button>
          <button aria-label={message.starred ? "Unstar message" : "Star message"} title={message.starred ? "Unstar" : "Star"} onClick={(event) => { event.stopPropagation(); star(); }}><Star size={16} fill={message.starred ? "currentColor" : "none"} /></button>
          <button aria-label="Copy message" title="Copy" onClick={(event) => { event.stopPropagation(); copyMessage(); }}><Clipboard size={16} /></button>
          <button aria-label="Response audit" title="Response audit" onClick={(event) => { event.stopPropagation(); setInfoOpen(true); }}><Info size={16} /></button>
          <span>{formatMessageDate(message.createdAt)}</span>
          <span>{message.inputTokens ?? message.outputTokens ?? estimateTokens(message.body)}t</span>
          <button className="resend" aria-label="Resend message" title={deltaLocked ? "Resolve engagement to unlock resend" : "Resend"} disabled={deltaLocked} onClick={(event) => { event.stopPropagation(); setResendConfirm("resend"); }}><RefreshCw size={16} /></button>
        </div>
      </article>
      {infoOpen && <MessageInfoModal message={message} onClose={() => setInfoOpen(false)} />}
      {editOpen && (
        <div className="modal-backdrop" onClick={() => setEditOpen(false)}>
          <section className="star-modal message-info-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-title">
              <h2>Edit Message</h2>
              <div className="split-actions">
                <button className="icon-button" onClick={() => setEditAttachmentMenuOpen(!editAttachmentMenuOpen)} aria-label="Message attachments" title="Attachments"><Plus size={18} /></button>
                <button className="icon-button" onClick={() => setEditOpen(false)} aria-label="Close edit message"><X size={18} /></button>
              </div>
            </div>
            {editAttachmentMenuOpen && <div className="edit-attachment-menu">
              <button type="button" onClick={() => { setEditOpen(false); onOpenChatSettings(); }}><Settings size={17} /> Chat settings</button>
              <button type="button" onClick={() => editImagePickerRef.current?.click()}><ImageIcon size={17} /> Attach Image</button>
              <button type="button" onClick={() => editFilePickerRef.current?.click()}><Paperclip size={17} /> Attach File</button>
              <input ref={editImagePickerRef} className="visually-hidden" type="file" accept="image/*" multiple onChange={(event) => { void addEditAttachments(event.target.files); event.currentTarget.value = ""; }} />
              <input ref={editFilePickerRef} className="visually-hidden" type="file" multiple onChange={(event) => { void addEditAttachments(event.target.files); event.currentTarget.value = ""; }} />
            </div>}
            {editAttachments.filter((attachment) => attachment.mimeType.startsWith("image/")).length > 0 && <div className="edit-message-image-strip">
              {editAttachments.filter((attachment) => attachment.mimeType.startsWith("image/")).map((attachment, index) => <button key={attachment.id} type="button" onPointerDown={() => beginAttachmentPress(attachment.id)} onPointerUp={cancelAttachmentPress} onPointerLeave={cancelAttachmentPress} onClick={() => setEditImageIndex(index)}><img src={attachment.url} alt="" /></button>)}
            </div>}
            {editAttachments.some((attachment) => !attachment.mimeType.startsWith("image/")) && <div className="edit-message-file-list">{editAttachments.filter((attachment) => !attachment.mimeType.startsWith("image/")).map((attachment) => <span key={attachment.id}><Paperclip size={14} /> {attachment.name || "Attached file"}</span>)}</div>}
            {deleteAttachmentId && <div className="inline-confirm"><span>Delete this attachment?</span><button onClick={removeEditAttachment}>Delete</button><button onClick={() => setDeleteAttachmentId(undefined)}>Cancel</button></div>}
            <textarea className="large-entry" value={draftBody} onChange={(event) => setDraftBody(event.target.value)} />
            <div className="split-actions">
              <button onClick={saveEdit} disabled={deltaLocked}><Save size={18} /> Save</button>
              {message.role === "user" && <button onClick={() => setResendConfirm("edit-resend")} disabled={deltaLocked}><RefreshCw size={18} /> Save & resend</button>}
              <button onClick={() => setEditOpen(false)}>Cancel</button>
            </div>
          </section>
        </div>
      )}
      {resendConfirm && (
        <div className="modal-backdrop confirm-backdrop" onClick={() => setResendConfirm(undefined)}>
          <section className="confirm-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-title">
              <h2>{resendConfirm === "edit-resend" ? "Save & Resend" : "Resend Message"}</h2>
              <button className="icon-button" onClick={() => setResendConfirm(undefined)} aria-label="Cancel"><X size={18} /></button>
            </div>
            <p>{resendConfirm === "edit-resend" ? "Save this edit and regenerate from this user message? Later messages in this branch will be replaced." : "Regenerate from this user message? Later messages in this branch will be replaced."}</p>
            <div className="split-actions">
              <button onClick={() => { void confirmResendAction(); }}><RefreshCw size={18} /> {resendConfirm === "edit-resend" ? "Save & resend" : "Resend"}</button>
              <button onClick={() => setResendConfirm(undefined)}>Cancel</button>
            </div>
          </section>
        </div>
      )}
      {editImageIndex !== undefined && <ImageViewer attachments={editAttachments.filter((attachment) => attachment.mimeType.startsWith("image/"))} index={editImageIndex} onChange={setEditImageIndex} onClose={() => setEditImageIndex(undefined)} />}
      {avoidOpen && (
        <div className="modal-backdrop" onClick={() => setAvoidOpen(false)}>
          <section className="star-modal message-info-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-title">
              <h2>{message.deltaBrief?.avoidPrompt || "What do you do?"}</h2>
              <button className="icon-button" onClick={() => setAvoidOpen(false)} aria-label="Cancel"><X size={18} /></button>
            </div>
            <textarea className="large-entry" value={avoidText} onChange={(event) => setAvoidText(event.target.value)} rows={5} autoFocus />
            <div className="split-actions">
              <button onClick={submitAvoidDelta} disabled={!avoidText.trim() || avoidSaving}>{avoidSaving ? "Sending..." : "Send"}</button>
              <button onClick={() => setAvoidOpen(false)} disabled={avoidSaving}>Cancel</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

const MemoMessageRow = memo(MessageRow, (previous, next) => {
  const a = previous.message;
  const b = next.message;
  if (previous.projectId !== next.projectId) return false;
  if (previous.expanded !== next.expanded) return false;
  if (previous.deltaLocked !== next.deltaLocked) return false;
  if (a === b) return true;
  return (
    a.id === b.id &&
    a.role === b.role &&
    a.body === b.body &&
    a.status === b.status &&
    a.starred === b.starred &&
    a.modelId === b.modelId &&
    a.error === b.error &&
    a.inputTokens === b.inputTokens &&
    a.outputTokens === b.outputTokens &&
    a.estimatedTokens === b.estimatedTokens &&
    a.updatedAt === b.updatedAt
  );
});

function MessageImageAttachments({ messageId }: { messageId: string }) {
  const [attachments, setAttachments] = useState<{ id: string; url: string; mimeType: string }[]>([]);
  const [viewerIndex, setViewerIndex] = useState<number>();
  useEffect(() => {
    let alive = true;
    let urls: { id: string; url: string; mimeType: string }[] = [];
    setAttachments([]);
    void db.attachments.where("[ownerType+ownerId]").equals(["message", messageId]).toArray().then((rows) => {
      const images = rows.filter((attachment) => attachment.mimeType.startsWith("image/")).map((attachment) => ({ id: attachment.id, mimeType: attachment.mimeType, url: URL.createObjectURL(attachment.blob) }));
      urls = images;
      if (!alive) {
        images.forEach((attachment) => URL.revokeObjectURL(attachment.url));
        return;
      }
      setAttachments(images);
    });
    return () => {
      alive = false;
      urls.forEach((attachment) => URL.revokeObjectURL(attachment.url));
    };
  }, [messageId]);
  if (!attachments.length) return null;
  return <><div className="message-image-strip"><ImageStrip attachments={attachments} onOpen={setViewerIndex} /></div>{viewerIndex !== undefined && <ImageViewer attachments={attachments} index={viewerIndex} onChange={setViewerIndex} onClose={() => setViewerIndex(undefined)} />}</>;
}

function InventoryUpdateCard({ updates, onAction }: { updates: InventoryUpdateRequest[]; onAction: (action: "confirm" | "edit" | "reject") => Promise<void> }) {
  if (!updates.length) return null;
  return (
    <div className="inventory-update-card" onClick={(event) => event.stopPropagation()}>
      <h3>Inventory Update</h3>
      <div className="inventory-update-list">
        {updates.map((update) => (
          <div className={`inventory-update-row ${update.delta > 0 ? "add" : "remove"}`} key={update.id}>
            <span>{update.name}</span>
            <strong>{update.delta > 0 ? "+" : ""}{update.delta}</strong>
          </div>
        ))}
      </div>
      <div className="inventory-update-actions">
        <button type="button" onClick={() => onAction("confirm")}>Confirm</button>
        <button type="button" onClick={() => onAction("edit")}>Edit</button>
        <button type="button" onClick={() => onAction("reject")}>Reject</button>
      </div>
    </div>
  );
}

function MessageInfoModal({ message, onClose }: { message: Message; onClose: () => void }) {
  const audit = message.requestInfo?.audit;
  async function copyAudit() {
    if (!audit) return;
    await navigator.clipboard.writeText(JSON.stringify(audit, null, 2));
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="star-modal message-info-modal" onClick={(event) => event.stopPropagation()}>
        <div className="section-title">
          <h2>Response Audit</h2>
          <div className="split-actions">{audit && <button className="icon-button" onClick={copyAudit} aria-label="Copy complete audit" title="Copy complete audit"><Clipboard size={17} /></button>}<button className="icon-button" onClick={onClose} aria-label="Close response audit"><X size={18} /></button></div>
        </div>
        <div className="info-grid">
          <span>Role</span><strong>{message.role}</strong>
          <span>Status</span><strong>{message.status}</strong>
          {message.modelId && <><span>Model</span><strong>{message.modelId}</strong></>}
          <span>Created</span><strong>{formatMessageDate(message.createdAt)}</strong>
          <span>Tokens</span><strong>{message.inputTokens ?? message.outputTokens ?? estimateTokens(message.body)}t</strong>
          {message.error && <><span>Error</span><strong>{message.error}</strong></>}
        </div>
        {message.requestInfo && (
          <div className="response-audit-sections">
            <details open>
              <summary>Settings and toggles</summary>
              <div className="audit-list">{message.requestInfo.settings.map((item, index) => <p key={`setting-${index}`}>{item}</p>)}{message.requestInfo.toggles.map((item, index) => <p key={`toggle-${index}`}>{item}</p>)}</div>
            </details>
            {audit ? <>
              <details open>
                <summary>Context sources</summary>
                <div className="audit-source-list">{audit.contextSources.map((source) => <div key={source.name} className={source.included ? "included" : "excluded"}><span>{source.name}</span><strong>{source.included ? "Included" : "Not included"}</strong>{source.detail && <small>{source.detail}</small>}</div>)}</div>
              </details>
              <details open>
                <summary>Memory retrieval ({audit.memoryRetrieval.hits.length} hit{audit.memoryRetrieval.hits.length === 1 ? "" : "s"})</summary>
                <div className="audit-block"><p><b>Mode:</b> {audit.memoryRetrieval.mode}</p><p><b>Concepts:</b> {audit.memoryRetrieval.concepts.join(", ") || "None"}</p><p><b>Query:</b> {audit.memoryRetrieval.query || "No search was run"}</p>{audit.memoryRetrieval.hits.length ? audit.memoryRetrieval.hits.map((hit) => <section className="audit-memory-hit" key={hit.id}><strong>{hit.text}</strong><small>Relevance {hit.relevance.toFixed(3)}{hit.tags.length ? ` · ${hit.tags.join(", ")}` : ""}</small></section>) : <p>No memories were supplied to this response.</p>}</div>
              </details>
              <details open>
                <summary>Tool execution ({audit.toolEvents.length})</summary>
                <div className="audit-tool-list">{audit.toolEvents.length ? audit.toolEvents.map((tool, index) => <details key={`${tool.callId}-${index}`}><summary>{index + 1}. {tool.name} · round {tool.round}</summary><label>Arguments<pre>{tool.arguments}</pre></label><label>Returned result<pre>{tool.result}</pre></label><small>Call ID: {tool.callId}</small></details>) : <p>No tools were called.</p>}</div>
              </details>
              <details>
                <summary>History selection ({audit.selectedHistory.length} messages)</summary>
                <div className="audit-history-list">{audit.selectedHistory.map((item) => <div key={item.id}><span>#{item.sequence} · {item.role}</span><strong>{item.usedCondensation ? "Condensed" : "Original"}</strong><small>{item.id}</small></div>)}</div>
              </details>
              <details>
                <summary>Exact sanitized request payload</summary>
                <p className="audit-note">This is the payload sent to OpenRouter, except image bytes are replaced with a marker. The API key is never part of the payload.</p>
                <pre className="audit-payload">{JSON.stringify(audit.requestPayload, null, 2)}</pre>
              </details>
              <details open>
                <summary>Post-response memory review</summary>
                {audit.postResponseMemory ? <div className="audit-block"><p><b>Status:</b> {audit.postResponseMemory.status}</p>{audit.postResponseMemory.reason && <p>{audit.postResponseMemory.reason}</p>}{audit.postResponseMemory.error && <p className="error">{audit.postResponseMemory.error}</p>}<p><b>Messages considered for condensation:</b> {audit.postResponseMemory.condensationMessageIds.join(", ") || "None"}</p>{audit.postResponseMemory.candidates.map((candidate, index) => <section className="audit-memory-hit" key={`${candidate.text}-${index}`}><strong>{candidate.text}</strong><small>{candidate.action}{candidate.tags.length ? ` · ${candidate.tags.join(", ")}` : ""}</small></section>)}{audit.postResponseMemory.requestPayload && <details><summary>Memory review request</summary><pre className="audit-payload">{JSON.stringify(audit.postResponseMemory.requestPayload, null, 2)}</pre></details>}{audit.postResponseMemory.rawResponse !== undefined && <details><summary>Raw memory review response</summary><pre className="audit-payload">{audit.postResponseMemory.rawResponse || "(empty response)"}</pre></details>}</div> : <p>Review has not completed or was not captured.</p>}
              </details>
            </> : <p className="notice">This message predates response auditing. New replies and resends will include the full audit.</p>}
          </div>
        )}
      </section>
    </div>
  );
}

function ProjectsPage({ projects, selectedProjectId, onSelect, onEdit, onRefresh }: { projects: Project[]; selectedProjectId?: string; onSelect: (id: string) => void; onEdit: (id: string) => void; onRefresh: () => Promise<void> }) {
  const [draftName, setDraftName] = useState("");
  async function add() {
    const project = await createProject(draftName.trim() || "Untitled Project");
    setDraftName("");
    onSelect(project.id);
    await onRefresh();
  }
  return (
    <Page>
      <div className="form-row">
        <input value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder="New project name" />
        <button onClick={add}><Plus size={18} /> Add</button>
      </div>
      {projects.map((project, index) => (
        <ProjectCard key={project.id} project={project} active={project.id === selectedProjectId} index={index} total={projects.length} onSelect={onSelect} onEdit={onEdit} projects={projects} onRefresh={onRefresh} />
      ))}
    </Page>
  );
}

function ProjectCard({ project, active, index, total, onSelect, onEdit, projects, onRefresh }: { project: Project; active: boolean; index: number; total: number; onSelect: (id: string) => void; onEdit: (id: string) => void; projects: Project[]; onRefresh: () => Promise<void> }) {
  async function move(direction: -1 | 1) {
    const swap = projects[index + direction];
    if (!swap) return;
    await db.transaction("rw", db.projects, async () => {
      await db.projects.update(project.id, { orderIndex: swap.orderIndex, updatedAt: now() });
      await db.projects.update(swap.id, { orderIndex: project.orderIndex, updatedAt: now() });
    });
    await onRefresh();
  }
  async function remove() {
    const count = await db.messages.where("chatId").anyOf((await db.chats.where("projectId").equals(project.id).primaryKeys()) as string[]).count();
    const ok = count > 0 ? prompt(`Deleting this project removes chats, messages, stars, archives, characters, and memories. Type DELETE ${project.name} to continue.`) === `DELETE ${project.name}` : confirm("Delete this project and its associated records?");
    if (!ok) return;
    await db.transaction("rw", [db.projects, db.chats, db.branches, db.messages, db.stars, db.attachments, db.archives, db.archiveEntries, db.characters, db.characterBonuses, db.characterGearSlots, db.characterActionSlots, db.characterActionMacros, db.memories, db.inventoryItems, db.inventoryLogs, db.deltaSessions, db.deltaMessages, db.deltaEntities, db.deltaAllyCache, db.deltaActionMacros, db.deltaEffects, db.deltaIcons], async () => {
      const chatIds = (await db.chats.where("projectId").equals(project.id).primaryKeys()) as string[];
      const archiveIds = (await db.archives.where("projectId").equals(project.id).primaryKeys()) as string[];
      const characterIds = (await db.characters.where("projectId").equals(project.id).primaryKeys()) as string[];
      const messageIds = chatIds.length ? (await db.messages.where("chatId").anyOf(chatIds).primaryKeys()) as string[] : [];
      const attachmentIds = messageIds.length
        ? (await db.attachments.filter((attachment) => attachment.ownerType === "message" && messageIds.includes(attachment.ownerId)).primaryKeys()) as string[]
        : [];
      const deltaSessionIds = chatIds.length ? (await db.deltaSessions.where("chatId").anyOf(chatIds).primaryKeys()) as string[] : [];
      if (attachmentIds.length) await db.attachments.bulkDelete(attachmentIds);
      const actionSlotIds = characterIds.length ? (await db.characterActionSlots.where("characterId").anyOf(characterIds).primaryKeys()) as string[] : [];
      if (actionSlotIds.length) await db.characterActionMacros.where("slotId").anyOf(actionSlotIds).delete();
      if (characterIds.length) await db.characterActionSlots.where("characterId").anyOf(characterIds).delete();
      await db.messages.where("chatId").anyOf(chatIds).delete();
      await db.branches.where("chatId").anyOf(chatIds).delete();
      if (chatIds.length) {
        await db.inventoryItems.where("chatId").anyOf(chatIds).delete();
        await db.inventoryLogs.where("chatId").anyOf(chatIds).delete();
      }
      if (chatIds.length) await db.deltaActionMacros.where("chatId").anyOf(chatIds).delete();
      if (chatIds.length) await db.deltaAllyCache.where("chatId").anyOf(chatIds).delete();
      await db.chats.where("projectId").equals(project.id).delete();
      await db.stars.where("projectId").equals(project.id).delete();
      await db.archiveEntries.where("archiveId").anyOf(archiveIds).delete();
      await db.archives.where("projectId").equals(project.id).delete();
      await db.characterBonuses.where("characterId").anyOf(characterIds).delete();
      if (characterIds.length) await db.characterGearSlots.where("characterId").anyOf(characterIds).delete();
      await db.characters.where("projectId").equals(project.id).delete();
      await db.memories.where("projectId").equals(project.id).delete();
      if (deltaSessionIds.length) {
        await db.deltaMessages.where("sessionId").anyOf(deltaSessionIds).delete();
        await db.deltaEntities.where("sessionId").anyOf(deltaSessionIds).delete();
      }
      if (deltaSessionIds.length) await db.deltaSessions.where("id").anyOf(deltaSessionIds).delete();
      await db.deltaEffects.where("projectId").equals(project.id).delete();
      await db.deltaIcons.where("projectId").equals(project.id).delete();
      await db.projects.delete(project.id);
    });
    await onRefresh();
  }
  return (
    <section className={`item-card ${active ? "selected" : ""}`}>
      <button className="item-main" onClick={() => onSelect(project.id)}>
        <ProjectIcon name={project.iconName} color={project.iconColor} size={28} />
        <span>{project.name}</span>
      </button>
      <div className="card-actions">
        <button onClick={() => onEdit(project.id)}><Edit3 size={18} /> Edit</button>
        <button disabled={index === 0} onClick={() => move(-1)}>Move Up</button>
        <button disabled={index === total - 1} onClick={() => move(1)}>Move Down</button>
        <button className="danger" onClick={remove}><Trash2 size={18} /> Delete</button>
      </div>
    </section>
  );
}

function ProjectEditPage({ project, initialTab = "general", onRefresh, onDone }: { project: Project; initialTab?: "general" | "delta"; onRefresh: () => Promise<void>; onDone: () => void }) {
  const [draft, setDraft] = useState(project);
  const [tab, setTab] = useState<"general" | "delta">(initialTab);
  const [deltaTab, setDeltaTab] = useState<"system" | "values" | "prefix" | "base" | "job" | "effects">("system");
  const [deltaStats, setDeltaStats] = useState<AbilityScores>(cleanAbilityScores(project.deltaDefaultNpcStats));
  const [deltaPrefixes, setDeltaPrefixes] = useState<DeltaPrefixTemplate[]>(effectiveDeltaPrefixes(project.deltaPrefixes));
  const [deltaBases, setDeltaBases] = useState<DeltaBaseTemplate[]>(deltaBaseDraft(project.deltaBases));
  const [deltaJobs, setDeltaJobs] = useState<DeltaJobTemplate[]>(project.deltaJobs ?? defaultDeltaJobs());
  const [deltaSystemPrompt, setDeltaSystemPrompt] = useState(effectiveDeltaSystemPrompt(project.deltaSystemPrompt));
  const [deltaRevealText, setDeltaRevealText] = useState(project.deltaRevealText ?? true);
  const [deltaRevealSpeed, setDeltaRevealSpeed] = useState(project.deltaRevealSpeed ?? 5);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [editingProjectName, setEditingProjectName] = useState(false);
  const [saved, showSaved] = useSavedNotice();
  const [deltaSaved, showDeltaSaved] = useSavedNotice();
  useEffect(() => {
    setDraft(project);
    setDeltaStats(cleanAbilityScores(project.deltaDefaultNpcStats));
    setDeltaPrefixes(effectiveDeltaPrefixes(project.deltaPrefixes));
    setDeltaBases(deltaBaseDraft(project.deltaBases));
    setDeltaJobs(project.deltaJobs ?? defaultDeltaJobs());
    setDeltaSystemPrompt(effectiveDeltaSystemPrompt(project.deltaSystemPrompt));
    setDeltaRevealText(project.deltaRevealText ?? true);
    setDeltaRevealSpeed(project.deltaRevealSpeed ?? 5);
    setEditingProjectName(false);
  }, [project.id]);
  async function save() {
    const nextDraft = { ...draft, deltaEnabled: Boolean(draft.deltaEnabled && draft.inventoryEnabled && draft.gearEnabled) };
    await db.projects.put({ ...nextDraft, updatedAt: now() });
    setDraft(nextDraft);
    showSaved();
    await onRefresh();
  }
  async function saveDeltaPatch(patch: Partial<Pick<Project, "deltaDefaultNpcStats" | "deltaPrefixes" | "deltaBases" | "deltaJobs" | "deltaSystemPrompt" | "deltaRevealText" | "deltaRevealSpeed">>) {
    await db.projects.update(project.id, { ...patch, updatedAt: now() });
    showDeltaSaved();
    await onRefresh();
  }
  async function revertDeltaSystemPrompt() {
    setDeltaSystemPrompt(defaultDeltaSystemPrompt);
    await saveDeltaPatch({ deltaSystemPrompt: defaultDeltaSystemPrompt });
  }
  return (
    <Page>
      <div className="settings-tabs">
        <button className={tab === "general" ? "picked" : ""} onClick={() => setTab("general")}><Folder size={18} /> General</button>
        <button className={tab === "delta" ? "picked" : ""} onClick={() => setTab("delta")}><Swords size={18} /> Delta</button>
      </div>
      {tab === "general" && (
      <section className="item-card stack">
        <div className="project-identity-editor">
          <button className="project-icon-edit" onClick={() => setShowIconPicker(true)} aria-label="Change project icon" title="Change project icon"><ProjectIcon name={draft.iconName} color={draft.iconColor} size={36} /></button>
          {editingProjectName ? (
            <input className="project-name-input" autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} onBlur={() => setEditingProjectName(false)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} aria-label="Project name" />
          ) : (
            <button className="project-name-edit" onClick={() => setEditingProjectName(true)} title="Rename project">{draft.name || "Untitled project"}</button>
          )}
        </div>
        {showIconPicker && (
          <div className="modal-backdrop project-icon-picker-backdrop" onClick={() => setShowIconPicker(false)}>
            <section className="project-icon-picker" role="dialog" aria-modal="true" aria-label="Choose project icon" onClick={(event) => event.stopPropagation()}>
              <div className="section-title"><h2>Choose an icon</h2><button className="icon-button" onClick={() => setShowIconPicker(false)} aria-label="Close icon picker"><X size={18} /></button></div>
              <div className="icon-grid project-icon-grid">
              {projectIcons.map(({ name, label }) => (
                  <button key={name} className={draft.iconName === name ? "picked" : ""} onClick={() => { setDraft({ ...draft, iconName: name }); setShowIconPicker(false); }} aria-label={label} title={label}>
                  <ProjectIcon name={name} color={draft.iconColor} />
                </button>
              ))}
              </div>
              <div className="project-icon-colors"><span>Colour</span><ColorSwatches value={draft.iconColor} onChange={(iconColor) => setDraft({ ...draft, iconColor })} /></div>
            </section>
          </div>
        )}
        <div className="inventory-setting-row"><label className="compact-check"><input type="checkbox" checked={draft.inventoryEnabled} onChange={(event) => setDraft({ ...draft, inventoryEnabled: event.target.checked })} /> Enable inventory</label>{draft.inventoryEnabled && <label className="inventory-currency-name">Currency name<input value={draft.currencyName ?? ""} onChange={(event) => setDraft({ ...draft, currencyName: event.target.value })} placeholder="currency name" /></label>}</div>
        <label className="compact-check"><input type="checkbox" checked={draft.gearEnabled} onChange={(event) => setDraft({ ...draft, gearEnabled: event.target.checked })} /> Enable gear</label>
        <div className="delta-mode-setting-row"><label className="compact-check"><input type="checkbox" checked={Boolean(draft.deltaEnabled && draft.inventoryEnabled && draft.gearEnabled)} disabled={!draft.inventoryEnabled || !draft.gearEnabled} onChange={(event) => setDraft({ ...draft, deltaEnabled: event.target.checked })} /> Enable Delta Mode</label>{(!draft.inventoryEnabled || !draft.gearEnabled) && <small>Requires inventory and gear enabled</small>}</div>
        <textarea value={draft.instructions} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} placeholder="Project Instructions" />
        <textarea value={draft.worldSetting} onChange={(event) => setDraft({ ...draft, worldSetting: event.target.value })} placeholder="World Setting" />
        <label>Memory mode <select value={draft.memoryMode} onChange={(event) => setDraft({ ...draft, memoryMode: event.target.value as Project["memoryMode"] })}><option value="manual">Manual</option><option value="automatic">Automatic</option><option value="approval">Automatic with Approval</option></select></label>
        <textarea value={draft.memoryInstruction} onChange={(event) => setDraft({ ...draft, memoryInstruction: event.target.value })} />
        <SourceFilesSection project={project} />
        <div className="split-actions persistent-actions"><button onClick={save}><Save size={18} /> Save</button><button className="done-button" onClick={onDone}>Done</button>{saved && <span className="save-status">Saved</span>}</div>
      </section>
      )}
      {tab === "delta" && (
        <>
        <div className="delta-settings-subtabs" role="tablist" aria-label="Project Delta settings sections">
          <button className={deltaTab === "system" ? "picked" : ""} onClick={() => setDeltaTab("system")}>SYSTEM</button>
          <button className={deltaTab === "values" ? "picked" : ""} onClick={() => setDeltaTab("values")}>VALUES</button>
          <button className={deltaTab === "prefix" ? "picked" : ""} onClick={() => setDeltaTab("prefix")}>PREFIX</button>
          <button className={deltaTab === "base" ? "picked" : ""} onClick={() => setDeltaTab("base")}>BASE</button>
          <button className={deltaTab === "job" ? "picked" : ""} onClick={() => setDeltaTab("job")}>JOB</button>
          <button className={deltaTab === "effects" ? "picked" : ""} onClick={() => setDeltaTab("effects")}>EFFECTS</button>
        </div>
        <div className="stack delta-settings-editor">
          {deltaTab === "system" && (
          <section className="panel stack">
            <div className="section-title"><h2>System Prompt</h2></div>
            <p className="notice">This is the full Delta Mode system prompt for this project. Revert restores Mirror's default Delta behavior.</p>
            <p className="delta-prompt-warning">Warning: Only change this prompt if you know what you are doing.</p>
            <textarea className="large-entry" value={deltaSystemPrompt} onChange={(event) => setDeltaSystemPrompt(event.target.value)} />
            <div className="delta-stream-setting-row">
              <label className="compact-check"><input type="checkbox" checked={deltaRevealText} onChange={(event) => setDeltaRevealText(event.target.checked)} /> Stream text</label>
              {deltaRevealText && <label className="delta-stream-speed"><span>Speed <b>{deltaRevealSpeed}</b></span><input type="range" min={1} max={10} step={1} value={deltaRevealSpeed} onChange={(event) => setDeltaRevealSpeed(Number(event.target.value))} /></label>}
            </div>
            <div className="split-actions persistent-actions">
              <button onClick={() => saveDeltaPatch({ deltaSystemPrompt: deltaSystemPrompt.trim() || defaultDeltaSystemPrompt, deltaRevealText, deltaRevealSpeed })}><Save size={18} /> Save SYSTEM</button>
              <button onClick={revertDeltaSystemPrompt}>Revert to default</button>
              {deltaSaved && <span className="save-status">Saved</span>}
              <button className="delta-settings-done done-button" onClick={onDone}>Done</button>
            </div>
          </section>
          )}

          {deltaTab === "values" && (
          <section className="panel stack">
            <div className="section-title"><h2>Default NPC Values</h2></div>
            <p className="notice">Starting stats for generated Delta characters that do not have saved character stats.</p>
            <AbilityScoreEditor value={deltaStats} onChange={setDeltaStats} />
            <div className="split-actions persistent-actions"><button onClick={() => saveDeltaPatch({ deltaDefaultNpcStats: cleanAbilityScores(deltaStats) })}><Save size={18} /> Save Default NPC Values</button>{deltaSaved && <span className="save-status">Saved</span>}<button className="delta-settings-done done-button" onClick={onDone}>Done</button></div>
          </section>
          )}

          {deltaTab === "prefix" && (
          <section className="panel stack">
            <div className="section-title"><h2>PREFIXES</h2></div>
            <p className="notice">PREFIX templates are the first part of [PREFIX]-[BASE] [JOB].</p>
            <DeltaPrefixEditor value={deltaPrefixes} onChange={setDeltaPrefixes} />
            <div className="split-actions persistent-actions">
              <button onClick={() => setDeltaPrefixes([...deltaPrefixes, { id: uid(), label: "", statModifiers: {} }])}><Plus size={18} /> Add PREFIX</button>
              <button onClick={() => saveDeltaPatch({ deltaPrefixes: cleanDeltaPrefixes(deltaPrefixes) })}><Save size={18} /> Save PREFIXES</button>
              {deltaSaved && <span className="save-status">Saved</span>}
              <button className="delta-settings-done done-button" onClick={onDone}>Done</button>
            </div>
          </section>
          )}

          {deltaTab === "base" && (
          <section className="panel stack">
            <div className="section-title"><h2>BASES</h2></div>
            <p className="notice">BASE templates are modifiers applied on top of Default NPC Values, not full repeated stat blocks.</p>
            <DeltaBaseEditor value={deltaBases} onChange={setDeltaBases} />
            <div className="split-actions persistent-actions">
              <button onClick={() => setDeltaBases([...deltaBases, { id: uid(), label: "", statModifiers: {} }])}><Plus size={18} /> Add BASE</button>
              <button onClick={() => saveDeltaPatch({ deltaBases: cleanDeltaBases(deltaBases) })}><Save size={18} /> Save BASES</button>
              {deltaSaved && <span className="save-status">Saved</span>}
              <button className="delta-settings-done done-button" onClick={onDone}>Done</button>
            </div>
          </section>
          )}

          {deltaTab === "job" && (
          <section className="panel stack">
            <div className="section-title"><h2>JOBS</h2></div>
            <div className="notice delta-job-help">
              <p>Each .txt filename becomes its JOB category. Each non-empty line must be JOB STR DEX CON INT WIS CHA.</p>
              <small>Use dashes instead of spaces in filenames, for example street-lowlife.txt.</small>
            </div>
            <DeltaJobImport value={deltaJobs} onChange={setDeltaJobs} />
            <div className="split-actions persistent-actions"><button onClick={() => saveDeltaPatch({ deltaJobs: cleanDeltaJobs(deltaJobs) })}><Save size={18} /> Save JOBS</button>{deltaSaved && <span className="save-status">Saved</span>}<button className="delta-settings-done done-button" onClick={onDone}>Done</button></div>
          </section>
          )}

          {deltaTab === "effects" && <DeltaEffectsEditor project={project} onDone={onDone} />}
        </div>
        </>
      )}
    </Page>
  );
}

function newDeltaEffect(projectId: string, polarity: DeltaEffectPolarity): DeltaEffectDefinition {
  const timestamp = now();
  return {
    id: uid(),
    projectId,
    name: "",
    polarity,
    turns: undefined,
    effectText: "",
    curable: false,
    cureText: "",
    cureEndBehavior: "remove",
    ko: false,
    koText: "",
    koEndBehavior: "remove",
    targetSelf: true,
    targetOthers: false,
    targetAllies: true,
    targetNeutral: true,
    targetEnemies: true,
    targetMode: "single",
    maxTargets: undefined,
    savingThrowEnabled: false,
    savingThrowStat: undefined,
    savingThrowMinimum: undefined,
    savingThrowTiming: "inflict",
    cancelledByStatus: false,
    cancellationPolarity: "negative",
    cancelledByEffectIds: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

const savingThrowTimingHelp: Record<DeltaSavingThrowTiming, string> = {
  inflict: "Attempt saving throw when effect is inflicted.",
  "turn-start": "Attempt saving throw at start of user's turn.",
  "turn-end": "Attempt saving throw at end of user's turn.",
  "every-turn": "Attempt saving throw at start of every turn, regardless of whose turn it is."
};

function DeltaEffectsEditor({ project, onDone }: { project: Project; onDone: () => void }) {
  const [effects, setEffects] = useState<DeltaEffectDefinition[]>([]);
  const [icons, setIcons] = useState<DeltaIconAsset[]>([]);
  const [editing, setEditing] = useState<DeltaEffectDefinition>();
  const [iconLibraryOpen, setIconLibraryOpen] = useState(false);
  const [deleteEffect, setDeleteEffect] = useState<DeltaEffectDefinition>();
  const [saved, showSaved] = useSavedNotice();

  async function load() {
    const [effectRows, iconRows] = await Promise.all([
      db.deltaEffects.where("projectId").equals(project.id).sortBy("createdAt"),
      db.deltaIcons.where("projectId").equals(project.id).sortBy("name")
    ]);
    setEffects(effectRows);
    setIcons(iconRows);
  }

  useEffect(() => { void load(); }, [project.id]);

  function saveDraftEffect() {
    if (!editing?.name.trim()) return;
    const cleaned = { ...editing, name: editing.name.trim(), updatedAt: now() };
    setEffects((current) => current.some((effect) => effect.id === cleaned.id)
      ? current.map((effect) => effect.id === cleaned.id ? cleaned : effect)
      : [...current, cleaned]);
    setEditing(undefined);
  }

  async function saveEffects() {
    await db.transaction("rw", db.deltaEffects, async () => {
      await db.deltaEffects.where("projectId").equals(project.id).delete();
      if (effects.length) await db.deltaEffects.bulkPut(effects.map((effect) => ({ ...effect, projectId: project.id, updatedAt: now() })));
    });
    showSaved();
  }

  function confirmDeleteEffect() {
    if (!deleteEffect) return;
    setEffects((current) => current.filter((effect) => effect.id !== deleteEffect.id));
    setDeleteEffect(undefined);
  }

  const iconFor = (id?: string) => icons.find((icon) => icon.id === id);
  const renderGroup = (polarity: DeltaEffectPolarity, title: string) => {
    const rows = effects.filter((effect) => effect.polarity === polarity);
    return (
      <section className="delta-effect-group">
        <div className="section-title"><h3>{title}</h3><button className="icon-button" onClick={() => setEditing(newDeltaEffect(project.id, polarity))} aria-label={`Add ${title.toLowerCase()} effect`} title={`Add ${title.toLowerCase()} effect`}><Plus size={16} /></button></div>
        {rows.length === 0 && <p className="delta-effect-empty">No effects configured.</p>}
        {rows.map((effect) => {
          const icon = iconFor(effect.iconId);
          return (
            <div className="delta-effect-row" key={effect.id}>
              <span className="delta-effect-row-icon">{icon ? <img src={icon.dataUrl} alt="" /> : <span />}</span>
              <strong>{effect.name}</strong>
              <small>{effect.effectText || "No effect text"}</small>
              <button className="icon-button" onClick={() => setEditing({ ...effect, cancelledByEffectIds: [...effect.cancelledByEffectIds] })} aria-label={`Edit ${effect.name}`}><Pencil size={15} /></button>
              <button className="icon-button danger-icon" onClick={() => setDeleteEffect(effect)} aria-label={`Delete ${effect.name}`}><Trash2 size={15} /></button>
            </div>
          );
        })}
      </section>
    );
  };

  return (
    <section className="panel stack delta-effects-page">
      <div className="section-title"><h2>Effects</h2><button onClick={() => setIconLibraryOpen(true)}><ImageIcon size={16} /> Icon library</button></div>
      <p className="notice">Create reusable buffs and debuffs for this project's Delta system. Runtime effect application will plug into these definitions later.</p>
      {renderGroup("positive", "Positive (buffs)")}
      {renderGroup("negative", "Negative (debuffs)")}
      <div className="split-actions persistent-actions"><button onClick={saveEffects}><Save size={18} /> Save EFFECTS</button>{saved && <span className="save-status">Saved</span>}<button className="delta-settings-done done-button" onClick={onDone}>Done</button></div>

      {editing && (
        <div className="modal-backdrop delta-effect-modal-backdrop" onClick={() => setEditing(undefined)}>
          <section className="delta-effect-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-title"><h2>{effects.some((effect) => effect.id === editing.id) ? "Edit effect" : "Add effect"}</h2><button className="icon-button" onClick={() => setEditing(undefined)} aria-label="Close"><X size={18} /></button></div>
            <div className="delta-effect-name-row">
              <button className="delta-effect-icon-pick" onClick={() => setIconLibraryOpen(true)} aria-label="Choose effect icon">
                {iconFor(editing.iconId) ? <img src={iconFor(editing.iconId)?.dataUrl} alt="" /> : <ImageIcon size={20} />}
              </button>
              <label>Name<input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} placeholder="Effect name" /></label>
              <label>Turns<input type="number" min={0} value={editing.turns ?? ""} onChange={(event) => setEditing({ ...editing, turns: event.target.value === "" ? undefined : Math.max(0, Number(event.target.value)) })} /></label>
            </div>
            <label>Effect<textarea value={editing.effectText} onChange={(event) => setEditing({ ...editing, effectText: event.target.value })} placeholder="What this effect does" /></label>

            <div className="delta-effect-pair">
              <section>
                <label className="compact-check"><input type="checkbox" checked={editing.curable} onChange={(event) => setEditing({ ...editing, curable: event.target.checked })} /> Curable</label>
                {editing.curable && <><label>Cure<input value={editing.cureText} onChange={(event) => setEditing({ ...editing, cureText: event.target.value })} placeholder="How this effect is cured" /></label><label>Cure on engagement end<select value={editing.cureEndBehavior} onChange={(event) => setEditing({ ...editing, cureEndBehavior: event.target.value as DeltaEffectDefinition["cureEndBehavior"] })}><option value="remove">Completely</option><option value="retain">Retain until expiry</option></select></label></>}
              </section>
              <section>
                <label className="compact-check"><input type="checkbox" checked={editing.ko} onChange={(event) => setEditing({ ...editing, ko: event.target.checked })} /> KO</label>
                {editing.ko && <><label>KO behavior<input value={editing.koText} onChange={(event) => setEditing({ ...editing, koText: event.target.value })} placeholder="What causes KO" /></label><label>Remove KO on engagement end<select value={editing.koEndBehavior} onChange={(event) => setEditing({ ...editing, koEndBehavior: event.target.value as DeltaEffectDefinition["koEndBehavior"] })}><option value="remove">Completely</option><option value="retain">Retain until expiry</option></select></label></>}
              </section>
            </div>

            <fieldset className="delta-effect-fieldset"><legend>Targeting behavior</legend>
              <div className="delta-effect-check-row"><label><input type="checkbox" checked={editing.targetSelf} onChange={(event) => setEditing({ ...editing, targetSelf: event.target.checked })} /> Self</label><label><input type="checkbox" checked={editing.targetOthers} onChange={(event) => setEditing({ ...editing, targetOthers: event.target.checked })} /> Others</label></div>
              <div className="delta-effect-check-row"><label><input type="checkbox" checked={editing.targetAllies} onChange={(event) => setEditing({ ...editing, targetAllies: event.target.checked })} /> Allies</label><label><input type="checkbox" checked={editing.targetNeutral} onChange={(event) => setEditing({ ...editing, targetNeutral: event.target.checked })} /> Neutral</label><label><input type="checkbox" checked={editing.targetEnemies} onChange={(event) => setEditing({ ...editing, targetEnemies: event.target.checked })} /> Enemy</label></div>
              <div className="delta-effect-check-row"><label><input type="radio" name="target-mode" checked={editing.targetMode === "single"} onChange={() => setEditing({ ...editing, targetMode: "single", maxTargets: undefined })} /> Single</label><label><input type="radio" name="target-mode" checked={editing.targetMode === "multiple"} onChange={() => setEditing({ ...editing, targetMode: "multiple" })} /> Multiple</label>{editing.targetMode === "multiple" && <label>Max targets<input type="number" min={1} value={editing.maxTargets ?? ""} onChange={(event) => setEditing({ ...editing, maxTargets: event.target.value === "" ? undefined : Math.max(1, Number(event.target.value)) })} /></label>}</div>
            </fieldset>

            <fieldset className="delta-effect-fieldset"><legend>Saving throw</legend>
              <label className="compact-check"><input type="checkbox" checked={editing.savingThrowEnabled} onChange={(event) => setEditing({ ...editing, savingThrowEnabled: event.target.checked })} /> Enable saving throw</label>
              {editing.savingThrowEnabled && <>
                <div className="delta-effect-inline-fields"><label>Stat<select value={editing.savingThrowStat ?? ""} onChange={(event) => setEditing({ ...editing, savingThrowStat: event.target.value as Ability })}><option value="" disabled>Select</option>{abilities.map((ability) => <option key={ability} value={ability}>{ability}</option>)}</select></label><label>Minimum<input type="number" value={editing.savingThrowMinimum ?? ""} onChange={(event) => setEditing({ ...editing, savingThrowMinimum: event.target.value === "" ? undefined : Number(event.target.value) })} /></label></div>
                <strong className="delta-effect-subheading">Initiate saving throw on:</strong>
                <div className="delta-effect-timing">
                  {(["inflict", "turn-start", "turn-end", "every-turn"] as DeltaSavingThrowTiming[]).map((timing) => <label key={timing}><input type="radio" name="saving-timing" checked={editing.savingThrowTiming === timing} onChange={() => setEditing({ ...editing, savingThrowTiming: timing })} /> {timing === "inflict" ? "INFLICT" : timing === "turn-start" ? "TURN START" : timing === "turn-end" ? "TURN END" : "EVERY TURN"}</label>)}
                </div>
                <p className="delta-effect-helper">{savingThrowTimingHelp[editing.savingThrowTiming]}</p>
              </>}
            </fieldset>

            <fieldset className="delta-effect-fieldset"><legend>Cancelled by status</legend>
              <label className="compact-check"><input type="checkbox" checked={editing.cancelledByStatus} onChange={(event) => setEditing({ ...editing, cancelledByStatus: event.target.checked })} /> Enable status cancellation</label>
              {editing.cancelledByStatus && <>
                <div className="delta-effect-check-row"><label><input type="radio" name="cancel-polarity" checked={editing.cancellationPolarity === "positive"} onChange={() => setEditing({ ...editing, cancellationPolarity: "positive", cancelledByEffectIds: [] })} /> Positive</label><label><input type="radio" name="cancel-polarity" checked={editing.cancellationPolarity === "negative"} onChange={() => setEditing({ ...editing, cancellationPolarity: "negative", cancelledByEffectIds: [] })} /> Negative</label></div>
                <div className="delta-effect-cancel-list">{effects.filter((effect) => effect.id !== editing.id && effect.polarity === editing.cancellationPolarity).map((effect) => <label key={effect.id}><input type="checkbox" checked={editing.cancelledByEffectIds.includes(effect.id)} onChange={(event) => setEditing({ ...editing, cancelledByEffectIds: event.target.checked ? [...editing.cancelledByEffectIds, effect.id] : editing.cancelledByEffectIds.filter((id) => id !== effect.id) })} /> {effect.name}</label>)}{!effects.some((effect) => effect.id !== editing.id && effect.polarity === editing.cancellationPolarity) && <small>No matching effects yet.</small>}</div>
              </>}
            </fieldset>
            <div className="split-actions"><button onClick={saveDraftEffect} disabled={!editing.name.trim()}><Save size={17} /> Save effect</button><button onClick={() => setEditing(undefined)}>Cancel</button></div>
          </section>
        </div>
      )}

      {iconLibraryOpen && <DeltaIconLibrary projectId={project.id} icons={icons} onIconsChange={(nextIcons) => { setIcons(nextIcons); setEffects((current) => current.map((effect) => effect.iconId && !nextIcons.some((icon) => icon.id === effect.iconId) ? { ...effect, iconId: undefined } : effect)); }} onSelect={editing ? (icon) => { setEditing({ ...editing, iconId: icon.id }); setIconLibraryOpen(false); } : undefined} onClose={() => setIconLibraryOpen(false)} />}
      {deleteEffect && <div className="modal-backdrop" onClick={() => setDeleteEffect(undefined)}><section className="confirm-modal" onClick={(event) => event.stopPropagation()}><h2>Delete effect?</h2><p>{deleteEffect.name} will be removed when you save EFFECTS.</p><div className="split-actions"><button className="danger" onClick={confirmDeleteEffect}>Delete</button><button onClick={() => setDeleteEffect(undefined)}>Cancel</button></div></section></div>}
    </section>
  );
}

async function fitGeneratedIcon(dataUrl: string) {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("The generated image could not be opened."));
    image.src = dataUrl;
  });
  const source = document.createElement("canvas");
  source.width = image.naturalWidth;
  source.height = image.naturalHeight;
  const sourceContext = source.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) throw new Error("Canvas is unavailable in this browser.");
  sourceContext.drawImage(image, 0, 0);
  const pixels = sourceContext.getImageData(0, 0, source.width, source.height).data;
  const samplePoints = [[0, 0], [source.width - 1, 0], [0, source.height - 1], [source.width - 1, source.height - 1]];
  const background = samplePoints.reduce((total, [x, y]) => {
    const index = (y * source.width + x) * 4;
    return [total[0] + pixels[index], total[1] + pixels[index + 1], total[2] + pixels[index + 2]];
  }, [0, 0, 0]).map((value) => value / samplePoints.length);
  let left = source.width;
  let top = source.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const index = (y * source.width + x) * 4;
      const difference = Math.abs(pixels[index] - background[0]) + Math.abs(pixels[index + 1] - background[1]) + Math.abs(pixels[index + 2] - background[2]);
      if (pixels[index + 3] > 20 && difference > 78) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  }
  const hasSubject = right >= left && bottom >= top;
  const subjectWidth = hasSubject ? right - left + 1 : source.width;
  const subjectHeight = hasSubject ? bottom - top + 1 : source.height;
  const paddedSide = Math.min(Math.max(source.width, source.height), Math.max(1, Math.ceil(Math.max(subjectWidth, subjectHeight) * 1.16)));
  const centerX = hasSubject ? (left + right + 1) / 2 : source.width / 2;
  const centerY = hasSubject ? (top + bottom + 1) / 2 : source.height / 2;
  const sourceX = Math.max(0, Math.min(source.width - paddedSide, Math.round(centerX - paddedSide / 2)));
  const sourceY = Math.max(0, Math.min(source.height - paddedSide, Math.round(centerY - paddedSide / 2)));
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable in this browser.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, sourceX, sourceY, paddedSide, paddedSide, 0, 0, 32, 32);
  return canvas.toDataURL("image/png");
}

function DeltaIconLibrary({ projectId, icons, onIconsChange, onSelect, onClose }: { projectId: string; icons: DeltaIconAsset[]; onIconsChange: (icons: DeltaIconAsset[]) => void; onSelect?: (icon: DeltaIconAsset) => void; onClose: () => void }) {
  const [editing, setEditing] = useState<DeltaIconAsset>();
  const [creating, setCreating] = useState(false);
  const [deleteIcon, setDeleteIcon] = useState<DeltaIconAsset>();
  const [recentIcons, setRecentIcons] = useState<string[]>([]);

  async function saveIcon(icon: DeltaIconAsset) {
    await db.deltaIcons.put(icon);
    onIconsChange([...icons.filter((item) => item.id !== icon.id), icon].sort((a, b) => a.name.localeCompare(b.name)));
    setEditing(undefined);
    setCreating(false);
  }

  async function confirmDelete() {
    if (!deleteIcon) return;
    await db.transaction("rw", [db.deltaIcons, db.deltaEffects], async () => {
      await db.deltaIcons.delete(deleteIcon.id);
      await db.deltaEffects.where("projectId").equals(projectId).filter((effect) => effect.iconId === deleteIcon.id).modify({ iconId: undefined });
    });
    onIconsChange(icons.filter((icon) => icon.id !== deleteIcon.id));
    setDeleteIcon(undefined);
  }

  return (
    <div className="modal-backdrop delta-icon-library-backdrop" onClick={onClose}>
      <section className="delta-icon-library" onClick={(event) => event.stopPropagation()}>
        <div className="section-title"><div><h2>Icon library</h2><p className="delta-icon-library-description">Reusable icons for this project’s effects.</p></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="delta-icon-grid">
          {icons.map((icon) => <div className="delta-icon-cell" key={icon.id}><button onClick={() => onSelect ? onSelect(icon) : setEditing(icon)} title={onSelect ? `Use ${icon.name}` : `Edit ${icon.name}`}><img src={icon.dataUrl} alt="" /><span>{icon.name}</span></button><button className="icon-button" onClick={() => setEditing(icon)} aria-label={`Edit ${icon.name}`}><Pencil size={14} /></button><button className="icon-button danger-icon" onClick={() => setDeleteIcon(icon)} aria-label={`Delete ${icon.name}`}><Trash2 size={14} /></button></div>)}
          {icons.length === 0 && <p className="delta-effect-empty">No saved icons.</p>}
        </div>
        <button className="delta-icon-library-create" onClick={() => setCreating(true)}><Zap size={17} /> Create icon with FLUX</button>
      </section>
      {(creating || editing) && <DeltaIconEditor projectId={projectId} icon={editing} recentIcons={recentIcons} onGenerated={(dataUrl) => setRecentIcons((current) => [dataUrl, ...current.filter((item) => item !== dataUrl)].slice(0, 3))} onSave={saveIcon} onClose={() => { setCreating(false); setEditing(undefined); }} />}
      {deleteIcon && <div className="modal-backdrop nested-confirm" onClick={() => setDeleteIcon(undefined)}><section className="confirm-modal" onClick={(event) => event.stopPropagation()}><h2>Delete icon?</h2><p>The saved icon will be removed from this project. Effects using it will keep their other settings.</p><div className="split-actions"><button className="danger" onClick={confirmDelete}>Delete</button><button onClick={() => setDeleteIcon(undefined)}>Cancel</button></div></section></div>}
    </div>
  );
}

function DeltaIconEditor({ projectId, icon, recentIcons, onGenerated, onSave, onClose }: { projectId: string; icon?: DeltaIconAsset; recentIcons: string[]; onGenerated: (dataUrl: string) => void; onSave: (icon: DeltaIconAsset) => Promise<void>; onClose: () => void }) {
  const fallbackModel = "black-forest-labs/flux.2-klein-4b";
  const [models, setModels] = useState<{ id: string; name: string }[]>([{ id: fallbackModel, name: "FLUX.2 Klein 4B (budget)" }]);
  const [model, setModel] = useState(icon?.sourceModel ?? fallbackModel);
  const [prompt, setPrompt] = useState(icon?.sourcePrompt ?? "");
  const [name, setName] = useState(icon?.name ?? "");
  const [selectedCandidate, setSelectedCandidate] = useState(icon?.dataUrl ?? "");
  const [status, setStatus] = useState("");
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    void (async () => {
      const settings = await db.settings.get("settings");
      if (!settings?.apiKey?.trim()) return;
      try {
        const response = await fetch("https://openrouter.ai/api/v1/images/models", { headers: { Authorization: `Bearer ${settings.apiKey.trim()}` } });
        if (!response.ok) return;
        const json = await response.json() as { data?: { id: string; name?: string }[] };
        const rows = (json.data ?? []).map((row) => ({ id: row.id, name: row.name ?? row.id }));
        if (rows.length) setModels(rows);
      } catch {
        // Keep the known budget model available when discovery is offline.
      }
    })();
  }, []);

  async function generate() {
    if (!prompt.trim()) return;
    const settings = await db.settings.get("settings");
    if (!settings?.apiKey?.trim()) { setStatus("Save an OpenRouter API key in API Settings first."); return; }
    setGenerating(true);
    setStatus("Generating icon...");
    try {
      const iconPrompt = `Create one isolated small game status icon: ${prompt.trim()}. The icon itself must fill 82-90% of the square canvas, with only a thin 5-8% margin. Crop tightly around the symbol. Use a simple high-contrast silhouette that remains clear at 32x32 pixels. No words, letters, numbers, captions, frames, borders, UI, or extra objects. Plain dark neutral background.`;
      const response = await fetch("https://openrouter.ai/api/v1/images", {
        method: "POST",
        headers: { Authorization: `Bearer ${settings.apiKey.trim()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt: iconPrompt, n: 1, aspect_ratio: "1:1", output_format: "png" })
      });
      if (!response.ok) throw new Error((await response.text()) || `Image request failed (${response.status}).`);
      const json = await response.json() as { data?: { b64_json?: string; media_type?: string }[] };
      const image = json.data?.[0];
      if (!image?.b64_json) throw new Error("The image model returned no image.");
      const fitted = await fitGeneratedIcon(`data:${image.media_type ?? "image/png"};base64,${image.b64_json}`);
      onGenerated(fitted);
      setSelectedCandidate(fitted);
      setStatus("Added to the temporary recent-icons tray.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Icon generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  async function save() {
    if (!selectedCandidate || !name.trim()) return;
    const timestamp = now();
    await onSave({ id: icon?.id ?? uid(), projectId, name: name.trim(), dataUrl: selectedCandidate, sourceModel: model, sourcePrompt: prompt.trim(), createdAt: icon?.createdAt ?? timestamp, updatedAt: timestamp });
  }

  const availableIcons = [...new Set([...(icon ? [icon.dataUrl] : []), ...recentIcons])];

  return (
    <div className="modal-backdrop delta-icon-editor-backdrop" onClick={onClose}>
      <section className="delta-icon-editor" onClick={(event) => event.stopPropagation()}>
        <div className="section-title"><div><h2>{icon ? "Edit icon" : "Create icon with FLUX"}</h2><p className="delta-icon-library-description">Describe one clear symbol; it will be prepared for use at 32 × 32 pixels.</p></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <label>Model<select value={model} onChange={(event) => setModel(event.target.value)}>{models.map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}</select></label>
        <label>Prompt<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe one simple status icon" /></label>
        <button onClick={generate} disabled={generating || !prompt.trim()}>{generating ? "Thinking..." : "Generate icon"}</button>
        {status && <p className="save-status">{status}</p>}
        <div className="delta-icon-candidates">{availableIcons.length > 0 && <small>Temporary recent icons</small>}<div>{availableIcons.map((candidate, index) => <button className={selectedCandidate === candidate ? "picked" : ""} key={`${candidate.slice(-20)}-${index}`} onClick={() => setSelectedCandidate(candidate)}><img src={candidate} alt={`Recent generated icon ${index + 1}`} /></button>)}</div>{selectedCandidate && <div className="delta-icon-actual-preview"><span>Actual size</span><img src={selectedCandidate} alt="Selected icon at actual size" /></div>}</div>
        <label>Name icon<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Icon name" /></label>
        <div className="split-actions"><button onClick={save} disabled={!selectedCandidate || !name.trim()}><Save size={17} /> Save icon</button><button onClick={onClose}>Cancel</button></div>
      </section>
    </div>
  );
}

function AbilityScoreEditor({ value, onChange }: { value: AbilityScores; onChange: (value: AbilityScores) => void }) {
  return (
    <div className="ability-grid">
      {abilities.map((ability) => (
        <label key={ability}>{ability}<input type="number" value={value[ability]} onChange={(event) => onChange({ ...value, [ability]: Number(event.target.value) })} /></label>
      ))}
    </div>
  );
}

function AbilityModifierEditor({ value, onChange }: { value: AbilityModifiers; onChange: (value: AbilityModifiers) => void }) {
  return (
    <div className="ability-grid compact">
      {abilities.map((ability) => (
        <label key={ability}>{ability}<input type="number" value={value[ability] ?? 0} onChange={(event) => onChange({ ...value, [ability]: Number(event.target.value) })} /></label>
      ))}
    </div>
  );
}

function DeltaPrefixEditor({ value, onChange }: { value: DeltaPrefixTemplate[]; onChange: (value: DeltaPrefixTemplate[]) => void }) {
  function update(index: number, patch: Partial<DeltaPrefixTemplate>) {
    onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }
  return (
    <div className="delta-template-list">
      {value.length === 0 && <p className="notice">No PREFIX templates are set up for this project.</p>}
      {value.map((item, index) => (
        <section className="delta-template-row" key={item.id || index}>
          <div className="form-row delta-template-fields delta-prefix-fields">
            <label>ID<input value={item.id} onChange={(event) => update(index, { id: event.target.value })} /></label>
            <label>Label<input value={item.label} onChange={(event) => update(index, { label: event.target.value.toUpperCase() })} placeholder="PREFIX" /></label>
            <button className="icon-button delta-template-delete" onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Delete ${item.label || "PREFIX"}`} title="Delete PREFIX"><Trash2 size={15} /></button>
          </div>
          <AbilityModifierEditor value={item.statModifiers} onChange={(statModifiers) => update(index, { statModifiers })} />
        </section>
      ))}
    </div>
  );
}

function DeltaBaseEditor({ value, onChange }: { value: DeltaBaseTemplate[]; onChange: (value: DeltaBaseTemplate[]) => void }) {
  function update(index: number, patch: Partial<DeltaBaseTemplate>) {
    onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }
  return (
    <div className="delta-template-list">
      {value.length === 0 && <p className="notice">No BASE templates are set up for this project.</p>}
      {value.map((item, index) => (
        <section className="delta-template-row" key={item.id || index}>
          <div className="form-row delta-template-fields delta-base-fields">
            <label>ID<input value={item.id} onChange={(event) => update(index, { id: event.target.value })} /></label>
            <label>Label<input value={item.label} onChange={(event) => update(index, { label: event.target.value.toUpperCase() })} placeholder="BASE" /></label>
            <label>HP bonus<input type="number" value={item.hpBonus ?? 0} onChange={(event) => update(index, { hpBonus: Number(event.target.value) })} /></label>
            <button className="icon-button delta-template-delete" onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Delete ${item.label || "BASE"}`} title="Delete BASE"><Trash2 size={15} /></button>
          </div>
          <AbilityModifierEditor value={item.statModifiers} onChange={(statModifiers) => update(index, { statModifiers })} />
        </section>
      ))}
    </div>
  );
}

function DeltaJobImport({ value, onChange }: { value: DeltaJobTemplate[]; onChange: (value: DeltaJobTemplate[]) => void }) {
  const [errors, setErrors] = useState<string[]>([]);
  async function importFiles(files: FileList | null) {
    const parsed = await parseJobFiles(files);
    setErrors(parsed.errors);
    if (parsed.errors.length) return;
    const replacing = new Set(parsed.categories);
    onChange([...value.filter((job) => !replacing.has(job.category)), ...parsed.jobs]);
  }
  function deleteCategory(category: string) {
    if (!confirm(`Delete JOB category "${category}" from this draft?`)) return;
    onChange(value.filter((job) => job.category !== category));
  }
  function downloadCategory(category: string) {
    const rows = value
      .filter((job) => job.category.trim() === category)
      .map((job) => `${job.label.trim()} ${abilities.map((ability) => Number(job.statModifiers[ability] ?? 0)).join(" ")}`);
    const blob = new Blob([`${rows.join("\n")}\n`], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${category.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-") || "jobs"}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  const categories = jobCategories(value);
  return (
    <div className="delta-template-list delta-job-import">
      <label className="file-pick"><Upload size={18} /> Import JOB .txt files<input type="file" accept=".txt,text/plain" multiple onChange={(event) => void importFiles(event.target.files)} /></label>
      {errors.length > 0 && (
        <div className="import-errors">
          {errors.map((error) => <p key={error}>{error}</p>)}
        </div>
      )}
      {categories.length === 0 && <p className="notice">No JOB categories are set up for this project.</p>}
      {categories.map(([category, count]) => (
        <section className="delta-category-row" key={category}>
          <button className="icon-button delta-category-download" onClick={() => downloadCategory(category)} aria-label={`Download ${category} category`} title={`Download ${category}.txt`}><Download size={15} /></button>
          <span>{category}</span>
          <small>{count} JOB{count === 1 ? "" : "S"}</small>
          <button className="icon-button delta-category-delete" onClick={() => deleteCategory(category)} aria-label={`Delete ${category} category`} title={`Delete ${category} category`}><Trash2 size={15} /></button>
        </section>
      ))}
    </div>
  );
}

function useSavedNotice() {
  const [saved, setSaved] = useState(false);
  function showSaved() {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  }
  return [saved, showSaved] as const;
}

function SettingsPage({ settings, onRefresh }: { settings: AppSettings; onRefresh: () => Promise<void> }) {
  const [draft, setDraft] = useState(settings);
  const [tab, setTab] = useState<"appearance" | "api" | "data">("appearance");
  const [saved, showSaved] = useSavedNotice();
  useEffect(() => setDraft(settings), [settings]);
  async function save() {
    await db.settings.put({ ...draft, updatedAt: now() });
    showSaved();
    await onRefresh();
  }
  return (
    <Page>
      <div className="settings-tabs">
        <button className={tab === "appearance" ? "picked" : ""} onClick={() => setTab("appearance")}><Settings size={18} /> Look</button>
        <button className={tab === "api" ? "picked" : ""} onClick={() => setTab("api")}><KeyRound size={18} /> API</button>
        <button className={tab === "data" ? "picked" : ""} onClick={() => setTab("data")}><Database size={18} /> Data</button>
      </div>
      {tab === "appearance" && (
        <>
          <Segment label="Theme" value={draft.theme} options={["onyx", "ivory", "blue", "green"]} onChange={(theme) => setDraft({ ...draft, theme })} />
          <label>Accent</label>
          <div className="swatches">{accents.map((accent) => <button key={accent.name} className={draft.accent === accent.name ? "picked" : ""} style={{ background: accent.value }} aria-label={`${accent.name} accent${draft.accent === accent.name ? " (selected)" : ""}`} aria-pressed={draft.accent === accent.name} onClick={() => setDraft({ ...draft, accent: accent.name })} />)}</div>
          <Segment label="Font" value={draft.font} options={["system", "inter", "lora", "nunito"]} onChange={(font) => setDraft({ ...draft, font })} />
          <label>Font size: {fontSizeLabel(draft.fontScale ?? 16)} ({draft.fontScale ?? 16}px)
            <input type="range" min={12} max={24} step={1} value={draft.fontScale ?? 16} onChange={(event) => setDraft({ ...draft, fontScale: Number(event.target.value) })} />
          </label>
          <div className="font-preview" data-preview-font={draft.font} style={{ fontSize: draft.fontScale }}>Jaeger opened the archive and found the thread of the story still intact.</div>
          <Segment label="Bubbles" value={draft.bubbleMode} options={["bubbles", "minimal"]} onChange={(bubbleMode) => setDraft({ ...draft, bubbleMode })} />
          <Segment label="Scope" value={draft.bubbleScope} options={["global", "project"]} onChange={(bubbleScope) => setDraft({ ...draft, bubbleScope })} />
          <label>Entry width {draft.entryWidth}%<input type="range" min={60} max={100} value={draft.entryWidth} onChange={(event) => setDraft({ ...draft, entryWidth: Number(event.target.value) })} /></label>
          <label>Message spacing {draft.messageSpacing}px<input type="range" min={4} max={28} value={draft.messageSpacing} onChange={(event) => setDraft({ ...draft, messageSpacing: Number(event.target.value) })} /></label>
          <label>Paragraph spacing {draft.paragraphSpacing ?? 4}px<input type="range" min={0} max={18} value={draft.paragraphSpacing ?? 4} onChange={(event) => setDraft({ ...draft, paragraphSpacing: Number(event.target.value) })} /></label>
          <div className="split-actions persistent-actions"><button onClick={save}><Save size={18} /> Save settings</button>{saved && <span className="save-status">Saved</span>}</div>
        </>
      )}
      {tab === "api" && <ApiSettingsContent settings={settings} onRefresh={onRefresh} />}
      {tab === "data" && <DataSettingsContent />}
    </Page>
  );
}

function ApiSettingsContent({ settings, onRefresh }: { settings: AppSettings; onRefresh: () => Promise<void> }) {
  const [key, setKey] = useState(settings.apiKey ?? "");
  const [show, setShow] = useState(false);
  const [saved, showSaved] = useSavedNotice();
  async function save() {
    await db.settings.update("settings", { apiKey: key, updatedAt: now() });
    showSaved();
    await onRefresh();
  }
  async function remove() {
    if (!confirm("Remove the saved OpenRouter API key from this browser?")) return;
    setKey("");
    await db.settings.update("settings", { apiKey: undefined, updatedAt: now() });
    await onRefresh();
  }
  return (
    <>
      <p className="notice">This static app stores the key in this browser only. Browser-only storage cannot protect a key as strongly as a private server.</p>
      <label>OpenRouter API key<input type={show ? "text" : "password"} value={key} onChange={(event) => setKey(event.target.value)} placeholder="sk-or-..." /></label>
      <div className="split-actions persistent-actions"><button onClick={() => setShow(!show)}>{show ? "Hide" : "Show"}</button><button onClick={save}><Save size={18} /> Save</button><button className="danger" onClick={remove}>Remove</button>{saved && <span className="save-status">Saved</span>}</div>
      <label>Privacy preset<select value={settings.privacyPreset} onChange={async (event) => { await db.settings.update("settings", { privacyPreset: event.target.value as AppSettings["privacyPreset"], updatedAt: now() }); await onRefresh(); }}><option value="maximum">Maximum Privacy</option><option value="balanced">Balanced</option><option value="availability">Maximum Availability</option></select></label>
      <ModelLibrary />
    </>
  );
}

function ModelLibrary() {
  const [models, setModels] = useState<{ id: string; modelId: string; cosmeticName: string }[]>([]);
  const [fetchedModels, setFetchedModels] = useState<{ id: string; name?: string; context_length?: number }[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  async function load() { setModels(await db.modelLibrary.orderBy("orderIndex").toArray()); }
  useEffect(() => { load(); }, []);
  async function fetchModels() {
    setStatus("Fetching models...");
    try {
      const response = await fetch("https://openrouter.ai/api/v1/models");
      if (!response.ok) throw new Error("Could not fetch models.");
      const json = await response.json() as { data?: { id: string; name?: string; context_length?: number }[] };
      setFetchedModels(json.data ?? []);
      setStatus(`Fetched ${(json.data ?? []).length} models`);
    } catch {
      setStatus("Model fetch failed. Check connection and try again.");
    }
  }
  async function addModel(modelId: string, name?: string, contextLength?: number) {
    if (!modelId.trim() || models.some((model) => model.modelId === modelId)) return;
    const timestamp = now();
    await db.modelLibrary.add({ id: uid(), modelId, cosmeticName: name || modelId.split("/").pop() || modelId, contextLength, orderIndex: models.length, createdAt: timestamp, updatedAt: timestamp });
    await load();
  }
  const filtered = fetchedModels.filter((model) => `${model.id} ${model.name ?? ""}`.toLowerCase().includes(query.toLowerCase())).slice(0, 40);
  return (
    <section className="panel">
      <h2>Custom Model Library</h2>
      <button onClick={fetchModels}><Download size={18} /> Fetch OpenRouter models</button>
      {status && <p className="save-status">{status}</p>}
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter fetched models" />
      {filtered.length > 0 && <div className="model-results">{filtered.map((model) => <button key={model.id} onClick={() => addModel(model.id, model.name, model.context_length)}><Plus size={16} /><span>{model.name ?? model.id}</span><small>{model.id}</small></button>)}</div>}
      {models.map((model) => <div className="mini-row" key={model.id}><span>{model.cosmeticName}</span><small>{model.modelId}</small><button className="danger" onClick={async () => { await db.modelLibrary.delete(model.id); await load(); }}><Trash2 size={16} /> Remove</button></div>)}
    </section>
  );
}

function MemoriesPage({ project }: { project?: Project }) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [pendingMemories, setPendingMemories] = useState<PendingMemory[]>([]);
  const [text, setText] = useState("");
  const [tags, setTags] = useState("");
  const [query, setQuery] = useState("");
  async function load() {
    if (project) {
      setMemories(await db.memories.where("projectId").equals(project.id).reverse().sortBy("updatedAt"));
      setPendingMemories(await db.pendingMemories.where("projectId").equals(project.id).reverse().sortBy("updatedAt"));
    }
  }
  useEffect(() => { load(); }, [project?.id]);
  if (!project) return <EmptyState title="No project selected" body="Choose a project to manage memories." />;
  const projectId = project.id;
  async function add() {
    if (!text.trim()) return;
    await createMemory(projectId, text.trim(), splitTags(tags));
    setText(""); setTags(""); await load();
  }
  async function runSearch() {
    const found = await searchMemories(projectId, splitTags(query), query);
    setMemories(await db.memories.bulkGet(found.map((item) => item.id)).then((rows) => rows.filter(Boolean) as Memory[]));
  }
  return (
    <Page>
      <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Memory text" />
      <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="tags, comma separated" />
      <button disabled={!text.trim()} onClick={add}><Plus size={18} /> Add memory</button>
      <div className="form-row"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by tag or text" /><button onClick={runSearch}><Search size={18} /></button></div>
      {pendingMemories.length > 0 && (
        <section className="panel stack">
          <div className="section-title"><h2>Pending Memories</h2><span>{pendingMemories.length}</span></div>
          {pendingMemories.map((memory) => <PendingMemoryCard key={memory.id} memory={memory} onRefresh={load} />)}
        </section>
      )}
      {memories.map((memory) => <EditableMemory key={memory.id} memory={memory} onRefresh={load} />)}
    </Page>
  );
}

function CompactionPage({ chat, onRefresh }: { chat: Chat; onRefresh: () => Promise<void> }) {
  const [draft, setDraft] = useState(chat.compactionMemory || "");
  const [saved, showSaved] = useSavedNotice();
  useEffect(() => setDraft(chat.compactionMemory || ""), [chat.id, chat.compactionMemory]);
  async function save() {
    await db.chats.update(chat.id, { compactionMemory: draft, updatedAt: now() });
    showSaved();
    await onRefresh();
  }
  return (
    <Page>
      <section className="item-card stack">
        <p className="notice">Keep this as a compact outline of major plot facts and continuity. Prefer lines like "Jaeger destroyed the company building" over minor moment-to-moment details.</p>
        <textarea className="large-entry" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="- Major plot event&#10;- Important thread consequence&#10;- Current unresolved conflict" />
        <div className="split-actions persistent-actions"><button onClick={save}><Save size={18} /> Save compaction memory</button>{saved && <span className="save-status">Saved</span>}</div>
      </section>
    </Page>
  );
}

function PendingMemoryCard({ memory, onRefresh }: { memory: PendingMemory; onRefresh: () => Promise<void> }) {
  const [draftText, setDraftText] = useState(memory.text);
  const [draftTags, setDraftTags] = useState(memory.tags.join(", "));
  const [saved, showSaved] = useSavedNotice();
  useEffect(() => {
    setDraftText(memory.text);
    setDraftTags(memory.tags.join(", "));
  }, [memory.id, memory.text, memory.tags]);
  async function saveDraft() {
    await db.pendingMemories.update(memory.id, { text: draftText, tags: splitTags(draftTags), updatedAt: now() });
    showSaved();
    await onRefresh();
  }
  async function approve() {
    await createMemory(memory.projectId, draftText, splitTags(draftTags), "approved automatic", memory.sourceMessageIds);
    await db.pendingMemories.delete(memory.id);
    await onRefresh();
  }
  async function reject() {
    if (!confirm("Reject this pending memory?")) return;
    await db.pendingMemories.delete(memory.id);
    await onRefresh();
  }
  return (
    <section className="item-card stack">
      <textarea value={draftText} onChange={(event) => setDraftText(event.target.value)} />
      <input value={draftTags} onChange={(event) => setDraftTags(event.target.value)} placeholder="tags, comma separated" />
      {memory.reason && <small>Reason: {memory.reason}</small>}
      <small>Confidence: {Math.round((memory.confidence ?? 0) * 100)}%</small>
      <div className="split-actions">
        <button onClick={approve}><Save size={18} /> Approve</button>
        <button className="save-button" onClick={saveDraft}>Save edit</button>
        <button className="danger" onClick={reject}><Trash2 size={18} /> Reject</button>
        {saved && <span className="save-status">Saved</span>}
      </div>
    </section>
  );
}

function SourceFilesPage({ project }: { project?: Project }) {
  if (!project) return <EmptyState title="No project selected" body="Choose a project to manage source files." />;
  return <Page><SourceFilesSection project={project} /></Page>;
}

function SourceFilesSection({ project }: { project: Project }) {
  const [files, setFiles] = useState<{ id: string; name: string; size: number; mimeType: string }[]>([]);
  async function load() {
    setFiles(await db.sourceFiles.where("projectId").equals(project.id).reverse().sortBy("updatedAt"));
  }
  useEffect(() => { void load(); }, [project.id]);
  const projectId = project.id;
  async function add(filesToAdd: FileList | null) {
    if (!filesToAdd?.length) return;
    const timestamp = now();
    const rows = await Promise.all(Array.from(filesToAdd).map(async (file) => ({
      id: uid(),
      projectId,
      name: file.name,
      mimeType: file.type || "text/plain",
      size: file.size,
      textContent: file.type.startsWith("text/") || file.name.endsWith(".txt") || file.name.endsWith(".md") ? await file.text() : undefined,
      createdAt: timestamp,
      updatedAt: timestamp
    })));
    await db.sourceFiles.bulkAdd(rows);
    await load();
  }
  async function remove(id: string) {
    if (!confirm("Remove this source file from the project library?")) return;
    await db.sourceFiles.delete(id);
    await load();
  }
  return (
    <section className="source-files-section stack">
      <div className="section-title"><h2>Source files</h2></div>
      <label className="file-pick"><Upload size={18} /> Upload source files<input type="file" multiple onChange={(event) => add(event.target.files)} /></label>
      {files.length === 0 && <p className="muted-pad">No source files yet.</p>}
      {files.map((file) => <section className="item-card mini-row" key={file.id}><span>{file.name}</span><small>{Math.ceil(file.size / 1024)} KB</small><button className="danger" onClick={() => remove(file.id)}><Trash2 size={16} /> Remove</button></section>)}
    </section>
  );
}

function EditableMemory({ memory, onRefresh }: { memory: Memory; onRefresh: () => Promise<void> }) {
  const [relevance, setRelevance] = useState(memory.relevance ?? 5);
  const [saved, showSaved] = useSavedNotice();
  useEffect(() => setRelevance(memory.relevance ?? 5), [memory.id, memory.relevance]);
  async function saveRelevance() {
    await db.memories.update(memory.id, { relevance, updatedAt: now() });
    showSaved();
    await onRefresh();
  }
  async function remove() {
    if (!confirm("Delete this memory?")) return;
    await db.memories.delete(memory.id);
    await onRefresh();
  }
  return (
    <section className="item-card stack">
      <p>{memory.text}</p>
      <small>{memory.visibleTags.join(", ")}</small>
      <label>Relevance {relevance}<input type="range" min={0} max={10} step={1} value={relevance} onChange={(event) => setRelevance(Number(event.target.value))} /></label>
      <div className="card-actions"><button onClick={saveRelevance}><Save size={18} /> Save relevance</button><button className="danger" onClick={remove}><Trash2 size={18} /> Delete</button>{saved && <span className="save-status">Saved</span>}</div>
    </section>
  );
}

function CharactersPage({ project, onOpenProfile }: { project?: Project; onOpenProfile: (id: string) => void }) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [draggedCharacterId, setDraggedCharacterId] = useState<string>();
  async function load() {
    if (!project) return;
    const rows = await db.characters.where("projectId").equals(project.id).toArray();
    setCharacters(rows.sort((a, b) => (a.orderIndex ?? Number.MAX_SAFE_INTEGER) - (b.orderIndex ?? Number.MAX_SAFE_INTEGER) || a.normalisedName.localeCompare(b.normalisedName)));
  }
  useEffect(() => { load(); }, [project?.id]);
  if (!project) return <EmptyState title="No project selected" body="Choose a project to manage characters." />;
  const projectId = project.id;
  async function add() {
    const timestamp = now();
    await db.characters.add({ id: uid(), projectId, name: "New Character", normalisedName: "new-character", orderIndex: characters.length, age: "", gender: "", personality: "", misc: "", bio: "", statsEnabled: false, str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8, createdAt: timestamp, updatedAt: timestamp });
    await load();
  }
  async function moveCharacter(targetId: string) {
    if (!draggedCharacterId || draggedCharacterId === targetId) return;
    const next = [...characters];
    const from = next.findIndex((character) => character.id === draggedCharacterId);
    const to = next.findIndex((character) => character.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setCharacters(next);
    const timestamp = now();
    await db.transaction("rw", db.characters, async () => {
      await Promise.all(next.map((character, orderIndex) => db.characters.update(character.id, { orderIndex, updatedAt: timestamp })));
    });
    setDraggedCharacterId(undefined);
  }
  return (
    <Page>
      <button onClick={add}><Plus size={18} /> Add character</button>
      <div className="character-gallery">
        {characters.map((character) => (
          <CharacterTile
            key={character.id}
            character={character}
            dragging={draggedCharacterId === character.id}
            onDragStart={() => setDraggedCharacterId(character.id)}
            onDrop={() => moveCharacter(character.id)}
            onOpen={() => onOpenProfile(character.id)}
          />
        ))}
      </div>
    </Page>
  );
}

function CharacterTile({ character, dragging, onDragStart, onDrop, onOpen }: { character: Character; dragging: boolean; onDragStart: () => void; onDrop: () => void; onOpen: () => void }) {
  const [imageUrl, setImageUrl] = useState<string>();
  useEffect(() => {
    db.attachments.where("[ownerType+ownerId]").equals(["character", character.id]).first().then((attachment) => {
      if (attachment) setImageUrl(URL.createObjectURL(attachment.blob));
    });
    return () => { if (imageUrl) URL.revokeObjectURL(imageUrl); };
  }, [character.id]);
  return (
    <button
      className={`character-tile ${dragging ? "dragging" : ""}`}
      draggable
      onClick={onOpen}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", character.id);
        onDragStart();
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
    >
      {imageUrl ? <img src={imageUrl} alt="" /> : <UserRound className="character-placeholder-icon" size={54} strokeWidth={1.55} />}
      <span>{character.name}</span>
    </button>
  );
}

function CharacterProfilePage({ project, characterId, onBack, onDeleted }: { project: Project; characterId: string; onBack: () => void; onDeleted: () => void }) {
  const [character, setCharacter] = useState<Character>();
  async function load() {
    const row = await db.characters.get(characterId);
    if (row?.projectId === project.id) setCharacter(row);
  }
  useEffect(() => { load(); }, [characterId, project.id]);
  if (!character) return <EmptyState title="Character not found" body="This character could not be opened in the selected project." />;
  return <Page><CharacterEditor project={project} character={character} onRefresh={load} onBack={onBack} onDeleted={onDeleted} /></Page>;
}

function CharacterEditor({ project, character, onRefresh, onBack, onDeleted }: { project: Project; character: Character; onRefresh: () => Promise<void>; onBack: () => void; onDeleted: () => void }) {
  const [draft, setDraft] = useState(character);
  const [editing, setEditing] = useState(false);
  const [attachments, setAttachments] = useState<{ id: string; url: string; mimeType: string }[]>([]);
  const [bonuses, setBonuses] = useState<CharacterBonus[]>([]);
  const [viewerIndex, setViewerIndex] = useState<number>();
  const [saved, showSaved] = useSavedNotice();
  const buildMode = characterBuildMode(draft);
  const valid = !draft.statsEnabled || (buildMode === "template" ? Boolean(draft.job) : validatePointBuy(draft) && Boolean(draft.customJobName?.trim()));
  async function loadAttachments() {
    const rows = await db.attachments.where("[ownerType+ownerId]").equals(["character", character.id]).toArray();
    setAttachments((old) => {
      old.forEach((item) => URL.revokeObjectURL(item.url));
      return rows.map((attachment) => ({ id: attachment.id, mimeType: attachment.mimeType, url: URL.createObjectURL(attachment.blob) }));
    });
  }
  async function loadBonuses() {
    setBonuses(await db.characterBonuses.where("characterId").equals(character.id).toArray());
  }
  useEffect(() => {
    setDraft(character);
    loadAttachments();
    loadBonuses();
    return () => attachments.forEach((item) => URL.revokeObjectURL(item.url));
  }, [character.id]);
  async function save() {
    const mode = characterBuildMode(draft);
    await db.characters.put({
      ...draft,
      buildMode: mode,
      jobCategory: mode === "template" ? draft.jobCategory : undefined,
      job: mode === "template" ? draft.job : undefined,
      customJobName: mode === "custom" ? draft.customJobName?.trim() : undefined,
      normalisedName: normaliseTag(draft.name),
      updatedAt: now()
    });
    setEditing(false);
    showSaved();
    await onRefresh();
  }
  async function addBonus() {
    const timestamp = now();
    await db.characterBonuses.add({ id: uid(), characterId: character.id, name: "Bonus", stat: "STR", value: 1, createdAt: timestamp, updatedAt: timestamp });
    await loadBonuses();
  }
  async function updateBonus(bonus: CharacterBonus) {
    await db.characterBonuses.put({ ...bonus, updatedAt: now() });
    await loadBonuses();
  }
  async function addImages(files: FileList | null) {
    if (!files?.length) return;
    const timestamp = now();
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
    await db.attachments.bulkAdd(imageFiles.map((file) => ({ id: uid(), ownerType: "character" as const, ownerId: character.id, mimeType: file.type, size: file.size, blob: file, createdAt: timestamp, updatedAt: timestamp })));
    await loadAttachments();
  }
  async function previewTool(division: "identity" | "bio" | "stats") {
    const result =
      division === "identity"
        ? await getCharacterIdentity(character.projectId, character.id)
        : division === "bio"
          ? await getCharacterBio(character.projectId, character.id)
          : await getCharacterStats(character.projectId, character.id);
    alert(JSON.stringify(result, null, 2));
  }
  async function removeCharacter() {
    if (!confirm(`Delete ${character.name}? This removes the character profile, attached character images, and stat bonuses.`)) return;
    await db.transaction("rw", [db.characters, db.characterBonuses, db.characterGearSlots, db.characterActionSlots, db.characterActionMacros, db.attachments], async () => {
      await db.characterBonuses.where("characterId").equals(character.id).delete();
      await db.characterGearSlots.where("characterId").equals(character.id).delete();
      const actionSlotIds = await db.characterActionSlots.where("characterId").equals(character.id).primaryKeys() as string[];
      if (actionSlotIds.length) await db.characterActionMacros.where("slotId").anyOf(actionSlotIds).delete();
      await db.characterActionSlots.where("characterId").equals(character.id).delete();
      const attachmentIds = await db.attachments.where("[ownerType+ownerId]").equals(["character", character.id]).primaryKeys();
      if (attachmentIds.length) await db.attachments.bulkDelete(attachmentIds as string[]);
      await db.characters.delete(character.id);
    });
    onDeleted();
  }
  return (
    <section className="item-card character-card">
      <div className="character-head">
        <div>
          <h2>Name: {character.name}</h2>
          <p>Identity: {character.age || "Age"}, {character.gender || "Gender"}, {character.personality || "Personality"}, {character.misc || "Misc"}</p>
        </div>
        <button onClick={() => setEditing(!editing)}><Edit3 size={18} /> {editing ? "Close" : "Edit"}</button>
      </div>
      {!editing && (
        <div className="character-display">
          <div className="character-summary-row">
            {attachments[0] && <img className="profile-side-image" src={attachments[0].url} alt="" />}
            {character.statsEnabled && <StatsDisplay project={project} character={character} bonuses={bonuses} />}
          </div>
          <p className="bio-full"><strong>Bio:</strong> {character.bio || "No bio saved yet."}</p>
          <div className="split-actions">
            <button onClick={() => previewTool("identity")}><Eye size={18} /> Identity</button>
            <button onClick={() => previewTool("bio")}><Eye size={18} /> Bio</button>
            <button onClick={() => previewTool("stats")}><Eye size={18} /> Stats</button>
          </div>
        </div>
      )}
      {editing && (
        <div className="stack edit-panel">
          <label>Name:<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <label>Identity: Age<input value={draft.age} onChange={(event) => setDraft({ ...draft, age: event.target.value })} /></label>
          <div className="paired-fields">
            <label>Identity: Gender<input value={draft.gender} onChange={(event) => setDraft({ ...draft, gender: event.target.value })} /></label>
            <label>Gear Display Body Type<select value={draft.gearBodyType ?? "type-a"} onChange={(event) => setDraft({ ...draft, gearBodyType: event.target.value as GearBodyType })}><option value="type-a">M</option><option value="type-b">F</option></select></label>
          </div>
          <label>Identity: Personality<textarea value={draft.personality} onChange={(event) => setDraft({ ...draft, personality: event.target.value })} /></label>
          <label>Identity: Misc<textarea value={draft.misc} onChange={(event) => setDraft({ ...draft, misc: event.target.value })} /></label>
          <label>Bio:<textarea className="large-entry" value={draft.bio} onChange={(event) => setDraft({ ...draft, bio: event.target.value })} /></label>
          <label className="file-pick"><ImageIcon size={18} /> Add images<input type="file" accept="image/*" multiple onChange={(event) => addImages(event.target.files)} /></label>
          <ImageStrip attachments={attachments} onOpen={setViewerIndex} />
          <label className="compact-check"><input type="checkbox" checked={draft.statsEnabled} onChange={(event) => setDraft({ ...draft, statsEnabled: event.target.checked })} /> Enable ability scores</label>
          {draft.statsEnabled && <PointBuyEditor project={project} draft={draft} bonuses={bonuses} onDraft={setDraft} />}
          <CharacterActionLibraryEditor character={character} />
          {!valid && <p className="error">{buildMode === "template" ? "Choose a JOB for template builds." : "Custom builds need a job name and must stay within 27 points, with base scores from 8 to 15."}</p>}
          <div className="split-actions persistent-actions"><button disabled={!valid} onClick={save}><Save size={18} /> Save</button><button onClick={() => setEditing(false)}>Cancel</button>{saved && <span className="save-status">Saved</span>}</div>
        </div>
      )}
      {viewerIndex !== undefined && <ImageViewer attachments={attachments} index={viewerIndex} onChange={setViewerIndex} onClose={() => setViewerIndex(undefined)} />}
      <div className="character-back-row">
        <button onClick={onBack}><ChevronLeft size={18} /> Back to characters</button>
      </div>
      <div className="character-delete-row">
        <button className="danger" onClick={removeCharacter}><Trash2 size={18} /> Delete character</button>
      </div>
    </section>
  );
}

function CharacterActionLibraryEditor({ character }: { character: Character }) {
  const [slots, setSlots] = useState<CharacterActionSlot[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [macros, setMacros] = useState<CharacterActionMacro[]>([]);
  const [macroDraft, setMacroDraft] = useState<{
    macro?: CharacterActionMacro;
    parentId?: string;
    folder: boolean;
    label: string;
    template: string;
    requestEntitySelection: boolean;
  }>();
  async function load(preferredSlotId = selectedSlotId) {
    const timestamp = now();
    let nextSlots = (await db.characterActionSlots.where("characterId").equals(character.id).toArray()).sort((a, b) => a.orderIndex - b.orderIndex);
    if (!nextSlots.length) {
      const slot: CharacterActionSlot = { id: uid(), characterId: character.id, orderIndex: 0, createdAt: timestamp, updatedAt: timestamp };
      await db.characterActionSlots.add(slot);
      nextSlots = [slot];
    }
    const slotId = nextSlots.some((slot) => slot.id === preferredSlotId) ? preferredSlotId : nextSlots[0].id;
    const nextMacros = await db.characterActionMacros.where("slotId").equals(slotId).toArray();
    setSlots(nextSlots);
    setSelectedSlotId(slotId);
    setMacros(nextMacros.sort((a, b) => a.orderIndex - b.orderIndex));
  }
  useEffect(() => { void load(""); }, [character.id]);
  function slotName(slot: CharacterActionSlot, index = slots.findIndex((item) => item.id === slot.id)) {
    return slot.name?.trim() || String(index + 1);
  }
  async function addSlot() {
    const timestamp = now();
    const slot: CharacterActionSlot = { id: uid(), characterId: character.id, orderIndex: slots.length, createdAt: timestamp, updatedAt: timestamp };
    await db.characterActionSlots.add(slot);
    await load(slot.id);
  }
  async function renameSlot(name: string) {
    if (!selectedSlotId) return;
    await db.characterActionSlots.update(selectedSlotId, { name: name.trim() || undefined, updatedAt: now() });
    await load(selectedSlotId);
  }
  function addMacro(parentId: string | undefined, folder: boolean) {
    if (!selectedSlotId) return;
    setMacroDraft({ parentId, folder, label: "", template: "", requestEntitySelection: false });
  }
  function editMacro(macro: CharacterActionMacro) {
    setMacroDraft({
      macro,
      parentId: macro.parentId,
      folder: macro.template === undefined,
      label: macro.label,
      template: macro.template ?? "",
      requestEntitySelection: macro.requestEntitySelection ?? false
    });
  }
  async function saveMacroDraft() {
    if (!macroDraft || !selectedSlotId) return;
    const label = macroDraft.label.trim();
    if (!label) return;
    const timestamp = now();
    if (macroDraft.macro) {
      await db.characterActionMacros.update(macroDraft.macro.id, {
        label,
        template: macroDraft.folder ? undefined : macroDraft.template,
        requestEntitySelection: macroDraft.folder ? false : macroDraft.requestEntitySelection,
        updatedAt: timestamp
      });
    } else {
      const siblings = macros.filter((macro) => macro.parentId === macroDraft.parentId);
      await db.characterActionMacros.add({
        id: uid(),
        slotId: selectedSlotId,
        parentId: macroDraft.parentId,
        label,
        template: macroDraft.folder ? undefined : macroDraft.template,
        requestEntitySelection: macroDraft.folder ? false : macroDraft.requestEntitySelection,
        orderIndex: Math.max(-1, ...siblings.map((macro) => macro.orderIndex)) + 1,
        createdAt: timestamp,
        updatedAt: timestamp
      });
    }
    setMacroDraft(undefined);
    await load(selectedSlotId);
  }
  async function deleteMacro(macro: CharacterActionMacro) {
    if (!confirm(`Delete "${macro.label}" and anything inside it?`)) return;
    const ids = new Set<string>([macro.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const item of macros) {
        if (item.parentId && ids.has(item.parentId) && !ids.has(item.id)) {
          ids.add(item.id);
          grew = true;
        }
      }
    }
    await db.characterActionMacros.bulkDelete(Array.from(ids));
    await load(selectedSlotId);
  }
  return (
    <section className="character-action-editor">
      <div className="section-title">
        <h2>Actions</h2>
        <div className="split-actions">
          <button type="button" onClick={addSlot}>+ Slot</button>
          <button type="button" onClick={() => addMacro(undefined, true)}>+ Menu</button>
          <button type="button" onClick={() => addMacro(undefined, false)}>+ Action</button>
        </div>
      </div>
      <div className="action-library-controls">
        <label>Save slot
          <select value={selectedSlotId} onChange={(event) => void load(event.target.value)}>
            {slots.map((slot, index) => <option key={slot.id} value={slot.id}>{slotName(slot, index)}</option>)}
          </select>
        </label>
        {selectedSlotId && (
          <label>Slot name
            <input value={slots.find((slot) => slot.id === selectedSlotId)?.name ?? ""} onChange={(event) => void renameSlot(event.target.value)} placeholder={slots.find((slot) => slot.id === selectedSlotId) ? slotName(slots.find((slot) => slot.id === selectedSlotId)!) : "Slot name"} />
          </label>
        )}
      </div>
      {macros.length === 0 && <p className="notice">Create nested action menus for this character. Delta will use the selected character's action slots.</p>}
      <DeltaActionTree macros={macros} parentId={undefined} editMode onChoose={() => undefined} onAdd={addMacro} onEdit={editMacro} onDelete={deleteMacro} />
      {macroDraft && (
        <div className="modal-backdrop" onClick={() => setMacroDraft(undefined)}>
          <section className="modal macro-editor" onClick={(event) => event.stopPropagation()}>
            <div className="section-title">
              <h2>{macroDraft.macro ? "Edit Action" : macroDraft.folder ? "New Menu" : "New Action"}</h2>
              <button className="icon-button" onClick={() => setMacroDraft(undefined)} aria-label="Close action editor"><X size={18} /></button>
            </div>
            <label>Name<input value={macroDraft.label} onChange={(event) => setMacroDraft({ ...macroDraft, label: event.target.value })} /></label>
            {!macroDraft.folder && (
              <>
                <label>Text template<textarea value={macroDraft.template} onChange={(event) => setMacroDraft({ ...macroDraft, template: event.target.value })} rows={4} placeholder="Halle uses basic attack on {target}" /></label>
                <label className="compact-check"><input type="checkbox" checked={macroDraft.requestEntitySelection} onChange={(event) => setMacroDraft({ ...macroDraft, requestEntitySelection: event.target.checked })} /> Ask me to choose one or more targets before inserting</label>
              </>
            )}
            <div className="split-actions">
              <button onClick={saveMacroDraft}><Save size={18} /> Save</button>
              <button onClick={() => setMacroDraft(undefined)}>Cancel</button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function characterTemplateBonus(project: Project, character: Character) {
  const templateBuild = characterBuildMode(character) === "template";
  const defaultStats = project.deltaDefaultNpcStats ?? defaultDeltaNpcStats();
  const generated = generatedDeltaStats(project, {
    prefix: character.prefix,
    base: character.base,
    job: templateBuild ? character.job : undefined,
    jobCategory: templateBuild ? character.jobCategory : undefined
  });
  return {
    generated,
    bonus: abilities.reduce((scores, ability) => ({ ...scores, [ability]: generated.scores[ability] - defaultStats[ability] }), {} as AbilityScores)
  };
}

function characterBuildMode(character: Character) {
  return character.buildMode ?? (character.job ? "template" : "custom");
}

function characterBuildTag(character: Character, generatedTag?: string) {
  if (characterBuildMode(character) !== "custom") return generatedTag;
  const customJob = character.customJobName?.trim();
  return formatDeltaTemplateTag(character.prefix, character.base, customJob) || customJob;
}

function signedBonus(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function scoreModifier(score: number) {
  return Math.floor((score - 10) / 2);
}

function modifierLabel(score: number) {
  return `(${signedBonus(scoreModifier(score))})`;
}

const abilityHints: Record<Ability, string> = {
  STR: "force, carrying, melee",
  DEX: "aim, reflex, stealth",
  CON: "stamina, injury, HP",
  INT: "logic, tech, recall",
  WIS: "sense, focus, instinct",
  CHA: "presence, charm, nerve"
};

function templateOptionLabel(label: string, statModifiers: AbilityModifiers = {}, hpBonus = 0) {
  const bonuses = abilities
    .map((ability) => {
      const value = statModifiers[ability] ?? 0;
      return value === 0 ? "" : `${signedBonus(value)} ${ability}`;
    })
    .filter(Boolean);
  if (hpBonus !== 0) bonuses.push(`${signedBonus(hpBonus)} HP`);
  return bonuses.length > 0 ? `${label} (${bonuses.join(", ")})` : label;
}

function StatsDisplay({ project, character, bonuses }: { project: Project; character: Character; bonuses: CharacterBonus[] }) {
  const template = characterTemplateBonus(project, character);
  const templateBuild = characterBuildMode(character) === "template";
  const buildTag = characterBuildTag(character, template.generated.templateTag);
  const defaultStats = project.deltaDefaultNpcStats ?? defaultDeltaNpcStats();
  const conBonus = bonuses.filter((item) => item.stat === "CON").reduce((sum, item) => sum + item.value, 0);
  const totalCon = (templateBuild ? defaultStats.CON : character.con) + template.bonus.CON + conBonus;
  const totalHp = Math.max(1, 10 + scoreModifier(totalCon) + template.generated.hpBonus);
  return <div className="stat-display">{abilities.map((ability) => {
    const key = ability.toLowerCase() as "str" | "dex" | "con" | "int" | "wis" | "cha";
    const legacyBonus = bonuses.filter((item) => item.stat === ability).reduce((sum, item) => sum + item.value, 0);
    const total = (templateBuild ? defaultStats[ability] : character[key]) + template.bonus[ability] + legacyBonus;
    return <span key={ability}>{ability} {total} <small>{modifierLabel(total)}</small></span>;
  })}<span className="character-hp-display">HP {totalHp} <HpSquares current={totalHp} max={totalHp} character /></span>{buildTag && <small className="delta-template-tag">{buildTag}</small>}</div>;
}

function PointBuyEditor({ project, draft, bonuses, onDraft }: { project: Project; draft: Character; bonuses: CharacterBonus[]; onDraft: (character: Character) => void }) {
  const buildMode = characterBuildMode(draft);
  const templateBuild = buildMode === "template";
  const pointCost = abilities.reduce((sum, ability) => {
    const key = ability.toLowerCase() as "str" | "dex" | "con" | "int" | "wis" | "cha";
    const costs: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
    return sum + costs[draft[key]];
  }, 0);
  const template = characterTemplateBonus(project, draft);
  const categories = jobCategories(project.deltaJobs ?? []);
  const jobsForCategory = (project.deltaJobs ?? []).filter((job) => job.category === draft.jobCategory);
  const defaultStats = project.deltaDefaultNpcStats ?? defaultDeltaNpcStats();
  const legacyConBonus = bonuses.filter((item) => item.stat === "CON").reduce((sum, item) => sum + item.value, 0);
  const totalCon = (templateBuild ? defaultStats.CON : draft.con) + template.bonus.CON + legacyConBonus;
  const baseHp = Math.max(1, 10 + scoreModifier(totalCon));
  const tagHpBonus = template.generated.hpBonus;
  const totalHp = Math.max(1, baseHp + tagHpBonus);
  const buildTag = characterBuildTag(draft, template.generated.templateTag);
  const statRows = abilities.map((ability) => {
    const key = ability.toLowerCase() as "str" | "dex" | "con" | "int" | "wis" | "cha";
    const base = templateBuild ? defaultStats[ability] : draft[key];
    const legacyBonus = bonuses.filter((item) => item.stat === ability).reduce((sum, item) => sum + item.value, 0);
    const bonus = template.bonus[ability] + legacyBonus;
    const total = base + bonus;
    return { ability, key, base, bonus, total };
  });
  const statScale = Math.max(20, ...statRows.map((row) => Math.max(row.base, row.total)));
  return (
    <div className="point-buy">
      <div className="mini-row">
        <strong>{templateBuild ? "Template build" : `${pointCost} / 27 spent`}</strong>
        {buildTag && <small className="delta-template-tag">{buildTag}</small>}
      </div>
      <div className="build-mode-row">
        <button className={templateBuild ? "active" : ""} onClick={() => onDraft({ ...draft, buildMode: "template", customJobName: undefined })}>Template</button>
        <button className={!templateBuild ? "active" : ""} onClick={() => onDraft({ ...draft, buildMode: "custom", jobCategory: undefined, job: undefined })}>Custom</button>
      </div>
      <div className="template-select-grid">
        <label>PREFIX
          <select value={draft.prefix ?? ""} onChange={(event) => onDraft({ ...draft, prefix: event.target.value || undefined })}>
            <option value="">None</option>
            {effectiveDeltaPrefixes(project.deltaPrefixes).map((prefix) => <option key={prefix.id} value={prefix.label}>{templateOptionLabel(prefix.label, prefix.statModifiers)}</option>)}
          </select>
        </label>
        <label>BASE
          <select value={draft.base ?? ""} onChange={(event) => onDraft({ ...draft, base: event.target.value || undefined })}>
            <option value="">None</option>
            {effectiveDeltaBases(project.deltaBases).map((base) => <option key={base.id} value={base.label}>{templateOptionLabel(base.label, base.statModifiers, base.hpBonus ?? 0)}</option>)}
          </select>
        </label>
        {templateBuild ? (
          <>
            <label>JOB category
              <select value={draft.jobCategory ?? ""} onChange={(event) => onDraft({ ...draft, jobCategory: event.target.value || undefined, job: undefined })}>
                <option value="">None</option>
                {categories.map(([category]) => <option key={category} value={category}>{category}</option>)}
              </select>
            </label>
            <label>JOB
              <select value={draft.job ?? ""} onChange={(event) => onDraft({ ...draft, job: event.target.value || undefined })} disabled={!draft.jobCategory}>
                <option value="">None</option>
                {jobsForCategory.map((job) => <option key={job.id} value={job.label}>{templateOptionLabel(job.label, job.statModifiers)}</option>)}
              </select>
            </label>
          </>
        ) : (
          <label className="template-select-wide">JOB name
            <input value={draft.customJobName ?? ""} onChange={(event) => onDraft({ ...draft, customJobName: event.target.value })} placeholder="Name this build" />
          </label>
        )}
      </div>
      <div className={`hp-summary ${tagHpBonus < 0 ? "negative" : ""}`}>
        <div className="hp-summary-head">
          <span>HP</span>
          <strong>{totalHp} <small>({signedBonus(tagHpBonus)})</small></strong>
        </div>
        <HpSquares current={totalHp} max={totalHp} character />
        <div className="hp-summary-foot"><span>{baseHp} {signedBonus(tagHpBonus)} = {totalHp}</span></div>
      </div>
      {statRows.map(({ ability, key, base, bonus, total }) => {
        const baseWidth = (Math.max(0, bonus < 0 ? total : base) / statScale) * 100;
        const bonusWidth = (Math.abs(bonus) / statScale) * 100;
        return (
          <div className="stat-bar-row" key={ability}>
            <span className="stat-label"><strong>{ability}</strong></span>
            <button disabled={templateBuild || base <= 8} onClick={() => onDraft({ ...draft, [key]: base - 1 })}>-</button>
            <div className="stat-bar-cell">
              <div className={`stat-bar ${bonus < 0 ? "negative" : ""}`}><i style={{ width: `${baseWidth}%` }} />{bonus !== 0 && <b style={{ width: `${bonusWidth}%` }} />}</div>
              <small>{abilityHints[ability]}</small>
            </div>
            <button disabled={templateBuild || base >= 15} onClick={() => onDraft({ ...draft, [key]: base + 1 })}>+</button>
            <strong>{total} <small>{modifierLabel(total)}</small></strong>
          </div>
        );
      })}
      {bonuses.length > 0 && <p className="notice">Legacy custom bonuses are still included in totals, but new stat bonuses come from PREFIX / BASE / JOB tags.</p>}
    </div>
  );
}

function ImageStrip({ attachments, onOpen }: { attachments: { id: string; url: string; mimeType: string }[]; onOpen: (index: number) => void }) {
  if (attachments.length === 0) return <p className="muted-pad">No images attached.</p>;
  return <div className="thumb-strip">{attachments.map((attachment, index) => <button key={attachment.id} onClick={() => onOpen(index)} aria-label="Open image"><img src={attachment.url} alt="" /></button>)}</div>;
}

function ImageViewer({ attachments, index, onChange, onClose }: { attachments: { id: string; url: string }[]; index: number; onChange: (index: number) => void; onClose: () => void }) {
  const active = attachments[index];
  if (!active) return null;
  return (
    <div className="image-viewer" onClick={onClose}>
      <img className="image-full" src={active.url} alt="" />
      <div className="viewer-thumbs" onClick={(event) => event.stopPropagation()}>
        {attachments.map((attachment, nextIndex) => <button className={nextIndex === index ? "picked" : ""} key={attachment.id} onClick={() => onChange(nextIndex)}><img src={attachment.url} alt="" /></button>)}
      </div>
    </div>
  );
}

function ArchivesPage({ project }: { project?: Project }) {
  const [archives, setArchives] = useState<{ id: string; name: string; updatedAt: number }[]>([]);
  async function load() { if (project) setArchives(await db.archives.where("projectId").equals(project.id).reverse().sortBy("updatedAt")); }
  useEffect(() => { load(); }, [project?.id]);
  if (!project) return <EmptyState title="No project selected" body="Choose a project to manage Archives." />;
  const projectId = project.id;
  async function add() {
    const timestamp = now();
    await db.archives.add({ id: uid(), projectId, name: "New Archive", createdAt: timestamp, updatedAt: timestamp });
    await load();
  }
  return <Page><button onClick={add}><Plus size={18} /> Add Archive</button>{archives.map((archive) => <ArchiveEditor key={archive.id} archiveId={archive.id} name={archive.name} onRefresh={load} />)}</Page>;
}

function ArchiveEditor({ archiveId, name, onRefresh }: { archiveId: string; name: string; onRefresh: () => Promise<void> }) {
  const [entries, setEntries] = useState<{ id: string; header: string; body: string; orderIndex: number }[]>([]);
  const [index, setIndex] = useState(0);
  const [viewAll, setViewAll] = useState(false);
  const entry = entries[index];
  async function load() { setEntries(await db.archiveEntries.where("archiveId").equals(archiveId).sortBy("orderIndex")); }
  useEffect(() => { load(); }, [archiveId]);
  async function addEntry() {
    const timestamp = now();
    await db.archiveEntries.add({ id: uid(), archiveId, header: "Entry", body: "", orderIndex: entries.length, createdAt: timestamp, updatedAt: timestamp });
    await db.archives.update(archiveId, { updatedAt: timestamp });
    await load();
  }
  async function saveEntry(next: typeof entry) {
    if (!next) return;
    await db.archiveEntries.update(next.id, { header: next.header, body: next.body, updatedAt: now() });
    await onRefresh(); await load();
  }
  return (
    <section className="item-card stack">
      <div className="section-title"><h2>{name}</h2><button className="link-button" onClick={() => setViewAll(!viewAll)}>{viewAll ? "Paged" : "View all"}</button></div>
      {!viewAll && <div className="pager"><button disabled={index === 0} onClick={() => setIndex(index - 1)}><ChevronLeft size={18} /></button><span>{entries.length ? index + 1 : 0} / {entries.length}</span><button disabled={index >= entries.length - 1} onClick={() => setIndex(index + 1)}><ChevronRight size={18} /></button></div>}
      {viewAll ? entries.map((nextEntry) => <ArchiveEntryForm key={nextEntry.id} entry={nextEntry} onSave={saveEntry} />) : entry ? <ArchiveEntryForm entry={entry} onSave={saveEntry} /> : <p className="muted-pad">No entries yet.</p>}
      <button onClick={addEntry}><Plus size={18} /> Add entry</button>
    </section>
  );
}

function ArchiveEntryForm({ entry, onSave }: { entry: { id: string; header: string; body: string; orderIndex: number }; onSave: (entry: { id: string; header: string; body: string; orderIndex: number }) => void }) {
  const [draft, setDraft] = useState(entry);
  const [editing, setEditing] = useState(false);
  const [active, setActive] = useState(false);
  const [attachments, setAttachments] = useState<{ id: string; url: string; mimeType: string }[]>([]);
  const [viewerIndex, setViewerIndex] = useState<number>();
  const [saved, showSaved] = useSavedNotice();
  const entryRef = useRef<HTMLDivElement>(null);
  useEffect(() => setDraft(entry), [entry]);
  async function loadAttachments() {
    const rows = await db.attachments.where("[ownerType+ownerId]").equals(["archiveEntry", entry.id]).toArray();
    setAttachments((old) => {
      old.forEach((item) => URL.revokeObjectURL(item.url));
      return rows.map((attachment) => ({ id: attachment.id, mimeType: attachment.mimeType, url: URL.createObjectURL(attachment.blob) }));
    });
  }
  useEffect(() => {
    loadAttachments();
    return () => attachments.forEach((item) => URL.revokeObjectURL(item.url));
  }, [entry.id]);
  useEffect(() => {
    function closeWhenOutside(event: PointerEvent) {
      if (!entryRef.current?.contains(event.target as Node)) setActive(false);
    }
    document.addEventListener("pointerdown", closeWhenOutside);
    return () => document.removeEventListener("pointerdown", closeWhenOutside);
  }, []);
  async function addImages(files: FileList | null) {
    if (!files?.length) return;
    const timestamp = now();
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
    await db.attachments.bulkAdd(imageFiles.map((file) => ({ id: uid(), ownerType: "archiveEntry" as const, ownerId: entry.id, mimeType: file.type, size: file.size, blob: file, createdAt: timestamp, updatedAt: timestamp })));
    await loadAttachments();
  }
  async function save() {
    await onSave(draft);
    setEditing(false);
    showSaved();
  }
  return (
    <div className="stack archive-entry" ref={entryRef} onClick={() => setActive(true)}>
      {!editing && (
        <>
          <div className="character-head"><h2>{entry.header}</h2>{active && <button onClick={() => setEditing(true)}><Edit3 size={18} /> Edit</button>}</div>
          <div className="archive-preview-wrap">
            {attachments[0] && (
              <div className="archive-media-column">
                <button className="archive-main-image" onClick={() => setViewerIndex(0)}><img src={attachments[0].url} alt="" /></button>
                {attachments.length > 1 && <ImageStrip attachments={attachments.slice(1)} onOpen={(nextIndex) => setViewerIndex(nextIndex + 1)} />}
              </div>
            )}
            <div className="entry-body"><MarkdownText text={entry.body} emptyText="No entry text yet." /></div>
          </div>
        </>
      )}
      {editing && (
        <>
          <input value={draft.header} onChange={(event) => setDraft({ ...draft, header: event.target.value })} />
          <textarea className="large-entry" value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} />
          <label className="file-pick"><ImageIcon size={18} /> Add images<input type="file" accept="image/*" multiple onChange={(event) => addImages(event.target.files)} /></label>
          <ImageStrip attachments={attachments} onOpen={setViewerIndex} />
          <div className="split-actions"><button onClick={save}><Save size={18} /> Save entry</button><button onClick={() => setEditing(false)}>Cancel</button>{saved && <span className="save-status">Saved</span>}</div>
        </>
      )}
      {viewerIndex !== undefined && <ImageViewer attachments={attachments} index={viewerIndex} onChange={setViewerIndex} onClose={() => setViewerIndex(undefined)} />}
    </div>
  );
}

function StarsPage({ project }: { project?: Project }) {
  const [stars, setStars] = useState<{ id: string; role: string; bodyCopy: string; updatedAt: number }[]>([]);
  const [openStar, setOpenStar] = useState<{ id: string; role: string; bodyCopy: string; updatedAt: number }>();
  async function load() {
    if (project) setStars(await db.stars.where("projectId").equals(project.id).reverse().sortBy("updatedAt"));
  }
  useEffect(() => { load(); }, [project?.id]);
  if (!project) return <EmptyState title="No project selected" body="Choose a project to view stars." />;
  async function removeStar(starId: string) {
    if (!confirm("Remove this message from Stars?")) return;
    const star = await db.stars.get(starId);
    await db.transaction("rw", db.stars, db.messages, async () => {
      await db.stars.delete(starId);
      if (star) await db.messages.update(star.messageId, { starred: false, updatedAt: now() });
    });
    setOpenStar(undefined);
    await load();
  }
  return (
    <Page>
      {stars.length === 0 && <EmptyState title="No stars yet" body="Star chat messages to collect them here." />}
      {stars.map((star) => <button className="star-card" key={star.id} onClick={() => setOpenStar(star)}><small>{star.role} - {formatDate(star.updatedAt)}</small><p>{star.bodyCopy}</p></button>)}
      {openStar && <div className="modal-backdrop" onClick={() => setOpenStar(undefined)}><section className="star-modal" onClick={(event) => event.stopPropagation()}><small>{openStar.role} - {formatDate(openStar.updatedAt)}</small><p>{openStar.bodyCopy}</p><div className="split-actions"><button onClick={() => setOpenStar(undefined)}>Close</button><button className="danger" onClick={() => removeStar(openStar.id)}><Trash2 size={18} /> Delete star</button></div></section></div>}
    </Page>
  );
}

function DataSettingsContent() {
  const [importStatus, setImportStatus] = useState("");
  const [auditStorage, setAuditStorage] = useState({ bytes: 0, messages: 0 });
  const [auditClearStep, setAuditClearStep] = useState<1 | 2>();
  const [auditStatus, setAuditStatus] = useState("");
  const [recoverySnapshots, setRecoverySnapshots] = useState<RecoverySnapshot[]>([]);
  const [recoveryStatus, setRecoveryStatus] = useState("");
  async function loadAuditStorage() {
    const messages = await db.messages.filter((message) => Boolean(message.requestInfo?.audit)).toArray();
    const bytes = messages.reduce((total, message) => total + new Blob([JSON.stringify(message.requestInfo?.audit)]).size, 0);
    setAuditStorage({ bytes, messages: messages.length });
  }
  async function loadRecoverySnapshots() {
    setRecoverySnapshots(await listRecoverySnapshots());
  }
  useEffect(() => {
    void loadAuditStorage();
    void loadRecoverySnapshots();
    window.addEventListener("mirror:recovery-snapshot", loadRecoverySnapshots);
    return () => window.removeEventListener("mirror:recovery-snapshot", loadRecoverySnapshots);
  }, []);
  async function downloadFullBackup() {
    if (!confirm("Generate a complete portable backup of all Mirror data except the API key?")) return;
    try {
      downloadJson("mirror-full-backup.json", await createFullBackup());
      setImportStatus("Full backup downloaded.");
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : "Backup failed.");
    }
  }
  async function readBackup(file: File | undefined) {
    if (!file) return;
    try {
      return await parseAndValidateBackup(await file.text());
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : "Import failed.");
      return undefined;
    }
  }
  function backupSummary(backup: { createdAt: string; tableCounts: Record<string, number> }) {
    const total = Object.values(backup.tableCounts).reduce((sum, count) => sum + count, 0);
    return `${formatDate(new Date(backup.createdAt).getTime())}; ${total} records across ${Object.keys(backup.tableCounts).length} tables.`;
  }
  async function mergeImport(file: File | undefined) {
    const backup = await readBackup(file);
    if (!backup) return;
    if (!confirm(`Merge this full backup into the current data? Existing records with matching IDs will be updated; records not in the backup will remain.\n\n${backupSummary(backup)}`)) return;
    try {
      await mergeFullBackup(backup);
      setImportStatus("Merge import complete.");
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : "Merge import failed.");
    }
  }
  async function fullRestore(file: File | undefined) {
    const backup = await readBackup(file);
    if (!backup) return;
    if (!confirm(`FULL RESTORE replaces all current Mirror data with this backup. The API key is not included in backups and will be removed. Continue?\n\n${backupSummary(backup)}`)) return;
    try {
      await replaceWithFullBackup(backup);
      setImportStatus("Full restore verified. Reloading…");
      location.reload();
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : "Full restore failed; current data was left unchanged.");
    }
  }
  async function createRecovery() {
    try {
      const snapshot = await createRecoverySnapshot();
      setRecoveryStatus(`Backup ${snapshot.slot} created and verified.`);
      await loadRecoverySnapshots();
    } catch (error) {
      setRecoveryStatus(error instanceof Error ? error.message : "Recovery backup failed.");
    }
  }
  async function restoreRecovery(slot: RecoverySlot) {
    if (!confirm(`Restore Backup ${slot}? This replaces all current Mirror data. The API key is not part of recovery snapshots and will be removed.`)) return;
    try {
      await restoreRecoverySnapshot(slot);
      setRecoveryStatus(`Backup ${slot} restored and verified. Reloading…`);
      location.reload();
    } catch (error) {
      setRecoveryStatus(error instanceof Error ? error.message : "Recovery restore failed; current data was left unchanged.");
    }
  }
  async function clearAll() {
    if (!confirm("Back up first if you need this data. Continue to clear all local Mirror data?")) return;
    if (prompt("Type DELETE MIRROR DATA to permanently clear local data.") !== "DELETE MIRROR DATA") return;
    await db.delete();
    location.reload();
  }
  async function clearAudits() {
    await db.messages.filter((message) => Boolean(message.requestInfo?.audit)).modify((message) => {
      if (!message.requestInfo) return;
      const { audit: _audit, ...requestInfo } = message.requestInfo;
      message.requestInfo = requestInfo;
    });
    setAuditClearStep(undefined);
    setAuditStatus("Response audits cleared.");
    await loadAuditStorage();
  }
  return <>
    <section className="panel stack audit-storage-panel">
      <div className="section-title"><h2>Response Audit Storage</h2><span>{formatByteSize(auditStorage.bytes)}</span></div>
      <p className="notice">{auditStorage.messages ? `${auditStorage.messages} assistant response${auditStorage.messages === 1 ? "" : "s"} currently retain an audit.` : "No response audits are stored yet."}</p>
      <div className="split-actions"><button className="danger" disabled={!auditStorage.messages} onClick={() => setAuditClearStep(1)}><Trash2 size={17} /> Clear response audits</button>{auditStatus && <span className="save-status">{auditStatus}</span>}</div>
    </section>
    <section className="panel stack">
      <div className="section-title"><h2>Portable Full Backup</h2></div>
      <p className="notice">Exports every current Mirror table, including attachments, but excludes the API key. Keep the downloaded file outside Chrome for protection against browser storage loss.</p>
      <div className="split-actions"><button onClick={downloadFullBackup}><Download size={18} /> Download Full Backup</button><label className="file-pick"><Upload size={18} /> Merge Import<input type="file" accept="application/json" onChange={(event) => void mergeImport(event.target.files?.[0])} /></label><label className="file-pick danger"><Upload size={18} /> Full Restore<input type="file" accept="application/json" onChange={(event) => void fullRestore(event.target.files?.[0])} /></label></div>
      {importStatus && <p className="save-status">{importStatus}</p>}
    </section>
    <section className="panel stack">
      <div className="section-title"><h2>Local Recovery Backups</h2><button onClick={() => void createRecovery()}><Save size={18} /> Create snapshot</button></div>
      <p className="notice">Mirror keeps only Backup A and Backup B in a separate local database. They protect against app-level data damage, not Chrome clearing this site’s storage.</p>
      {(["A", "B"] as RecoverySlot[]).map((slot) => {
        const snapshot = recoverySnapshots.find((item) => item.slot === slot);
        const newest = snapshot && recoverySnapshots.every((item) => item.slot === slot || item.createdAt <= snapshot.createdAt);
        return <div className="mini-row" key={slot}><strong>Backup {slot}</strong><small>{snapshot ? `${formatDate(new Date(snapshot.createdAt).getTime())}${newest ? " — newest" : ""}` : "Not created yet"}</small>{snapshot && <button className="danger" onClick={() => void restoreRecovery(slot)}>Restore {slot}</button>}</div>;
      })}
      {recoveryStatus && <p className="save-status">{recoveryStatus}</p>}
    </section>
    <button className="danger separated" onClick={clearAll}><Trash2 size={18} /> Clear All</button>
    {auditClearStep && <div className="modal-backdrop confirm-backdrop" onClick={() => setAuditClearStep(undefined)}><section className="confirm-modal" onClick={(event) => event.stopPropagation()}><div className="section-title"><h2>{auditClearStep === 1 ? "Clear response audits?" : "Clear them permanently?"}</h2><button className="icon-button" onClick={() => setAuditClearStep(undefined)} aria-label="Cancel"><X size={18} /></button></div>{auditClearStep === 1 ? <p>This removes {formatByteSize(auditStorage.bytes)} of stored audit snapshots from {auditStorage.messages} assistant response{auditStorage.messages === 1 ? "" : "s"}. Messages, tool results, memories, inventory updates, and all other data stay intact.</p> : <p>This is the final confirmation. The audit details cannot be recovered unless they exist in a backup.</p>}<div className="split-actions">{auditClearStep === 1 ? <button className="danger" onClick={() => setAuditClearStep(2)}>Continue</button> : <button className="danger" onClick={() => void clearAudits()}><Trash2 size={17} /> Clear audits</button>}<button onClick={() => setAuditClearStep(undefined)}>Cancel</button></div></section></div>}
  </>;
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function Segment<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: T[]; onChange: (value: T) => void }) {
  return <label>{label}<div className="segment">{options.map((option) => <button key={option} className={option === value ? "picked" : ""} onClick={() => onChange(option)}>{option}</button>)}</div></label>;
}

function ColorSwatches({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const colors = ["#a7d8c4", "#c2a6ff", "#8bb8f7", "#e8a2b6", "#e2bf7a", "#7bd4d0", "#d8d3c7", "#d98f8f"];
  return <div className="swatches">{colors.map((color) => <button key={color} className={value === color ? "picked" : ""} style={{ background: color }} onClick={() => onChange(color)} />)}</div>;
}

function Page({ children }: { children: React.ReactNode }) {
  return <div className="page">{children}</div>;
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <section className="empty"><MothMark /><h1>{title}</h1><p>{body}</p></section>;
}

