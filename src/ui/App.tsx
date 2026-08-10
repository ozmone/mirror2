import type React from "react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
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
  FileText,
  Folder,
  History,
  Image as ImageIcon,
  KeyRound,
  Menu,
  MessageSquare,
  Pencil,
  Paperclip,
  Plus,
  RefreshCw,
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
import {
  abilities,
  addMessage,
  addDeltaMessage,
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
import { defaultDeltaBases, defaultDeltaJobs, defaultDeltaNpcStats, defaultDeltaPrefixes, defaultDeltaSystemPrompt, defaultMemoryInstruction, defaultSettings } from "../data/defaults";
import { Ability, AbilityModifiers, AbilityScores, AppSettings, Character, CharacterBonus, Chat, DeltaActionMacro, DeltaAllyCacheEntry, DeltaBaseTemplate, DeltaEntity, DeltaFinishPacket, DeltaJobTemplate, DeltaLootItem, DeltaMessage, DeltaPrefixTemplate, DeltaSession, InventoryKind, InventoryItem, InventoryLog, InventoryUpdateRequest, Memory, Message, PendingMemory, Project, RouteName } from "../types";
import { estimateTokens, formatDate, normaliseTag, now, splitTags, uid } from "../utils";
import { ProjectIcon, projectIcons } from "./icons";

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

function isDeltaFinishRequest(text: string) {
  return /\b(finish|end|close)\s+(?:this\s+)?(?:delta\s+)?engagement\b|\bclose\s+delta(?:\s+mode)?\b/i.test(text);
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

function parseDeltaBriefPacket(text: string) {
  try {
    const parsed = JSON.parse(extractJsonObject(text)) as { brief?: unknown; playerCharacterName?: unknown; avoidLabel?: unknown; avoidPrompt?: unknown };
    return {
      brief: typeof parsed.brief === "string" ? parsed.brief.trim() : "",
      playerCharacterName: typeof parsed.playerCharacterName === "string" ? parsed.playerCharacterName.trim() : "",
      avoidLabel: typeof parsed.avoidLabel === "string" ? parsed.avoidLabel.trim() : "",
      avoidPrompt: typeof parsed.avoidPrompt === "string" ? parsed.avoidPrompt.trim() : ""
    };
  } catch {
    return { brief: "", playerCharacterName: "", avoidLabel: "", avoidPrompt: "" };
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

function statModifier(value?: number) {
  if (typeof value !== "number") return "";
  const modifier = Math.floor((value - 10) / 2);
  return modifier >= 0 ? `+${modifier}` : `${modifier}`;
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

function messageHistoryText(message: Message) {
  const body = message.role === "user" ? clarifyLeadingOocForModel(message.body) : message.body;
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
    content: message.id === currentMessageId && currentImages.length ? openRouterContent(clarifyLeadingOocForModel(message.body), currentImages) : messageHistoryText(message)
  }));
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

function renderInlineMarkdown(text: string) {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\(\(.+?\)\)|\*\*\*.+?\*\*\*|\*\*.+?\*\*|\*[^*\n]+?\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    const key = `${match.index}-${token}`;
    if (token.startsWith("((") && token.endsWith("))")) {
      nodes.push(<span className="md-ooc" key={key}>{token.slice(2, -2)}</span>);
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

function MarkdownText({ text, emptyText }: { text: string; emptyText?: string }) {
  const source = text || emptyText || "";
  if (!source) return null;
  return (
    <div className="markdown-text">
      {source.split(/\r?\n/).map((line, index) => {
        if (/^\s*---\s*$/.test(line)) return <hr key={index} />;
        const quote = /^(>{1,3})\s*(.*)$/.exec(line);
        if (quote) {
          const depth = quote[1].length;
          return <blockquote className={`md-quote depth-${depth}`} key={index}>{quote[2] ? renderInlineMarkdown(quote[2]) : "\u00a0"}</blockquote>;
        }
        const header = /^(#{1,3})\s+(.+)$/.exec(line);
        if (header) {
          const level = header[1].length;
          const Tag = (`h${level}` as "h1" | "h2" | "h3");
          return <Tag key={index}>{renderInlineMarkdown(header[2])}</Tag>;
        }
        return <p key={index}>{line ? renderInlineMarkdown(line) : "\u00a0"}</p>;
      })}
    </div>
  );
}

function LoadingSignal() {
  return <span className="loading-signal" aria-label="Loading" role="status" />;
}

function DeltaTurnText({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  return (
    <div className="delta-turn-lines">
      {lines.map((line, index) => (
        <div className="delta-turn-line" key={index} style={{ animationDelay: `${index * 110}ms` }}>
          <MarkdownText text={line} emptyText=" " />
        </div>
      ))}
    </div>
  );
}

function cinematicMarker() {
  return "\ud83c\udf9e\ufe0f";
}

function cleanDeltaCinematic(text: string) {
  return text.replace(/^(\ud83c\udf9e\ufe0f|ðŸŽžï¸)\s*/, "");
}

function splitDeltaCinematic(text: string) {
  const lines = text.split(/\r?\n/);
  const cinematic: string[] = [];
  while (lines[0]?.trim().startsWith(cinematicMarker())) cinematic.push(lines.shift() ?? "");
  while (lines[0]?.trim().startsWith("🎞️")) cinematic.push(lines.shift() ?? "");
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

type DeltaImminentProposal = {
  brief: string;
  playerCharacterName?: string;
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
      description: "Add or subtract a quantity from the current chat inventory or gear. Use a positive delta for gained items and a negative delta for spent/lost/removed items. Item names should be singular stack names where possible.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["inventory", "gear", "currency"], description: "Use inventory for carried items/ammo/consumables, gear for worn/equipped clothing/equipment, and currency for the chat currency amount." },
          name: { type: "string", description: "Singular item stack name, or the currency name when kind is currency." },
          delta: { type: "number", description: "Quantity change. Example: -12 when 12 rounds are used, 32 when 32 rounds are picked up." },
          logSentence: { type: "string", description: "One terse narrative sentence explaining this exact inventory/gear change." }
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
          brief: { type: "string", description: "Short immersive in-world setup for the imminent engagement: who, what, where, why, immediate pressure, and likely opposition. Do not speak as an assistant." },
          playerCharacterName: { type: "string", description: "Likely player-controlled character name, if known." },
          avoidLabel: { type: "string", description: "Button label for avoiding the engagement, usually Escape for danger or Cancel for a proposed mission." },
          avoidPrompt: { type: "string", description: "Short UI question asking what the player does to avoid or cancel the engagement." }
        },
        required: ["brief"]
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
      description: "Create one current Delta entity. Use saved characterId for known saved characters; otherwise apply readable PREFIX, BASE, and optional JOB labels from the project templates so generated stats are created. Do not invent hidden template IDs.",
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
          elevation: { type: "string" }
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
      description: "Lock Delta Mode until the user rolls the required dice. Use this whenever the GM needs authoritative client-generated roll results. After calling this, stop your response at the roll request.",
      parameters: {
        type: "object",
        properties: {
          die: { type: "number", description: "Required die sides. Use 4, 6, 8, 9, 12, 20, or 100." },
          count: { type: "number", description: "How many of this die the user must roll. Defaults to 1." },
          label: { type: "string", description: "Short roleplay-facing roll label, such as initiative, lockpick, damage, or resist fear." }
        },
        required: ["die", "label"]
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
      name: "update_delta_entity",
      description: "Update an existing current Delta entity by entityId. Template values are readable labels only.",
      parameters: {
        type: "object",
        properties: {
          entityId: { type: "string" },
          name: { type: "string" },
          side: { type: "string", enum: ["ally", "neutral", "hostile"] },
          prefix: { type: "string" },
          base: { type: "string" },
          job: { type: "string" },
          jobCategory: { type: "string" },
          statusText: { type: "string" },
          currentHp: { type: "number", description: "Current HP after the resolved event." },
          maxHp: { type: "number", description: "Maximum HP only when it must be corrected." },
          initiative: { type: "number", description: "Initiative result used to order the entity list." },
          distanceFromPlayer: { type: "string" },
          elevation: { type: "string" }
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
  const [profileCharacterId, setProfileCharacterId] = useState<string>();
  const [models, setModels] = useState<{ modelId: string; cosmeticName: string }[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [deltaOpen, setDeltaOpen] = useState(false);
  const [deltaSession, setDeltaSession] = useState<DeltaSession>();
  const [deltaMessages, setDeltaMessages] = useState<DeltaMessage[]>([]);
  const [deltaEntities, setDeltaEntities] = useState<DeltaEntity[]>([]);
  const [archivedDeltaSessions, setArchivedDeltaSessions] = useState<DeltaSession[]>([]);
  const [deltaActionMacros, setDeltaActionMacros] = useState<DeltaActionMacro[]>([]);
  const [deltaAllyCache, setDeltaAllyCache] = useState<DeltaAllyCacheEntry[]>([]);
  const [deltaStartContext, setDeltaStartContext] = useState("");
  const [selectedChatActiveDelta, setSelectedChatActiveDelta] = useState<DeltaSession>();
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const editingProject = projects.find((project) => project.id === (editingProjectId ?? selectedProjectId));
  const selectedChat = chats.find((chat) => chat.id === selectedChatId);

  useEffect(() => {
    setDeltaOpen(false);
    setDeltaSession(undefined);
    setDeltaMessages([]);
    setDeltaEntities([]);
    setArchivedDeltaSessions([]);
    setDeltaActionMacros([]);
    setDeltaAllyCache([]);
  }, [selectedChatId]);
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
      if (deltaOpen) {
        event.preventDefault();
        window.history.back();
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
  }, [deltaOpen, inventoryOpen, drawerOpen]);

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

  async function openDeltaMode(chatOverride?: Chat, startContext = "") {
    const activeChat = chatOverride ?? selectedChat;
    const activeProject = activeChat ? projects.find((project) => project.id === activeChat.projectId) : selectedProject;
    if (!activeProject || !activeChat) return;
    const session = startContext
      ? await getOrCreateDeltaSession(activeChat)
      : await db.deltaSessions.where("chatId").equals(activeChat.id).and((item) => item.active).first()
        ?? await db.deltaSessions.where("chatId").equals(activeChat.id).and((item) => !item.active).reverse().sortBy("updatedAt").then((items) => items[0]);
    if (!session) return;
    const [nextMessages, nextEntities, archivedSessions, actionMacros, allyCache] = await Promise.all([
      db.deltaMessages.where("sessionId").equals(session.id).toArray(),
      db.deltaEntities.where("sessionId").equals(session.id).toArray(),
      db.deltaSessions.where("chatId").equals(activeChat.id).and((item) => !item.active).toArray(),
      db.deltaActionMacros.where("chatId").equals(activeChat.id).toArray(),
      db.deltaAllyCache.where("chatId").equals(activeChat.id).toArray()
    ]);
    setDeltaSession(session);
    setDeltaMessages(nextMessages.sort((a, b) => a.sequence - b.sequence));
    setDeltaEntities(nextEntities.sort((a, b) => a.orderIndex - b.orderIndex));
    setArchivedDeltaSessions(archivedSessions.sort((a, b) => b.updatedAt - a.updatedAt));
    setDeltaActionMacros(actionMacros.sort((a, b) => a.orderIndex - b.orderIndex));
    setDeltaAllyCache(allyCache.sort((a, b) => b.updatedAt - a.updatedAt));
    setDeltaStartContext(startContext);
    setDeltaOpen(true);
    window.history.pushState({ mirrorDeltaMode: true }, "", window.location.href);
  }

  async function refreshDeltaMode() {
    if (!deltaSession) return;
    const [session, nextMessages, nextEntities, archivedSessions, actionMacros, allyCache] = await Promise.all([
      db.deltaSessions.get(deltaSession.id),
      db.deltaMessages.where("sessionId").equals(deltaSession.id).toArray(),
      db.deltaEntities.where("sessionId").equals(deltaSession.id).toArray(),
      db.deltaSessions.where("chatId").equals(deltaSession.chatId).and((item) => !item.active).toArray(),
      db.deltaActionMacros.where("chatId").equals(deltaSession.chatId).toArray(),
      db.deltaAllyCache.where("chatId").equals(deltaSession.chatId).toArray()
    ]);
    if (session) setDeltaSession(session);
    setDeltaMessages(nextMessages.sort((a, b) => a.sequence - b.sequence));
    setDeltaEntities(nextEntities.sort((a, b) => a.orderIndex - b.orderIndex));
    setArchivedDeltaSessions(archivedSessions.sort((a, b) => b.updatedAt - a.updatedAt));
    setDeltaActionMacros(actionMacros.sort((a, b) => a.orderIndex - b.orderIndex));
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
        onMenu={() => setDrawerOpen(true)}
        right={route === "chat" && selectedProject ? (
          <div className="header-actions">
            {(selectedProject.inventoryEnabled || selectedProject.gearEnabled) && (
              <button className="inventory-trigger" onClick={() => setInventoryOpen(true)} aria-label="Open inventory" title="Inventory">
                <ShoppingBag size={19} />
              </button>
            )}
            {selectedChat && (
              <button className={`inventory-trigger ${selectedChatActiveDelta ? "active" : ""}`} type="button" onClick={() => openDeltaMode()} aria-label="Open Delta Mode" title="Delta Mode">
                <Swords size={19} />
              </button>
            )}
          </div>
        ) : undefined}
      />
      {selectedProject && selectedChat && <InventoryDrawer open={inventoryOpen} project={selectedProject} chat={selectedChat} elevated={deltaOpen} onClose={() => setInventoryOpen(false)} onRefresh={refresh} />}
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
          actionMacros={deltaActionMacros}
          allyCache={deltaAllyCache}
          startContext={deltaStartContext}
          onStartContextConsumed={() => setDeltaStartContext("")}
          onOpenInventory={() => setInventoryOpen(true)}
          onClose={() => setDeltaOpen(false)}
          onRefresh={refreshDeltaMode}
        />
      )}
      <Drawer
        open={drawerOpen}
        projects={projects}
        selectedProjectId={selectedProjectId}
        chats={projectChats}
        selectedChatId={selectedChatId}
        onClose={() => setDrawerOpen(false)}
        onRoute={(nextRoute) => {
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
            onOpenDelta={(chatOverride, startContext) => openDeltaMode(chatOverride, startContext)}
            onSettingsSaved={async (modelId) => {
              setSelectedModelId(modelId);
              await refresh();
            }}
          />
        )}
        {route === "projects" && <ProjectsPage projects={projects} selectedProjectId={selectedProjectId} onSelect={setSelectedProjectId} onEdit={(id) => { setEditingProjectId(id); setRoute("projectEdit"); }} onRefresh={refresh} />}
        {route === "projectEdit" && editingProject && <ProjectEditPage project={editingProject} onRefresh={refresh} onDone={() => setRoute("projects")} />}
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

function Header({ title, subtitle, onMenu, right }: { title: string; subtitle?: string; onMenu: () => void; right?: React.ReactNode }) {
  return (
    <header className="topbar">
      <button className="icon-button" onClick={onMenu} aria-label="Open navigation">
        <Menu size={22} />
      </button>
      <div className="brand-mini">
        <MothMark />
        <div className="title-stack"><strong>{title}</strong>{subtitle && <span>{subtitle}</span>}</div>
      </div>
      <div className="header-right">{right}</div>
    </header>
  );
}

function InventoryDrawer({ open, project, chat, elevated, onClose, onRefresh }: { open: boolean; project: Project; chat: Chat; elevated?: boolean; onClose: () => void; onRefresh: () => Promise<void> }) {
  const defaultTab = project.inventoryEnabled ? "inventory" : "gear";
  const [tab, setTab] = useState<"inventory" | "gear" | "log">(defaultTab);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [logs, setLogs] = useState<InventoryLog[]>([]);
  const [currencyAmount, setCurrencyAmount] = useState(chat.currencyAmount?.toString() ?? "");
  const [saved, showSaved] = useSavedNotice();
  useEffect(() => {
    setCurrencyAmount(chat.currencyAmount?.toString() ?? "");
    setTab(project.inventoryEnabled ? "inventory" : "gear");
  }, [chat.id, chat.currencyAmount, project.inventoryEnabled, project.gearEnabled]);
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
  const shownItems = items.filter((item) => item.kind === tab);
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
        <div className="settings-tabs">
          {project.inventoryEnabled && <button className={tab === "inventory" ? "picked" : ""} onClick={() => setTab("inventory")}>Items</button>}
          {project.gearEnabled && <button className={tab === "gear" ? "picked" : ""} onClick={() => setTab("gear")}>Gear</button>}
          <button className={tab === "log" ? "picked" : ""} onClick={() => setTab("log")}>Log</button>
        </div>
        {tab === "inventory" && project.inventoryEnabled && (
          <div className="stack">
            {project.currencyName && <div className="currency-row"><input type="number" value={currencyAmount} onChange={(event) => setCurrencyAmount(event.target.value)} /><span>{project.currencyName}</span><button onClick={saveCurrency}><Save size={16} /></button>{saved && <span className="save-status">Saved</span>}</div>}
            {shownItems.map((item) => <InventoryItemRow key={item.id} item={item} onRefresh={load} />)}
            <button onClick={() => addItem("inventory")}><Plus size={18} /> Add item</button>
          </div>
        )}
        {tab === "gear" && project.gearEnabled && (
          <div className="stack">
            {shownItems.map((item) => <InventoryItemRow key={item.id} item={item} onRefresh={load} />)}
            <button onClick={() => addItem("gear")}><Plus size={18} /> Add gear</button>
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
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pressTimer, setPressTimer] = useState<number>();
  useEffect(() => {
    setName(item.name);
    setQuantity(item.quantity);
  }, [item.id, item.name, item.quantity]);
  function startPress() {
    window.clearTimeout(pressTimer);
    setPressTimer(window.setTimeout(() => setDeleteOpen(true), 520));
  }
  function cancelPress() {
    window.clearTimeout(pressTimer);
  }
  async function save(nextQuantity = quantity) {
    const singular = normaliseInventoryName(name);
    await db.inventoryItems.update(item.id, { name: singular, normalisedName: singular, quantity: Math.max(0, nextQuantity), updatedAt: now() });
    await onRefresh();
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
        <button onClick={() => { const next = Math.max(0, quantity - 1); setQuantity(next); save(next); }}>-</button>
        <input type="number" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} onBlur={() => save()} />
        <button onClick={() => { const next = quantity + 1; setQuantity(next); save(next); }}>+</button>
      </div>
      {deleteOpen && (
        <div className="inline-confirm">
          <span>Delete {name || "this item"}?</span>
          <button onClick={remove}>Delete</button>
          <button onClick={() => setDeleteOpen(false)}>Cancel</button>
        </div>
      )}
    </div>
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
  actionMacros,
  allyCache,
  startContext,
  onStartContextConsumed,
  onOpenInventory,
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
  actionMacros: DeltaActionMacro[];
  allyCache: DeltaAllyCacheEntry[];
  startContext?: string;
  onStartContextConsumed: () => void;
  onOpenInventory: () => void;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [activeTool, setActiveTool] = useState<"entities" | "inventory" | "settings" | "history" | "actions">();
  const [actionsEditMode, setActionsEditMode] = useState(false);
  const [entitySettingsOpen, setEntitySettingsOpen] = useState(false);
  const [entitySettingsTab, setEntitySettingsTab] = useState<"entities" | "ally-cache">("entities");
  const [cacheEditId, setCacheEditId] = useState<string>();
  const [cacheDraftTag, setCacheDraftTag] = useState("");
  const [cacheImportStatus, setCacheImportStatus] = useState("");
  const [clearCacheOpen, setClearCacheOpen] = useState(false);
  const [finishPacket, setFinishPacket] = useState<DeltaFinishPacket>();
  const [finishLoading, setFinishLoading] = useState(false);
  const [finishError, setFinishError] = useState("");
  const [forfeitConfirmOpen, setForfeitConfirmOpen] = useState(false);
  const [expandedEntityId, setExpandedEntityId] = useState<string>();
  const [projectCharacters, setProjectCharacters] = useState<Character[]>([]);
  const [settingsDraft, setSettingsDraft] = useState(session.settings);
  const [playerCharacterId, setPlayerCharacterId] = useState(chat.deltaPlayerCharacterId ?? "");
  const [previewSession, setPreviewSession] = useState<DeltaSession>();
  const [previewMessages, setPreviewMessages] = useState<DeltaMessage[]>([]);
  const [pendingEntityMacro, setPendingEntityMacro] = useState<DeltaActionMacro>();
  const [selectedEntityIds, setSelectedEntityIds] = useState<Set<string>>(new Set());
  const [macroDraft, setMacroDraft] = useState<{
    macro?: DeltaActionMacro;
    parentId?: string;
    folder: boolean;
    label: string;
    template: string;
    requestEntitySelection: boolean;
  }>();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const turnQueueRef = useRef<HTMLDivElement>(null);
  const finishRequestedRef = useRef(false);
  const stagedStartContextRef = useRef("");
  const [turnQueueEdges, setTurnQueueEdges] = useState({ left: false, right: false });
  const [saved, showSaved] = useSavedNotice();
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
  useEffect(() => setSettingsDraft(session.settings), [session.id, session.settings]);
  useEffect(() => setPlayerCharacterId(chat.deltaPlayerCharacterId ?? ""), [chat.id, chat.deltaPlayerCharacterId]);
  useEffect(() => {
    if (!startContext || messages.length > 0) return;
    const startKey = `${session.id}:${startContext}`;
    if (stagedStartContextRef.current === startKey) return;
    stagedStartContextRef.current = startKey;
    const handoff = startContext;
    onStartContextConsumed();
    void addDeltaMessage(session.id, "system", handoff).then(() => submitDeltaTurn(handoff, {
      hideUser: true,
      stageEngagement: true,
      instruction: "Start this Delta engagement from the main-chat handoff. Do not place the handoff text in the user's composer. First stage the engagement, then write turn 1 as a concise roleplay-facing opening that establishes who is involved, what is happening, where it is happening, and why it matters. End by calling for initiative and stop there."
    })).then(async (started) => {
      if (!started) return;
      const playerName = handoff.match(/PLAYER CHARACTER:\s*([^\n]+)/i)?.[1]?.trim().toLocaleLowerCase();
      const nextSettings = { ...session.settings };
      if (playerName && !nextSettings.playerEntityId) {
        const stagedEntities = await db.deltaEntities.where("sessionId").equals(session.id).toArray();
        const matched = stagedEntities.find((entity) => entity.name.trim().toLocaleLowerCase() === playerName || entity.name.trim().toLocaleLowerCase().includes(playerName));
        if (matched) nextSettings.playerEntityId = matched.id;
      }
      await db.deltaSessions.update(session.id, { settings: nextSettings, initiativeStarted: false, awaitingPlayerRoll: true, awaitingPlayerAction: false, requiredRollDie: 20, requiredRollCount: 1, requiredRollResults: [], requiredRollKind: "initiative", requiredRollLabel: "initiative", actionPrompt: undefined, turnIndex: 0, updatedAt: now() });
      await onRefresh();
    });
  }, [startContext, messages.length]);
  useEffect(() => {
    const closeFromHistory = () => onClose();
    window.addEventListener("popstate", closeFromHistory);
    return () => window.removeEventListener("popstate", closeFromHistory);
  }, [onClose]);
  useEffect(() => {
    if (activeTool !== "entities") return;
    void db.characters
      .where("projectId")
      .equals(project.id)
      .toArray()
      .then((rows) => setProjectCharacters(rows.sort((a, b) => (a.orderIndex ?? Number.MAX_SAFE_INTEGER) - (b.orderIndex ?? Number.MAX_SAFE_INTEGER) || a.normalisedName.localeCompare(b.normalisedName))));
  }, [activeTool, project.id]);
  useEffect(() => {
    if (!session.awaitingPlayerRoll || activeTool !== "actions") return;
    setActiveTool(undefined);
  }, [session.awaitingPlayerRoll, activeTool]);
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
  async function runDeltaTool(toolCall: OpenRouterToolCall) {
    const args = deltaToolArgs(toolCall);
    const stringArg = (key: string) => typeof args[key] === "string" ? String(args[key]).trim() : "";
    switch (toolCall.function.name) {
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
        const character = characterId ? await db.characters.get(characterId) : undefined;
        const entityName = character && character.projectId === project.id ? character.name : stringArg("name") || "Unnamed entity";
        const existingEntity = await db.deltaEntities
          .where("sessionId")
          .equals(session.id)
          .and((entity) => characterId
            ? entity.characterId === characterId
            : !entity.characterId && entity.name.trim().toLocaleLowerCase() === entityName.trim().toLocaleLowerCase())
          .first();
        if (existingEntity) {
          return {
            existing: existingEntity.name,
            entityId: existingEntity.id,
            templateTag: existingEntity.templateTag ?? "",
            stats: { STR: existingEntity.str, DEX: existingEntity.dex, CON: existingEntity.con, INT: existingEntity.int, WIS: existingEntity.wis, CHA: existingEntity.cha },
            hp: { current: existingEntity.currentHp, max: existingEntity.maxHp }
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
          orderIndex: entities.length + 1,
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
        finishRequestedRef.current = true;
        return { finishing: true, message: "The client will prepare the engagement finish flow. Do not write a closing response." };
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
        const count = Math.max(1, Math.min(12, Math.floor(typeof args.count === "number" && Number.isFinite(args.count) ? args.count : 1)));
        const label = stringArg("label").slice(0, 80) || `d${die} roll`;
        await db.deltaSessions.update(session.id, {
          awaitingPlayerRoll: true,
          awaitingPlayerAction: false,
          requiredRollDie: die,
          requiredRollCount: count,
          requiredRollResults: [],
          requiredRollKind: "check",
          requiredRollLabel: label,
          actionPrompt: undefined,
          updatedAt: now()
        });
        return { waitingForRoll: `${count}d${die}`, label };
      }
      case "request_delta_action": {
        const prompt = stringArg("prompt").slice(0, 180) || "What does the player do?";
        await db.deltaSessions.update(session.id, {
          awaitingPlayerAction: true,
          awaitingPlayerRoll: false,
          actionPrompt: prompt,
          requiredRollDie: undefined,
          requiredRollCount: undefined,
          requiredRollResults: undefined,
          requiredRollKind: undefined,
          requiredRollLabel: undefined,
          updatedAt: now()
        });
        return { waitingForAction: true, prompt };
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
          statusText: stringArg("statusText") || entity.statusText,
          currentHp: typeof args.currentHp === "number" && Number.isFinite(args.currentHp) ? Math.max(0, args.currentHp) : entity.currentHp,
          maxHp: typeof args.maxHp === "number" && Number.isFinite(args.maxHp) ? Math.max(1, args.maxHp) : entity.maxHp,
          initiative: typeof args.initiative === "number" && Number.isFinite(args.initiative) ? args.initiative : entity.initiative,
          distanceFromPlayer: stringArg("distanceFromPlayer") || entity.distanceFromPlayer,
          elevation: stringArg("elevation") || entity.elevation,
          updatedAt: now()
        };
        await db.deltaEntities.update(entity.id, next);
        await upsertDeltaAllyCache(chat.id, { ...entity, ...next });
        return { updated: next.name, entityId: entity.id, templateTag: "templateTag" in next ? next.templateTag ?? "" : entity.templateTag ?? "" };
      }
      default:
        return { error: `Unknown Delta tool ${toolCall.function.name}.` };
    }
  }
  async function completeDeltaTurn(history: OpenRouterMessage[], toolLog: string[], requireInitialTool = false) {
    let messagesToSend = history;
    for (let index = 0; index < 4; index += 1) {
      const response = await deltaOpenRouterRequest({
        model: session.settings.modelId || chat.modelId || selectedModelId || settings.defaultModelId,
        messages: messagesToSend,
        tools: [...characterTools, ...deltaEntityTools],
        ...(requireInitialTool && index === 0 ? { tool_choice: "required" } : {}),
        temperature: session.settings.temperature ?? 0,
        top_p: session.settings.topP ?? 0,
        ...(session.settings.maxTokens ? { max_tokens: session.settings.maxTokens } : {})
      });
      const json = await response.json() as OpenRouterResponse;
      const assistantMessage = json.choices?.[0]?.message;
      const toolCalls = assistantMessage?.tool_calls ?? [];
      if (!toolCalls.length) return assistantMessage?.content ?? "";
      const pauseRequested = toolCalls.some((toolCall) => toolCall.function.name === "request_delta_roll" || toolCall.function.name === "request_delta_action");
      messagesToSend = [
        ...messagesToSend,
        { role: "assistant", content: assistantMessage?.content ?? "", tool_calls: toolCalls }
      ];
      for (const toolCall of toolCalls) {
        const result = await runDeltaTool(toolCall);
        toolLog.push(toolCall.function.name);
        messagesToSend.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(result) });
      }
      if (pauseRequested) return assistantMessage?.content ?? "";
    }
    return "Delta tools reached their turn limit. Continue from the current engagement state.";
  }
  async function submitDeltaTurn(clean: string, options: { hideUser?: boolean; instruction?: string; stageEngagement?: boolean } = {}) {
    if (!clean || !session.active) return false;
    if (!settings.apiKey) {
      alert("Add your OpenRouter API key before sending Delta AI requests. Your draft is still here.");
      return false;
    }
    const model = session.settings.modelId || chat.modelId || selectedModelId || settings.defaultModelId;
    if (!model) {
      alert("Choose a model before sending Delta AI requests. Your draft is still here.");
      return false;
    }
    if (!options.hideUser) await addDeltaMessage(session.id, "user", clean);
    const timestamp = now();
    const replyId = uid();
    const replySequence = ((await db.deltaMessages.where("[sessionId+sequence]").between([session.id, Dexie.minKey], [session.id, Dexie.maxKey]).last())?.sequence ?? -1) + 1;
    await db.deltaMessages.add({ id: replyId, sessionId: session.id, sequence: replySequence, role: "assistant", body: "...", status: "pending", modelId: model, createdAt: timestamp, updatedAt: timestamp });
    await onRefresh();
    const allCharacters = await db.characters.where("projectId").equals(project.id).toArray();
    const deltaPrompt = project.deltaSystemPrompt?.trim() || defaultDeltaSystemPrompt;
    const linkedCharacters = await linkedCharacterContext();
    const context = [
      deltaPrompt,
      `Project: ${project.name}`,
      project.worldSetting ? `World setting:\n${project.worldSetting}` : "",
      `Saved project character names:\n${allCharacters.map((character) => `- ${character.name} (${character.id})`).join("\n") || "(none)"}`,
      linkedCharacters ? `Linked involved character data:\n${linkedCharacters}` : "",
      `Current entity list:\n${entities.map((entity) => `- ${entity.id}: ${entity.name}, ${entity.side}${entity.templateTag ? `, ${entity.templateTag}` : ""}${entity.statusText ? `, ${entity.statusText}` : ""}${entityPositionLabel(entity) ? `, ${entityPositionLabel(entity)}` : ""}`).join("\n") || "(none)"}`,
      `Chat-scoped ally cache:\n${allyCache.map((entry) => `- ${entry.name}${entry.templateTag ? `, ${entry.templateTag}` : ""}`).join("\n") || "(none)"}`,
      `Available PREFIX labels: ${effectiveDeltaPrefixes(project.deltaPrefixes).map((item) => item.label).join(", ") || "(none)"}`,
      `Available BASE labels: ${effectiveDeltaBases(project.deltaBases).map((item) => item.label).join(", ") || "(none)"}`,
      `Available JOB categories: ${jobCategories(project.deltaJobs ?? []).map(([category, count]) => `${category} (${count})`).join(", ") || "(none)"}`,
      "Generated entity rule: for every unlinked entity, choose a suitable PREFIX and BASE from the available labels when they exist. If JOB categories exist, call list_delta_job_categories, then get_delta_jobs_for_category for the best category, and choose a JOB from that category. Pass prefix, base, job, and jobCategory to create_delta_entity so the entity receives generated stats. For saved linked characters, use characterId and do not use generated tags.",
      "Player roll rule: when the player declares an action with uncertain success, do not resolve success or failure yet. Call request_delta_roll with the required die/count/label and stop. Only resolve the action after the client provides the actual roll result.",
      "NPC roll visibility rule: when you roll for NPCs, hostiles, allies, hazards, detection, resistance, damage, or contests, write the roll visibly in the turn text. Use compact lines like: Name: Rolling 1d20 + DEX... *12 + 2 =* **14**. Never silently decide rolled outcomes.",
      "Turn text format: never write labels such as 'Turn resolved:', 'Result:', or 'Outcome:'. Write the action and consequence directly. A turn may use multiple short lines when useful.",
      "Delta prose style: compact but not sterile. Add one or two precise sensory, emotional, or character-flavor details when they make the turn feel alive. Keep it lean; do not expand into main-chat story prose.",
      "Cinematic injection: occasionally, when stakes or relationships make it feel right, you may start with a compact cut-in beginning with 🎞️ before the actual turn text. Keep it brief but vivid: one to three compact sentences, maximum three short lines, never a full paragraph or story scene. Use it sparingly for reaction beats such as comms, fear, pain, taunts, vows, hesitation, or intimate pressure. Do not use it every turn.",
      options.stageEngagement
        ? "Current phase: opening a new engagement."
        : ""
    ].filter(Boolean).join("\n\n");
    const requestMessages: OpenRouterMessage[] = [
      { role: "system", content: context },
      ...messages.map((message) => ({ role: message.role as OpenRouterMessage["role"], content: message.body })),
      { role: "user", content: [options.instruction, clean].filter(Boolean).join("\n\n") }
    ];
    const toolLog: string[] = [];
    finishRequestedRef.current = false;
    try {
      const reply = await completeDeltaTurn(requestMessages, toolLog, options.stageEngagement);
      if (finishRequestedRef.current) {
        await db.deltaMessages.delete(replyId);
        await startFinishFlow();
        return true;
      }
      if (reply.trim()) await db.deltaMessages.update(replyId, { body: reply, status: "complete", updatedAt: now() });
      else await db.deltaMessages.delete(replyId);
    } catch (error) {
      await db.deltaMessages.update(replyId, { body: error instanceof Error ? error.message : "OpenRouter request failed.", status: "failed", updatedAt: now() });
    }
    await onRefresh();
    return true;
  }
  async function send() {
    const clean = body.trim();
    if (!clean || !session.active) return;
    if (session.awaitingPlayerRoll || (session.initiativeStarted && !session.awaitingPlayerAction)) return;
    if (isDeltaFinishRequest(clean)) {
      setBody("");
      await startFinishFlow();
      return;
    }
    const wasAwaitingPlayerAction = Boolean(session.awaitingPlayerAction);
    if (wasAwaitingPlayerAction) await db.deltaSessions.update(session.id, { awaitingPlayerAction: false, actionPrompt: undefined, updatedAt: now() });
    const sent = await submitDeltaTurn(clean, wasAwaitingPlayerAction ? {
      instruction: "The player just declared their action. If the action has uncertain success, risk, opposition, contested movement, attack, defense, stealth, persuasion, hacking, resistance, damage, or hazard interaction, do not resolve success/failure yet. Call request_delta_roll with the required die/count/label and stop. If no roll is needed, resolve exactly one compact outcome, persist entity changes, and stop without calling request_delta_action again for this same turn."
    } : {});
    if (sent) {
      setBody("");
      if (session.initiativeStarted && session.awaitingPlayerAction) await advanceTurn();
    }
  }
  function rollDie(sides: number) {
    const values = new Uint32Array(1);
    const range = 0x100000000;
    const limit = range - (range % sides);
    do {
      crypto.getRandomValues(values);
    } while (values[0] >= limit);
    return (values[0] % sides) + 1;
  }
  async function rollDeltaDie(sides: number) {
    if (session.awaitingPlayerRoll && session.requiredRollDie && sides !== session.requiredRollDie) return;
    const result = rollDie(sides);
    if (session.awaitingPlayerRoll) {
      const results = [...(session.requiredRollResults ?? []), result];
      const requiredCount = Math.max(1, session.requiredRollCount ?? 1);
      if (results.length < requiredCount) {
        await db.deltaSessions.update(session.id, { requiredRollResults: results, updatedAt: now() });
        await onRefresh();
        return;
      }
      if ((session.requiredRollKind ?? "initiative") === "initiative") await resolveInitiative(results[0] ?? result);
      else {
        const resultText = requiredCount > 1 ? `${requiredCount}d${sides} = ${results.join(", ")}` : `d${sides} = ${result}`;
        await addDeltaMessage(session.id, "system", `🎲 ${session.requiredRollLabel || `${requiredCount}d${sides} roll`}: ${resultText}`);
        await db.deltaSessions.update(session.id, {
          awaitingPlayerRoll: false,
          requiredRollDie: undefined,
          requiredRollCount: undefined,
          requiredRollResults: undefined,
          requiredRollKind: undefined,
          requiredRollLabel: undefined,
          updatedAt: now()
        });
        await submitDeltaTurn(`Dice roll: ${resultText}`, {
          hideUser: true,
          instruction: `This is the actual client-generated ${session.requiredRollLabel || `${requiredCount}d${sides} roll`}. The result is authoritative and has already been visibly logged. Resolve exactly one compact Delta outcome from this roll bundle. Include the aftermath and any HP/status/entity changes. If another roll is required to finish this same action, call request_delta_roll with the next required die/count and stop. Otherwise stop without calling request_delta_action again for this same turn; the client will advance to the next entity.`
        });
        const latest = await db.deltaSessions.get(session.id);
        if (latest?.initiativeStarted && !latest.awaitingPlayerAction && !latest.awaitingPlayerRoll) await advanceTurn();
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
        actionPrompt: undefined,
        awaitingPlayerAction: first?.entity.id === playerId,
        turnIndex: 0,
        updatedAt: now()
      });
    });
    await addDeltaMessage(session.id, "system", `Initiative order:\n${ranked.map(({ entity, rawRoll, dexModifier, initiative }, index) => `${index + 1}. ${entity.name}: ${rawRoll}${dexModifier === 0 ? "" : dexModifier > 0 ? ` + ${dexModifier}` : ` - ${Math.abs(dexModifier)}`} = ${initiative}`).join("\n")}`);
    await onRefresh();
  }
  async function advanceTurn() {
    const current = await db.deltaSessions.get(session.id);
    const ordered = (await db.deltaEntities.where("sessionId").equals(session.id).toArray()).sort((a, b) => a.orderIndex - b.orderIndex);
    if (!current || !ordered.length || !current.initiativeStarted) return;
    if (current.awaitingPlayerRoll || current.awaitingPlayerAction) return;
    const nextIndex = ((current.turnIndex ?? 0) + 1) % ordered.length;
    const playerId = current.settings.playerEntityId ?? ordered[0]?.id;
    const next = ordered[nextIndex];
    await db.deltaSessions.update(session.id, {
      turnIndex: nextIndex,
      awaitingPlayerAction: next?.id === playerId,
      awaitingPlayerRoll: false,
      updatedAt: now()
    });
    await onRefresh();
  }
  async function nextTurn() {
    if (!session.initiativeStarted || session.awaitingPlayerAction || session.awaitingPlayerRoll) return;
    const ordered = [...entities].sort((a, b) => a.orderIndex - b.orderIndex);
    const actor = ordered[session.turnIndex ?? 0];
    if (!actor) return;
    const sent = await submitDeltaTurn(`${actor.name}'s turn.`, {
      hideUser: true,
      instruction: `Play exactly one turn for ${actor.name}. If this turn involves attack, defense, hazard, detection, resistance, damage, contested movement, or another uncertain NPC/ally/non-player action, roll visibly in the turn text using a compact line like "${actor.name}: Rolling 1d20 + STAT... *raw + mod =* **total**." Do not silently decide rolled outcomes. If a cinematic reaction beat is warranted before this turn, put a compact cut-in beginning with 🎞️ first, limited to one to three compact sentences and no more than three short lines, then write the actual turn. Write the action and consequence directly, without prefixes like 'Turn resolved:'. Use multiple short lines if needed. Add one or two small sensory or character-flavor details when they sharpen the moment, but do not expand into full story prose. Persist any HP, status, relationship, distance, or elevation changes with update_delta_entity. Do not resolve any later turns and do not tell the player to let you know what happens next.`
    });
    if (sent) await advanceTurn();
  }
  async function cacheCurrentGeneratedAllies() {
    await Promise.all(entities.map((entity) => upsertDeltaAllyCache(chat.id, entity)));
  }
  function finishContext() {
    return [
      "Finish the current Delta engagement and return only valid JSON with this exact object shape:",
      "{\"finalEngagementBeat\":\"\",\"outcomeSummary\":\"\",\"lootItems\":[{\"id\":\"\",\"name\":\"\",\"quantity\":1,\"pickedQuantity\":0}],\"parentChatHandoff\":\"\"}",
      "finalEngagementBeat: short in-world closing beat for the Delta transcript.",
      "outcomeSummary: compact roleplay-facing summary of who was involved, what changed, injuries/deaths/escapes/captures/alliances/hostilities/unresolved threads, scene/location changes, discoveries, and consequences.",
      "lootItems: only concrete loot or gained items with quantities. Use pickedQuantity 0 initially. Use an empty array if none.",
      "parentChatHandoff: short roleplay-facing continuation packet for the parent chat. No full transcript, no tool calls, no debug text, no UI wording, no technical explanation.",
      `Project: ${project.name}`,
      project.instructions ? `Project instructions:\n${project.instructions}` : "",
      project.worldSetting ? `World setting:\n${project.worldSetting}` : "",
      `Current entity list:\n${entities.map((entity) => `- ${entity.name}, ${entity.side}${entity.templateTag ? `, ${entity.templateTag}` : ""}${entity.statusText ? `, ${entity.statusText}` : ""}${entityPositionLabel(entity) ? `, ${entityPositionLabel(entity)}` : ""}`).join("\n") || "(none)"}`,
      `Delta transcript:\n${messages.map((message) => `${message.role}: ${message.body}`).join("\n\n") || "(none)"}`
    ].filter(Boolean).join("\n\n");
  }
  async function startFinishFlow() {
    if (!session.active) return;
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
      const response = await deltaOpenRouterRequest({
        model,
        messages: [
          { role: "system", content: "You write concise roleplay-facing Delta finish packets as valid JSON only." },
          { role: "user", content: finishContext() }
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
  function hasUnclaimedLoot(packet = finishPacket) {
    return Boolean(packet?.lootItems.some((item) => item.pickedQuantity < item.quantity));
  }
  async function continueFromFinish(force = false) {
    if (!finishPacket) return;
    if (!force && hasUnclaimedLoot()) {
      setForfeitConfirmOpen(true);
      return;
    }
    const timestamp = now();
    const picked = finishPacket.lootItems.filter((item) => item.pickedQuantity > 0);
    if (picked.length && !project.inventoryEnabled) await db.projects.update(project.id, { inventoryEnabled: true, updatedAt: timestamp });
    for (const item of picked) {
      await applyInventoryChange(project.id, chat.id, "inventory", item.name, item.pickedQuantity, `Recovered ${item.name} x ${item.pickedQuantity}.`);
    }
    await addMessage(chat.id, chat.activeBranchId, "system", finishPacket.parentChatHandoff);
    await archiveDeltaSession(session.id, session.title);
    await pruneArchivedDeltaSessions();
    setFinishPacket(undefined);
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
    const archivedMessages = await db.deltaMessages.where("sessionId").equals(sessionRecord.id).toArray();
    setPreviewSession(sessionRecord);
    setPreviewMessages(archivedMessages.sort((a, b) => a.sequence - b.sequence));
  }
  async function renameArchived(sessionRecord: DeltaSession) {
    const title = prompt("Rename archived engagement", sessionRecord.title)?.trim();
    if (!title) return;
    await db.deltaSessions.update(sessionRecord.id, { title, updatedAt: now() });
    setPreviewSession({ ...sessionRecord, title, updatedAt: now() });
    await onRefresh();
  }
  async function saveSettings() {
    await db.deltaSessions.update(session.id, { settings: settingsDraft, updatedAt: now() });
    await pruneArchivedDeltaSessions();
    showSaved();
    await onRefresh();
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
  function chooseMacro(macro: DeltaActionMacro) {
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
    const linkedIds = Array.from(new Set(entities.map((entity) => entity.characterId).filter(Boolean) as string[]));
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
  function addMacro(parentId: string | undefined, folder: boolean) {
    setMacroDraft({ parentId, folder, label: "", template: "", requestEntitySelection: false });
  }
  function editMacro(macro: DeltaActionMacro) {
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
    const label = macroDraft.label.trim();
    if (!label) return;
    const timestamp = now();
    if (macroDraft.macro) {
      await db.deltaActionMacros.update(macroDraft.macro.id, {
        label,
        template: macroDraft.folder ? undefined : macroDraft.template,
        requestEntitySelection: macroDraft.folder ? false : macroDraft.requestEntitySelection,
        updatedAt: timestamp
      });
    } else {
      const siblings = actionMacros.filter((macro) => macro.parentId === macroDraft.parentId);
      await db.deltaActionMacros.add({
        id: uid(),
        chatId: chat.id,
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
    await onRefresh();
  }
  async function deleteMacro(macro: DeltaActionMacro) {
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
    await db.deltaActionMacros.bulkDelete(Array.from(ids));
    await onRefresh();
  }
  const playerEntityId = settingsDraft.playerEntityId ?? entities[0]?.id;
  const namesByEntityId = entityDisplayNames(entities);
  const orderedEntities = [...entities].sort((a, b) => a.orderIndex - b.orderIndex);
  const turnIndex = Math.max(0, Math.min(session.turnIndex ?? 0, Math.max(0, orderedEntities.length - 1)));
  const turnQueue = session.initiativeStarted ? [...orderedEntities.slice(turnIndex), ...orderedEntities.slice(0, turnIndex)] : [];
  const currentTurn = turnQueue[0];
  const requiredRollCount = Math.max(1, session.requiredRollCount ?? 1);
  const completedRollCount = session.requiredRollResults?.length ?? 0;
  const remainingRollCount = Math.max(1, requiredRollCount - completedRollCount);
  const requiredRollText = `${remainingRollCount} ${remainingRollCount === 1 ? "dice roll" : "dice rolls"} (d${session.requiredRollDie ?? 20}) left`;
  const currentTurnLabel = session.awaitingPlayerRoll
    ? `Roll ${requiredRollCount}d${session.requiredRollDie ?? 20} for ${session.requiredRollLabel || "initiative"}`
    : currentTurn
      ? (namesByEntityId.get(currentTurn.id) ?? currentTurn.name)
      : "Engagement";
  const currentTurnNumber = messages.filter((message) => message.role !== "system").length + 1;
  const inputDisabled = Boolean(session.awaitingPlayerRoll || (session.initiativeStarted && !session.awaitingPlayerAction));
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
  return (
    <div className="delta-layer">
      <div className="delta-dim" aria-hidden="true" />
      <aside className="delta-workspace">
        <div className="delta-top">
          <div className="delta-title-block">
            <h2><Swords size={18} /> Delta Mode</h2>
            <strong className="delta-engagement-name" title={session.title}>{session.title || "Untitled Engagement"}</strong>
            <small title={`${project.name} / ${chat.title}`}>{project.name} / {chat.title}</small>
          </div>
          <button className="icon-button" onClick={renameActiveEngagement} aria-label="Rename Delta engagement" title={session.title || "Name engagement"}><Edit3 size={16} /></button>
        </div>
        <nav className="delta-toolbar" aria-label="Delta tools">
          <button className={activeTool === "entities" ? "picked" : ""} onClick={() => setActiveTool(activeTool === "entities" ? undefined : "entities")} aria-label="Entity list"><UserRound size={18} /></button>
          <button onClick={onOpenInventory} aria-label="Inventory"><ShoppingBag size={18} /></button>
          <button className={activeTool === "settings" ? "picked" : ""} onClick={() => setActiveTool(activeTool === "settings" ? undefined : "settings")} aria-label="Delta settings"><Settings size={18} /></button>
          <button className={activeTool === "history" ? "picked" : ""} onClick={() => setActiveTool(activeTool === "history" ? undefined : "history")} aria-label="Delta history"><History size={18} /></button>
          <button className="delta-end-engagement" onClick={startFinishFlow} disabled={finishLoading}>{finishLoading ? "Finishing..." : "End Engagement"}</button>
        </nav>
        <div className={`delta-turn-queue-wrap ${turnQueueEdges.left ? "show-left" : ""} ${turnQueueEdges.right ? "show-right" : ""}`}>
          <div className="delta-turn-queue" aria-label="Turn order" ref={turnQueueRef} onScroll={updateTurnQueueEdges}>
            {turnQueue.map((entity, index) => (
              <span className={`${relationshipForEntity(entity)} ${index === 0 ? "active" : ""}`} key={entity.id}>
                {entity.orderIndex + 1}. {namesByEntityId.get(entity.id) ?? entity.name}
              </span>
            ))}
          </div>
        </div>
        {activeTool && activeTool !== "actions" && (
          <section className="delta-tool-panel">
            {activeTool === "entities" && (
              <>
                <div className="section-title">
                  <h2>{pendingEntityMacro ? "Select Targets" : "Entity List"}</h2>
                  <div className="split-actions">
                    <span className="save-status">{pendingEntityMacro ? "Macro target" : `${projectCharacters.length} project characters`}</span>
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
                          className={`delta-entity ${relationship} ${entity.id === playerEntityId ? "player" : ""} ${selectedEntityIds.has(entity.id) ? "selected" : ""}`}
                          onClick={() => pendingEntityMacro ? toggleSelectedEntity(entity.id) : setExpandedEntityId(expandedEntityId === entity.id ? undefined : entity.id)}
                        >
                          <small className="delta-initiative">{entity.initiative ?? "-"}</small>
                          <span>{displayName}{entity.templateTag && <small className="delta-template-tag">{entity.templateTag}</small>}</span>
                          <div className="delta-hp"><i style={{ width: `${Math.max(0, Math.min(100, (hp / maxHp) * 100))}%` }} /></div>
                          <small>{hp}/{maxHp} HP</small>
                          <small className="delta-relationship-label">{deltaRelationshipLabel(relationship)}</small>
                        {entityPositionLabel(entity) && <small className="delta-position">{entityPositionLabel(entity)}</small>}
                        <small className="delta-status">{entity.statusText || "No status"}</small>
                      </div>
                      {expandedEntityId === entity.id && (
                        <div className="delta-entity-detail">
                          <p>{entity.statusText || "No current Delta status."}</p>
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
                          <div className="delta-stat-grid">
                              {deltaEntityStats(entity).map(([label, value]) => (
                                <span key={label}><b>{label}</b><strong>{value ?? "-"}</strong><small>{statModifier(value)}</small></span>
                              ))}
                            </div>
                            <div className="split-actions">
                              {entity.characterId && <button onClick={() => refreshEntityCharacterStats(entity)}>Refresh character stats</button>}
                              {entity.id !== playerEntityId && <button className="danger" onClick={() => removeEntity(entity)}>Remove</button>}
                            </div>
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
            {activeTool === "settings" && (
              <div className="stack">
                <div className="section-title"><h2>Delta Settings</h2></div>
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
                <div className="split-actions"><button onClick={saveSettings}><Save size={18} /> Save Delta settings</button>{saved && <span className="save-status">Saved</span>}</div>
              </div>
            )}
            {activeTool === "history" && (
              <div className="stack">
                <div className="section-title"><h2>Delta History</h2><span>{archivedSessions.length}</span></div>
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
        <div className="delta-body">
          <div className="delta-messages">
            {messages.map((message) => {
              if (message.role === "system") {
                const initiativeLines = message.body.startsWith("Initiative order:")
                  ? message.body.split("\n").slice(1).filter((line) => line.trim())
                  : [];
                return (
                  <article className="delta-log-brief" key={message.id}>
                    {initiativeLines.length > 0 ? (
                      <div className="delta-initiative-list">
                        <strong>Initiative order</strong>
                        {initiativeLines.map((line) => (
                          <span className={relationshipForInitiativeLine(line)} key={line}>{line}</span>
                        ))}
                      </div>
                    ) : (
                      <div className="message-body"><MarkdownText text={message.body} /></div>
                    )}
                  </article>
                );
              }
              const cinematicSplit = splitDeltaCinematic(message.body);
              const bodyText = cinematicSplit.turn || message.body;
              const isLoading = message.status === "pending" && bodyText.trim() === "...";
              const rowEntity = session.initiativeStarted && orderedEntities.length > 0
                ? orderedEntities[displayedTurnNumber % orderedEntities.length]
                : undefined;
              displayedTurnNumber += 1;
              return (
                <Fragment key={message.id}>
                  {cinematicSplit.cinematic && (
                    <article className="delta-cinematic-beat">
                      <span className="delta-log-number delta-cinematic-icon">{cinematicMarker()}</span>
                      <div className="message-body"><DeltaTurnText text={cinematicSplit.cinematic} /></div>
                    </article>
                  )}
                  <article className={`delta-log-row ${message.role === "user" ? "user" : "assistant"} ${relationshipForEntity(rowEntity)}`}>
                    <span className="delta-log-number">{String(displayedTurnNumber).padStart(2, "0")}</span>
                    <div className="message-body">{isLoading ? <LoadingSignal /> : <DeltaTurnText text={bodyText} />}</div>
                  </article>
                </Fragment>
              );
            })}
          </div>
        </div>
        <div className="delta-current-turn">Turn {currentTurnNumber}: {currentTurnLabel}</div>
        {session.awaitingPlayerRoll && <div className="delta-floating-prompt roll">{requiredRollText}</div>}
        {session.awaitingPlayerAction && !session.awaitingPlayerRoll && <div className="delta-floating-prompt">{session.actionPrompt || "What does the player do?"}</div>}
        {session.awaitingPlayerRoll && deltaDiceImages[session.requiredRollDie ?? 20] && (
          <button className="delta-roll-image" type="button" onClick={() => rollDeltaDie(session.requiredRollDie ?? 20)} aria-label={`Roll d${session.requiredRollDie ?? 20}`}>
            <img src={deltaDiceImages[session.requiredRollDie ?? 20]} alt={`d${session.requiredRollDie ?? 20}`} />
          </button>
        )}
        <section className="composer delta-composer">
          <button type="button" onClick={() => { if (session.awaitingPlayerRoll) return; setActiveTool(activeTool === "actions" ? undefined : "actions"); }} disabled={session.awaitingPlayerRoll} aria-label="Actions" title="Actions"><Zap size={18} /></button>
          <textarea ref={composerRef} value={body} onChange={(event) => setBody(event.target.value)} onFocus={() => keepComposerVisible(composerRef.current)} onClick={() => keepComposerVisible(composerRef.current)} disabled={inputDisabled} placeholder={session.awaitingPlayerRoll ? "Waiting on your roll..." : session.awaitingPlayerAction ? "Write your move" : currentTurn ? `Next: ${currentTurn.name}` : "Write Delta message"} rows={2} />
          <button className="send-button" onClick={send} disabled={inputDisabled}>Send</button>
          <button className="delta-next-button" type="button" onClick={nextTurn} disabled={!session.initiativeStarted || session.awaitingPlayerAction || session.awaitingPlayerRoll}>Next</button>
        </section>
        {activeTool === "actions" && !session.awaitingPlayerRoll && (
          <section className="delta-actions-panel">
            <div className="section-title">
              <h2>Actions</h2>
              <div className="split-actions">
                <button className={actionsEditMode ? "picked" : ""} onClick={() => setActionsEditMode(!actionsEditMode)} aria-label="Toggle action editing"><Pencil size={16} /></button>
                {actionsEditMode && <button onClick={() => addMacro(undefined, true)}>+ Menu</button>}
                {actionsEditMode && <button onClick={() => addMacro(undefined, false)}>+ Action</button>}
              </div>
            </div>
            {actionMacros.length === 0 && <p className="notice">Create text macros here. Selecting a macro inserts text into the composer without sending it.</p>}
            <DeltaActionTree macros={actionMacros} parentId={undefined} editMode={actionsEditMode} onChoose={chooseMacro} onAdd={addMacro} onEdit={editMacro} onDelete={deleteMacro} />
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
      {finishPacket && (
        <div className="modal-backdrop delta-finish-backdrop" onClick={() => undefined}>
          <section className="modal delta-finish-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-title">
              <h2>Finish Engagement</h2>
              <button className="icon-button" type="button" onClick={() => setFinishPacket(undefined)} aria-label="Close finish review"><X size={18} /></button>
            </div>
            <section className="stack">
              <h3>Outcome</h3>
              <MarkdownText text={finishPacket.outcomeSummary} />
            </section>
            {finishPacket.lootItems.length > 0 && (
              <section className="stack">
                <div className="section-title"><h3>Loot</h3><button type="button" onClick={pickUpAllLoot}>Pick Up All</button></div>
                <div className="loot-review-list">
                  {finishPacket.lootItems.map((item) => (
                    <div className="loot-review-row" key={item.id}>
                      <strong>{item.name}</strong>
                      <small>{item.pickedQuantity}/{item.quantity}</small>
                      <input
                        type="number"
                        min={0}
                        max={item.quantity}
                        value={item.pickedQuantity}
                        onChange={(event) => updateLootItem(item.id, { pickedQuantity: Number(event.target.value) })}
                      />
                      <button type="button" onClick={() => updateLootItem(item.id, { pickedQuantity: item.quantity })}>Pick Up</button>
                      <button type="button" onClick={() => updateLootItem(item.id, { pickedQuantity: 0 })}>Drop All</button>
                    </div>
                  ))}
                </div>
              </section>
            )}
            <div className="split-actions">
              <button className="send-button" type="button" onClick={() => continueFromFinish(false)}>Continue</button>
              <button type="button" onClick={() => setFinishPacket(undefined)}>Cancel</button>
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
            <div className="delta-messages">
              {previewMessages.map((message) => (
                <article className={`message ${message.role === "user" ? "user" : "assistant"}`} key={message.id}>
                  <div className="message-body"><MarkdownText text={message.body} /></div>
                </article>
              ))}
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
  macros: DeltaActionMacro[];
  parentId?: string;
  editMode: boolean;
  onChoose: (macro: DeltaActionMacro) => void;
  onAdd: (parentId: string | undefined, folder: boolean) => void;
  onEdit: (macro: DeltaActionMacro) => void;
  onDelete: (macro: DeltaActionMacro) => void;
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
  const [draft, setDraft] = useState("");
  const [pressTimer, setPressTimer] = useState<number>();
  async function remove(id: string) {
    if (!confirm("Delete this inventory log entry?")) return;
    await db.inventoryLogs.delete(id);
    setActiveLogId(undefined);
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
          {activeLogId === log.id && <div className="context-menu"><button onClick={() => { setDraft(log.sentence); setEditLogId(log.id); }}>Edit</button><button className="danger" onClick={() => remove(log.id)}>Delete</button></div>}
          {editLogId === log.id && <button onClick={() => save(log.id)}><Save size={16} /> Save</button>}
        </section>
      ))}
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
}) {
  const visibleProjects = props.projects.slice(0, 4);
  const [pressTimer, setPressTimer] = useState<number>();
  const [activeChatId, setActiveChatId] = useState<string>();
  function clearPressTimer() {
    if (pressTimer) window.clearTimeout(pressTimer);
    setPressTimer(undefined);
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
        <DrawerSection title="Projects" action={<button className="link-button" onClick={() => props.onRoute("projects")}>View All</button>}>
          <ProjectList projects={visibleProjects} selectedProjectId={props.selectedProjectId} onProject={props.onProject} />
        </DrawerSection>
        {props.selectedProjectId ? (
          <DrawerSection title={`Project Tools - ${props.projects.find((project) => project.id === props.selectedProjectId)?.name ?? "Project"}`}>
            {(["stars", "characters", "archives", "memories", "sourceFiles", "projectEdit"] as RouteName[]).map((route) => (
              <button className="nav-row" key={route} onClick={() => props.onRoute(route)}>
                {routeIcon(route)} {routeLabels[route]}
              </button>
            ))}
          </DrawerSection>
        ) : (
          <p className="muted-pad">Choose a project before starting a chat.</p>
        )}
        <DrawerSection title="Chats">
          {props.chats.length === 0 && <p className="muted-pad">No chats yet.</p>}
          {props.chats.map((chat) => (
            <div className="nav-chat" key={chat.id}>
              <button
                className={`nav-row ${chat.id === props.selectedChatId ? "active" : ""}`}
                onClick={() => props.onChat(chat.id)}
                onPointerDown={() => setPressTimer(window.setTimeout(() => setActiveChatId(chat.id), 520))}
                onPointerUp={clearPressTimer}
                onPointerLeave={clearPressTimer}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setActiveChatId(chat.id);
                }}
              >
                <MessageSquare size={18} /> {chat.title}
              </button>
              {activeChatId === chat.id && (
                <div className="row-context-menu">
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
  return (
    <section className="drawer-section">
      <div className="section-title"><h2>{title}</h2>{action}</div>
      {children}
    </section>
  );
}

function ProjectList({ projects, selectedProjectId, onProject }: { projects: Project[]; selectedProjectId?: string; onProject: (id: string) => void }) {
  return (
    <>
      {projects.map((project) => (
        <div className="nav-project" key={project.id}>
          <button
            className={`nav-row ${project.id === selectedProjectId ? "active" : ""}`}
            onClick={() => onProject(project.id)}
          >
            <ProjectIcon name={project.iconName} color={project.iconColor} /> {project.name}
          </button>
        </div>
      ))}
    </>
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
  onOpenDelta: (chat: Chat, startContext: string) => Promise<void>;
  onSettingsSaved: (modelId: string) => Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [contextOpen, setContextOpen] = useState(false);
  const [chatSettingsOpen, setChatSettingsOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
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
  const [compactionEnabled, setCompactionEnabled] = useState(settings.compactionEnabled ?? false);
  const [streamingEnabled, setStreamingEnabled] = useState(settings.streamingEnabled ?? false);
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
    setHistoryNoLimit(!settings.maxHistoryMessages);
    setCompactionEnabled(settings.compactionEnabled ?? false);
    setStreamingEnabled(settings.streamingEnabled ?? false);
    setAutoManageInventory(settings.autoManageInventory ?? false);
    setConfirmInventoryUpdates(settings.confirmInventoryUpdates ?? true);
    setAutoManageGear(settings.autoManageGear ?? false);
    setConfirmGearUpdates(settings.confirmGearUpdates ?? true);
  }, [settings, selectedModelId]);
  useEffect(() => {
    setInventoryEnabled(project?.inventoryEnabled ?? false);
    setGearEnabled(project?.gearEnabled ?? false);
  }, [project?.id, project?.inventoryEnabled, project?.gearEnabled]);
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
  async function saveChatSettings() {
    const timestamp = now();
    await db.settings.update("settings", {
      defaultModelId: draftModelId || undefined,
      temperature: optionalNumber(temperature),
      topP: optionalNumber(topP),
      maxTokens: optionalNumber(maxTokens),
      maxHistoryMessages: historyNoLimit ? undefined : optionalNumber(maxHistory),
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
    showSaved();
    await onSettingsSaved(draftModelId);
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
    const activeTools = [
      ...deltaImminentTools,
      ...characterTools,
      ...(project && project.memoryMode !== "manual" ? [...memoryTools] : []),
      ...(((project?.inventoryEnabled && autoManageInventory) || (project?.gearEnabled && autoManageGear)) ? [...inventoryTools] : []),
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
    if (!project || (!project.inventoryEnabled && !project.gearEnabled)) return "";
    const [items, logs, activeChat] = await Promise.all([
      db.inventoryItems.where("chatId").equals(chatId).toArray(),
      db.inventoryLogs.where("chatId").equals(chatId).reverse().sortBy("updatedAt"),
      db.chats.get(chatId)
    ]);
    const inventoryRows = project.inventoryEnabled
      ? items.filter((item) => item.kind === "inventory" && item.name.trim()).map((item) => `- ${item.name}: ${item.quantity}`)
      : [];
    const gearRows = project.gearEnabled
      ? items.filter((item) => item.kind === "gear" && item.name.trim()).map((item) => `- ${item.name}: ${item.quantity}`)
      : [];
    const managementLines = [
      project.inventoryEnabled && autoManageInventory ? "Inventory auto-management is enabled: use update_inventory_item for inventory or currency changes." : "",
      project.gearEnabled && autoManageGear ? "Gear auto-management is enabled: use update_inventory_item for gear changes." : "",
      (!autoManageInventory && project.inventoryEnabled) || (!autoManageGear && project.gearEnabled) ? "If auto-management is disabled for a listed section, use the listed inventory/gear as read-only context and do not claim you cannot access it." : "",
      "When using update_inventory_item, include the exact item or currency name, signed quantity delta, and a terse one-line log sentence. Use kind currency for the listed currency amount."
    ].filter(Boolean);
    const parts = [
      inventoryRows.length || project.currencyName ? `Inventory:\n${project.currencyName ? `- ${project.currencyName}: ${activeChat?.currencyAmount ?? 0}` : ""}${project.currencyName && inventoryRows.length ? "\n" : ""}${inventoryRows.join("\n") || ""}` : "",
      gearRows.length ? `Gear:\n${gearRows.join("\n")}` : "",
      logs.length ? `Recent inventory log:\n${logs.slice(0, 8).map((log) => `- ${log.sentence}`).join("\n")}` : "",
      managementLines.join("\n")
    ].filter(Boolean);
    return parts.length ? parts.join("\n\n") : "";
  }

  async function memoryContext(currentUserMessage: string, selectedHistory: Message[]) {
    if (!project || project.memoryMode === "manual") return "";
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
    return [
      `Memory instruction:\n${project.memoryInstruction}`,
      `Memory retrieval query:\n${query || "(none)"}`,
      memories.length
        ? `Retrieved memories for this reply only:\n${memories.map((memory) => `- ${memory.text}${memory.tags.length ? ` [${memory.tags.join(", ")}]` : ""}`).join("\n")}`
        : "Retrieved memories for this reply only:\n(none)"
    ].join("\n\n");
  }

  function shouldConfirmInventoryUpdate(kind: InventoryUpdateRequest["kind"]) {
    return kind === "gear" ? confirmGearUpdates : confirmInventoryUpdates;
  }

  function inventoryToolEnabled(kind: InventoryUpdateRequest["kind"]) {
    if (!project) return false;
    if (kind === "gear") return project.gearEnabled && autoManageGear;
    return project.inventoryEnabled && autoManageInventory;
  }

  function toolsEnabled(imageContextMessageId?: string) {
    return true;
  }


  async function openRouterRequest(payload: Record<string, unknown>) {
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
      return applyInventoryChange(projectId, chatId, update.kind, update.name, update.delta, update.logSentence);
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
    const logSentence = typeof args.logSentence === "string" ? args.logSentence.trim() : "";
    if (!name || !Number.isFinite(delta) || delta === 0) return { error: "A non-empty item name and non-zero delta are required." };
    if (!logSentence) return { error: "A one-line log sentence is required." };
    const update: InventoryUpdateRequest = {
      id: uid(),
      kind,
      name,
      delta,
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
    const proposal: DeltaImminentProposal = {
      brief,
      playerCharacterName: typeof args.playerCharacterName === "string" ? args.playerCharacterName.trim() : "",
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

  async function resolveToolCalls(messagesToSend: OpenRouterMessage[], toolLog: string[], inventoryUpdates: InventoryUpdateRequest[], chatId: string, sourceMessageIds: string[], imageContextMessageId?: string) {
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

  async function completeWithTools(messagesToSend: OpenRouterMessage[], toolLog: string[], inventoryUpdates: InventoryUpdateRequest[], chatId: string, sourceMessageIds: string[], imageContextMessageId?: string) {
    const resolved = await resolveToolCalls(messagesToSend, toolLog, inventoryUpdates, chatId, sourceMessageIds, imageContextMessageId);
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
    if (!activeProject) return { brief: command, playerCharacterName: "" };
    const history = await db.messages
      .where("[chatId+branchId+sequence]")
      .between([activeChat.id, activeChat.activeBranchId, Dexie.minKey], [activeChat.id, activeChat.activeBranchId, Dexie.maxKey])
      .toArray();
    const recent = history.sort((a, b) => a.sequence - b.sequence).slice(-8);
    const fallbackSource = [...recent].reverse().find((message) => message.role === "assistant")?.body || command;
    const fallbackBrief = fallbackSource.length > 1400 ? `${fallbackSource.slice(0, 1400).trim()}...` : fallbackSource;
    if (!settings.apiKey?.trim() || !draftModelId) return { brief: fallbackBrief, playerCharacterName: "" };
    try {
      const response = await openRouterRequest({
        model: draftModelId,
        messages: [
          {
            role: "system",
            content: [
              "Create a concise immersive Delta Brief from the recent chat context. Return only valid JSON.",
              "Shape: {\"brief\":\"\",\"playerCharacterName\":\"\",\"avoidLabel\":\"\",\"avoidPrompt\":\"\"}",
              "brief: short in-world setup with who, what, where, why, objective, named allies, and named hostiles. Do not speak as an assistant. Do not ask a question.",
              "playerCharacterName: the likely player-controlled character name if the context implies one; otherwise use the lead/protagonist character name; otherwise empty.",
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
      return { brief: packet.brief || fallbackBrief, playerCharacterName: packet.playerCharacterName, avoidLabel: packet.avoidLabel, avoidPrompt: packet.avoidPrompt };
    } catch {
      return { brief: fallbackBrief, playerCharacterName: "" };
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
      const brief = await createDeltaBrief(text, deltaChat);
      await addMessage(deltaChat.id, deltaChat.activeBranchId, "assistant", `### Δ Delta mode imminent...\n\n${brief.brief}`).then((message) => db.messages.update(message.id, {
        deltaBrief: {
          status: "pending",
          brief: brief.brief,
          playerCharacterName: brief.playerCharacterName,
          avoidLabel: brief.avoidLabel,
          avoidPrompt: brief.avoidPrompt
        },
        updatedAt: now()
      }));
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
      await onChatCreated(chatId);
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
      const historyLimit = historyNoLimit ? undefined : optionalNumber(maxHistory);
      const selectedHistory = historyLimit ? orderedHistory.slice(-historyLimit) : orderedHistory;
      const memoryDetails = await memoryContext(text, selectedHistory);
      const systemParts = [
        `Project: ${project.name}`,
        "Delta Mode boundary: the main chat must not run structured fights, hostile standoffs, tactical engagements, mission commitments, or combat-like confrontations as ordinary roleplay once they become imminent. When the current reply would initiate or clearly commit to that kind of engagement, call prepare_delta_engagement with a short immersive setup instead of continuing the scene as normal chat. Use this only when the engagement is imminent, not for ordinary tension.",
        includeInstructions && project.instructions ? `Project instructions:\n${project.instructions}` : "",
        includeWorld && project.worldSetting ? `World setting:\n${project.worldSetting}` : "",
        characterDetails,
        compactionEnabled && activeChat?.compactionMemory ? `Compaction memory:\n${activeChat.compactionMemory}` : "",
        sourceFiles.length ? `Source files:\n${sourceFiles.map((file) => `# ${file.name}\n${file.textContent}`).join("\n\n")}` : "",
        attachedFileDetails,
        images.length ? "An image is attached to the latest user message. First call save_image_context exactly once with a detailed concise visual extraction. It is hidden from the user. Then answer the user normally from the image." : "",
        memoryDetails,
        inventoryDetails
      ].filter(Boolean);
      const historyContent = chatHistoryContent(selectedHistory, userMessageId, images);
      const requestMessages: OpenRouterMessage[] = [
        ...(systemParts.length ? [{ role: "system" as const, content: systemParts.join("\n\n") }] : []),
        ...historyContent
      ];
      const toolLog: string[] = [];
      const inventoryUpdates: InventoryUpdateRequest[] = [];
      const requestInfo = {
        settings: [
          `Model: ${draftModelId}`,
          `Temperature: ${temperature || "0"}`,
          `Top P: ${topP || "0"}`,
          `Max output: ${maxTokens || "no limit"}`,
          historyNoLimit ? "History: no limit" : `History: ${maxHistory || "not set"} messages`,
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
      await onRefresh();
      try {
        if (toolsEnabled(images.length ? userMessageId : undefined)) {
          const completed = await completeWithTools(requestMessages, toolLog, inventoryUpdates, chatId, selectedHistory.map((message) => message.id), images.length ? userMessageId : undefined);
          const deltaProposal = completed.deltaImminentProposal;
          await db.messages.update(reply.id, {
            body: deltaProposal ? `### Δ Delta mode imminent...\n\n${deltaProposal.brief}` : completed.replyText || "(No response text returned.)",
            deltaBrief: deltaProposal ? {
              status: "pending",
              brief: deltaProposal.brief,
              playerCharacterName: deltaProposal.playerCharacterName,
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
          return;
        }
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
          await db.messages.update(reply.id, { body: replyText || "(No response text returned.)", inputTokens, outputTokens: outputTokens ?? estimateTokens(replyText), estimatedTokens: !outputTokens, status: "complete", updatedAt: now() });
        } else {
          const json = await response.json() as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
          const replyText = json.choices?.[0]?.message?.content ?? "";
          await db.messages.update(reply.id, {
            body: replyText || "(No response text returned.)",
            inputTokens: json.usage?.prompt_tokens,
            outputTokens: json.usage?.completion_tokens ?? estimateTokens(replyText),
            estimatedTokens: !json.usage?.completion_tokens,
            status: "complete",
            updatedAt: now()
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        requestFailed = true;
        setAttachmentError(message.includes("\"code\":401") ? "OpenRouter rejected the saved API key for this request. Re-save your OpenRouter key in API Settings, then resend the attached message." : message);
        await db.messages.update(reply.id, {
          body: `OpenRouter request failed: ${message}`,
          error: message,
          status: "failed",
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
    await db.transaction("rw", db.messages, db.stars, async () => {
      await db.messages.update(message.id, {
        body: clean,
        inputTokens: message.role === "user" ? estimateTokens(clean) : message.inputTokens,
        outputTokens: message.role === "assistant" ? estimateTokens(clean) : message.outputTokens,
        estimatedTokens: true,
        updatedAt: timestamp
      });
      const star = await db.stars.where("messageId").equals(message.id).first();
      if (star) await db.stars.update(star.id, { bodyCopy: clean, updatedAt: timestamp });
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
    if (!confirm("Regenerate from this user message? Later messages in this branch will be replaced.")) return;
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
    const historyLimit = historyNoLimit ? undefined : optionalNumber(maxHistory);
    const limitedHistory = historyLimit ? orderedHistory.slice(-historyLimit) : orderedHistory;
    const selectedHistory = limitedHistory.some((row) => row.id === promptMessage.id) ? limitedHistory : [...limitedHistory, promptMessage].sort((a, b) => a.sequence - b.sequence);
    const memoryDetails = await memoryContext(promptMessage.body, selectedHistory);
    const resendImages = promptMessage.attachmentContext ? [] : await storedMessageImages(promptMessage.id);
    const systemParts = [
      `Project: ${project.name}`,
      "Delta Mode boundary: the main chat must not run structured fights, hostile standoffs, tactical engagements, mission commitments, or combat-like confrontations as ordinary roleplay once they become imminent. When the current reply would initiate or clearly commit to that kind of engagement, call prepare_delta_engagement with a short immersive setup instead of continuing the scene as normal chat. Use this only when the engagement is imminent, not for ordinary tension.",
      includeInstructions && project.instructions ? `Project instructions:\n${project.instructions}` : "",
      includeWorld && project.worldSetting ? `World setting:\n${project.worldSetting}` : "",
      characterDetails,
      compactionEnabled && activeChat?.compactionMemory ? `Compaction memory:\n${activeChat.compactionMemory}` : "",
      sourceFiles.length ? `Source files:\n${sourceFiles.map((file) => `# ${file.name}\n${file.textContent}`).join("\n\n")}` : "",
      resendImages.length ? "An image is attached to the latest user message. First call save_image_context exactly once with a detailed concise visual extraction. It is hidden from the user. Then answer the user normally from the image." : "",
      memoryDetails,
      inventoryDetails
    ].filter(Boolean);
    const historyContent = chatHistoryContent(selectedHistory, promptMessage.id, resendImages);
    const requestMessages: OpenRouterMessage[] = [
      ...(systemParts.length ? [{ role: "system" as const, content: systemParts.join("\n\n") }] : []),
      ...historyContent
    ];
    const toolLog: string[] = [];
    const inventoryUpdates: InventoryUpdateRequest[] = [];
    const requestInfo = {
      settings: [
        `Model: ${draftModelId}`,
        `Temperature: ${temperature || "0"}`,
        `Top P: ${topP || "0"}`,
        `Max output: ${maxTokens || "no limit"}`,
        historyNoLimit ? "History: no limit" : `History: ${maxHistory || "not set"} messages`,
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
        const completed = await completeWithTools(requestMessages, toolLog, inventoryUpdates, chatId, selectedHistory.map((message) => message.id), resendImages.length ? promptMessage.id : undefined);
        const deltaProposal = completed.deltaImminentProposal;
        await db.messages.update(reply.id, {
          body: deltaProposal ? `### Δ Delta mode imminent...\n\n${deltaProposal.brief}` : completed.replyText || "(No response text returned.)",
          deltaBrief: deltaProposal ? {
            status: "pending",
            brief: deltaProposal.brief,
            playerCharacterName: deltaProposal.playerCharacterName,
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
        return;
      }
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
        await db.messages.update(reply.id, { body: replyText || "(No response text returned.)", inputTokens, outputTokens: outputTokens ?? estimateTokens(replyText), estimatedTokens: !outputTokens, status: "complete", updatedAt: now() });
      } else {
        const json = await response.json() as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
        const replyText = json.choices?.[0]?.message?.content ?? "";
        await db.messages.update(reply.id, {
          body: replyText || "(No response text returned.)",
          inputTokens: json.usage?.prompt_tokens,
          outputTokens: json.usage?.completion_tokens ?? estimateTokens(replyText),
          estimatedTokens: !json.usage?.completion_tokens,
          status: "complete",
          updatedAt: now()
        });
      }
    } catch (error) {
      await db.messages.update(reply.id, {
        body: "OpenRouter request failed.",
        error: error instanceof Error ? error.message : "Unknown error",
        status: "failed",
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
          playerCharacterName: brief.playerCharacterName,
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
    const brief = message.deltaBrief;
    if (!brief || brief.status !== "pending") return;
    const deltaChat = await db.chats.get(message.chatId);
    if (!deltaChat) return;
    const timestamp = now();
    await db.messages.update(message.id, {
      deltaBrief: { ...brief, status: "started", startedAt: timestamp },
      updatedAt: timestamp
    });
    await onRefresh();
    await onOpenDelta(deltaChat, [
      `DELTA BRIEF:\n${brief.brief}`,
      brief.playerCharacterName ? `PLAYER CHARACTER:\n${brief.playerCharacterName}` : ""
    ].filter(Boolean).join("\n\n"));
  }

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
          <MessageRow
            key={message.id}
            projectId={project.id}
            message={message}
            expanded={expandedMessageId === message.id}
            onExpand={() => setExpandedMessageId(expandedMessageId === message.id ? undefined : message.id)}
            onEdit={editMessage}
            onResend={resendFromMessage}
            onInventoryUpdateAction={handleInventoryUpdateAction}
            onBeginDeltaBrief={beginDeltaBrief}
            onAvoidDeltaBrief={avoidDeltaBrief}
            deltaLocked={deltaLocked}
            onOpenChatSettings={() => { setContextOpen(true); setChatSettingsOpen(true); }}
            onRefresh={onRefresh}
          />
        ))}
      </div>
      <section className={`composer ${deltaLocked ? "locked" : ""}`}>
        {deltaLocked && <div className="composer-lock">Resolve engagement to unlock chat.</div>}
        {contextOpen && (
          <div className="context-popover">
            <button className="drawer-action-row" type="button" onClick={() => setChatSettingsOpen(!chatSettingsOpen)}>
              <Settings size={18} /> Chat settings
            </button>
            {chatSettingsOpen && (
              <div className="chat-settings-panel">
                <button className="model-row" type="button" onClick={() => setModelMenuOpen(!modelMenuOpen)}>
                  <span>Current model</span>
                  <strong>{models.find((model) => model.modelId === draftModelId)?.cosmeticName || draftModelId || "Choose model"}</strong>
                </button>
                {modelMenuOpen && (
                  <div className="model-menu">
                    {models.length === 0 && <p className="muted-pad">Add models in API settings first.</p>}
                    {models.map((model) => (
                      <button
                        key={model.modelId}
                        className={model.modelId === draftModelId ? "picked" : ""}
                        type="button"
                        onClick={() => {
                          setDraftModelId(model.modelId);
                          setModelMenuOpen(false);
                        }}
                      >
                        <span>{model.cosmeticName}</span>
                        <small>{model.modelId}</small>
                      </button>
                    ))}
                  </div>
                )}
                <label className="compact-check"><input type="checkbox" checked={includeWorld} onChange={(event) => setIncludeWorld(event.target.checked)} /> World Setting</label>
                <label className="compact-check"><input type="checkbox" checked={includeInstructions} onChange={(event) => setIncludeInstructions(event.target.checked)} /> Instructions</label>
                <label className="compact-check"><input type="checkbox" checked={includeCharacters} onChange={(event) => setIncludeCharacters(event.target.checked)} /> Characters</label>
                <label className="compact-check"><input type="checkbox" checked={includeSourceFiles} onChange={(event) => setIncludeSourceFiles(event.target.checked)} /> Source files</label>
                <label className="compact-check"><input type="checkbox" checked={inventoryEnabled} onChange={(event) => setInventoryEnabled(event.target.checked)} /> Enable inventory</label>
                {inventoryEnabled && (
                  <div className="inline-setting-pair">
                    <label className="compact-check"><input type="checkbox" checked={autoManageInventory} onChange={(event) => setAutoManageInventory(event.target.checked)} /> Auto manage Inventory</label>
                    <label className="compact-check"><input type="checkbox" checked={confirmInventoryUpdates} onChange={(event) => setConfirmInventoryUpdates(event.target.checked)} /> Use confirmation</label>
                  </div>
                )}
                <label className="compact-check"><input type="checkbox" checked={gearEnabled} onChange={(event) => setGearEnabled(event.target.checked)} /> Enable gear</label>
                {gearEnabled && (
                  <div className="inline-setting-pair">
                    <label className="compact-check"><input type="checkbox" checked={autoManageGear} onChange={(event) => setAutoManageGear(event.target.checked)} /> Auto manage Gear</label>
                    <label className="compact-check"><input type="checkbox" checked={confirmGearUpdates} onChange={(event) => setConfirmGearUpdates(event.target.checked)} /> Use confirmation</label>
                  </div>
                )}
                <label className="compact-check"><input type="checkbox" checked={compactionEnabled} onChange={(event) => setCompactionEnabled(event.target.checked)} /> Compaction memory</label>
                <button onClick={() => onRoute("compaction")}><BookOpen size={18} /> Open compaction memory</button>
                <label className="compact-check"><input type="checkbox" checked={streamingEnabled} onChange={(event) => setStreamingEnabled(event.target.checked)} /> Streaming</label>
                <label className="range-row"><span>Temperature <b>{temperature || "0"}</b></span><input type="range" min={0} max={2} step={0.05} value={temperature || "0"} onChange={(event) => setTemperature(event.target.value)} /></label>
                <label className="range-row"><span>Top P <b>{topP || "0"}</b></span><input type="range" min={0} max={1} step={0.05} value={topP || "0"} onChange={(event) => setTopP(event.target.value)} /></label>
                <label>Max output tokens<input type="number" min={1} max={16000} value={maxTokens} placeholder="no limit" onChange={(event) => setMaxTokens(event.target.value)} /></label>
                <label className="compact-check"><input type="checkbox" checked={historyNoLimit} onChange={(event) => setHistoryNoLimit(event.target.checked)} /> No message history limit</label>
                {!historyNoLimit && <label>Message history limit<input type="number" min={10} max={500} value={maxHistory} onChange={(event) => setMaxHistory(event.target.value)} /></label>}
                <div className="split-actions">
                  <button onClick={saveChatSettings}><Save size={18} /> Save chat settings</button>
                  {saved && <span className="save-status">Saved</span>}
                </div>
              </div>
            )}
            <button className="drawer-action-row" type="button" onClick={() => imagePickerRef.current?.click()}><ImageIcon size={18} /> Attach Image</button>
            <button className="drawer-action-row" type="button" onClick={() => filePickerRef.current?.click()}><Paperclip size={18} /> Attach File</button>
            <input ref={filePickerRef} className="visually-hidden" type="file" multiple onChange={(event) => { chooseFiles(event.target.files); event.currentTarget.value = ""; }} />
            <input ref={imagePickerRef} className="visually-hidden" type="file" accept="image/*" multiple onChange={(event) => { chooseImages(event.target.files); event.currentTarget.value = ""; }} />
          </div>
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
  onExpand: () => void;
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
  async function updateDeltaPlayerCharacter(playerCharacterName: string) {
    const brief = message.deltaBrief;
    if (!brief) return;
    await db.messages.update(message.id, {
      deltaBrief: { ...brief, playerCharacterName },
      updatedAt: now()
    });
    await onRefresh();
  }
  return (
    <>
      <article className={`message ${message.role}`} onClick={onExpand}>
        {expanded && message.role === "assistant" && message.modelId && <div className="message-model">{message.modelId}</div>}
        {message.role === "user" && <MessageImageAttachments messageId={message.id} />}
        <div className="message-body">{message.status === "pending" && message.body.trim() === "..." ? <LoadingSignal /> : <MarkdownText text={message.body} />}</div>
        {message.deltaBrief?.status === "pending" && (
          <div className="delta-brief-panel" onClick={(event) => event.stopPropagation()}>
            <div className="delta-brief-player">
              <select
                value={message.deltaBrief.playerCharacterName || ""}
                onChange={(event) => void updateDeltaPlayerCharacter(event.target.value)}
                aria-label="Player character for Delta engagement"
              >
                <option value="">Player character</option>
                {deltaCharacters.map((character) => <option key={character.id} value={character.name}>{character.name}</option>)}
              </select>
              <button className="icon-button" type="button" onClick={() => void loadDeltaCharacters()} aria-label="Refresh character list" title="Refresh characters"><RefreshCw size={14} /></button>
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
          <button aria-label="Message info" title="Info" onClick={(event) => { event.stopPropagation(); setInfoOpen(true); }}><FileText size={16} /></button>
          <span>{formatMessageDate(message.createdAt)}</span>
          <span>{message.inputTokens ?? message.outputTokens ?? estimateTokens(message.body)}t</span>
          <button className="resend" aria-label="Resend message" title={deltaLocked ? "Resolve engagement to unlock resend" : "Resend"} disabled={deltaLocked} onClick={(event) => { event.stopPropagation(); resend(); }}><RefreshCw size={16} /></button>
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
              {message.role === "user" && <button onClick={saveEditAndResend} disabled={deltaLocked}><RefreshCw size={18} /> Save & resend</button>}
              <button onClick={() => setEditOpen(false)}>Cancel</button>
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
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="star-modal message-info-modal" onClick={(event) => event.stopPropagation()}>
        <div className="section-title">
          <h2>Message Info</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close message info"><X size={18} /></button>
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
          <div className="stack">
            <h2>Settings Used</h2>
            {message.requestInfo.settings.map((item) => <p key={item}>{item}</p>)}
            <h2>Toggles</h2>
            {message.requestInfo.toggles.map((item) => <p key={item}>{item}</p>)}
            <h2>Tool Calls</h2>
            {message.requestInfo.toolCalls.map((item) => <p key={item}>{item}</p>)}
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
    if (project.locked) return;
    const count = await db.messages.where("chatId").anyOf((await db.chats.where("projectId").equals(project.id).primaryKeys()) as string[]).count();
    const ok = count > 0 ? prompt(`Deleting this project removes chats, messages, stars, archives, characters, and memories. Type DELETE ${project.name} to continue.`) === `DELETE ${project.name}` : confirm("Delete this project and its associated records?");
    if (!ok) return;
    await db.transaction("rw", [db.projects, db.chats, db.branches, db.messages, db.stars, db.attachments, db.archives, db.archiveEntries, db.characters, db.characterBonuses, db.memories, db.inventoryItems, db.inventoryLogs, db.deltaSessions, db.deltaMessages, db.deltaEntities, db.deltaAllyCache, db.deltaActionMacros], async () => {
      const chatIds = (await db.chats.where("projectId").equals(project.id).primaryKeys()) as string[];
      const archiveIds = (await db.archives.where("projectId").equals(project.id).primaryKeys()) as string[];
      const characterIds = (await db.characters.where("projectId").equals(project.id).primaryKeys()) as string[];
      const messageIds = chatIds.length ? (await db.messages.where("chatId").anyOf(chatIds).primaryKeys()) as string[] : [];
      const attachmentIds = messageIds.length
        ? (await db.attachments.filter((attachment) => attachment.ownerType === "message" && messageIds.includes(attachment.ownerId)).primaryKeys()) as string[]
        : [];
      const deltaSessionIds = chatIds.length ? (await db.deltaSessions.where("chatId").anyOf(chatIds).primaryKeys()) as string[] : [];
      if (attachmentIds.length) await db.attachments.bulkDelete(attachmentIds);
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
      await db.characters.where("projectId").equals(project.id).delete();
      await db.memories.where("projectId").equals(project.id).delete();
      if (deltaSessionIds.length) {
        await db.deltaMessages.where("sessionId").anyOf(deltaSessionIds).delete();
        await db.deltaEntities.where("sessionId").anyOf(deltaSessionIds).delete();
      }
      if (deltaSessionIds.length) await db.deltaSessions.where("id").anyOf(deltaSessionIds).delete();
      await db.projects.delete(project.id);
    });
    await onRefresh();
  }
  return (
    <section className={`item-card ${active ? "selected" : ""}`}>
      <button className="item-main" onClick={() => onSelect(project.id)}>
        <ProjectIcon name={project.iconName} color={project.iconColor} size={28} />
        <span>{project.name}</span>{project.locked && <small>Locked</small>}
      </button>
      <div className="card-actions">
        <button onClick={() => onEdit(project.id)}><Edit3 size={18} /> Edit</button>
        <button disabled={index === 0} onClick={() => move(-1)}>Move Up</button>
        <button disabled={index === total - 1} onClick={() => move(1)}>Move Down</button>
        {!project.locked && <button className="danger" onClick={remove}><Trash2 size={18} /> Delete</button>}
      </div>
    </section>
  );
}

function ProjectEditPage({ project, onRefresh, onDone }: { project: Project; onRefresh: () => Promise<void>; onDone: () => void }) {
  const [draft, setDraft] = useState(project);
  const [tab, setTab] = useState<"general" | "delta">("general");
  const [deltaStats, setDeltaStats] = useState<AbilityScores>(cleanAbilityScores(project.deltaDefaultNpcStats));
  const [deltaPrefixes, setDeltaPrefixes] = useState<DeltaPrefixTemplate[]>(effectiveDeltaPrefixes(project.deltaPrefixes));
  const [deltaBases, setDeltaBases] = useState<DeltaBaseTemplate[]>(deltaBaseDraft(project.deltaBases));
  const [deltaJobs, setDeltaJobs] = useState<DeltaJobTemplate[]>(project.deltaJobs ?? defaultDeltaJobs());
  const [deltaSystemPrompt, setDeltaSystemPrompt] = useState(project.deltaSystemPrompt ?? defaultDeltaSystemPrompt);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [saved, showSaved] = useSavedNotice();
  const [deltaSaved, showDeltaSaved] = useSavedNotice();
  useEffect(() => {
    setDraft(project);
    setDeltaStats(cleanAbilityScores(project.deltaDefaultNpcStats));
    setDeltaPrefixes(effectiveDeltaPrefixes(project.deltaPrefixes));
    setDeltaBases(deltaBaseDraft(project.deltaBases));
    setDeltaJobs(project.deltaJobs ?? defaultDeltaJobs());
    setDeltaSystemPrompt(project.deltaSystemPrompt ?? defaultDeltaSystemPrompt);
  }, [project.id]);
  async function save() {
    await db.projects.put({ ...draft, updatedAt: now() });
    showSaved();
    await onRefresh();
  }
  async function saveDeltaPatch(patch: Pick<Project, "deltaDefaultNpcStats"> | Pick<Project, "deltaPrefixes"> | Pick<Project, "deltaBases"> | Pick<Project, "deltaJobs"> | Pick<Project, "deltaSystemPrompt">) {
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
        <button className="project-icon-edit" onClick={() => setShowIconPicker(!showIconPicker)} aria-label="Change project icon">
          <ProjectIcon name={draft.iconName} color={draft.iconColor} size={36} />
          <span>{draft.name}</span>
        </button>
        {showIconPicker && (
          <>
            <div className="icon-grid">
              {projectIcons.map(({ name, label }) => (
                <button key={name} className={draft.iconName === name ? "picked" : ""} onClick={() => setDraft({ ...draft, iconName: name })} aria-label={label}>
                  <ProjectIcon name={name} color={draft.iconColor} />
                </button>
              ))}
            </div>
            <ColorSwatches value={draft.iconColor} onChange={(iconColor) => setDraft({ ...draft, iconColor })} />
          </>
        )}
        <label>Name<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label className="compact-check"><input type="checkbox" checked={draft.locked} onChange={(event) => setDraft({ ...draft, locked: event.target.checked })} /> Lock project editing</label>
        <label className="compact-check"><input type="checkbox" checked={draft.inventoryEnabled} onChange={(event) => setDraft({ ...draft, inventoryEnabled: event.target.checked })} /> Enable inventory</label>
        {draft.inventoryEnabled && (
          <>
            <label>Currency name<input value={draft.currencyName ?? ""} onChange={(event) => setDraft({ ...draft, currencyName: event.target.value })} placeholder="currency name" /></label>
          </>
        )}
        <label className="compact-check"><input type="checkbox" checked={draft.gearEnabled} onChange={(event) => setDraft({ ...draft, gearEnabled: event.target.checked })} /> Enable gear</label>
        <textarea value={draft.instructions} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} placeholder="Project Instructions" />
        <textarea value={draft.worldSetting} onChange={(event) => setDraft({ ...draft, worldSetting: event.target.value })} placeholder="World Setting" />
        <label>Memory mode <select value={draft.memoryMode} onChange={(event) => setDraft({ ...draft, memoryMode: event.target.value as Project["memoryMode"] })}><option value="manual">Manual</option><option value="automatic">Automatic</option><option value="approval">Automatic with Approval</option></select></label>
        <textarea value={draft.memoryInstruction} onChange={(event) => setDraft({ ...draft, memoryInstruction: event.target.value })} />
        <div className="split-actions"><button onClick={save}><Save size={18} /> Save</button><button onClick={onDone}>Done</button>{saved && <span className="save-status">Saved</span>}</div>
      </section>
      )}
      {tab === "delta" && (
        <section className="item-card stack delta-settings-editor">
          <section className="panel stack">
            <div className="section-title"><h2>System Prompt</h2></div>
            <p className="notice">This is the full Delta Mode system prompt for this project. Revert restores Mirror's default Delta behavior.</p>
            <textarea className="large-entry" value={deltaSystemPrompt} onChange={(event) => setDeltaSystemPrompt(event.target.value)} />
            <div className="split-actions">
              <button onClick={() => saveDeltaPatch({ deltaSystemPrompt: deltaSystemPrompt.trim() || defaultDeltaSystemPrompt })}><Save size={18} /> Save System Prompt</button>
              <button onClick={revertDeltaSystemPrompt}>Revert to default</button>
              {deltaSaved && <span className="save-status">Saved</span>}
            </div>
          </section>

          <section className="panel stack">
            <div className="section-title"><h2>Default NPC Values</h2></div>
            <p className="notice">Starting stats for generated Delta characters that do not have saved character stats.</p>
            <AbilityScoreEditor value={deltaStats} onChange={setDeltaStats} />
            <div className="split-actions"><button onClick={() => saveDeltaPatch({ deltaDefaultNpcStats: cleanAbilityScores(deltaStats) })}><Save size={18} /> Save Default NPC Values</button>{deltaSaved && <span className="save-status">Saved</span>}</div>
          </section>

          <section className="panel stack">
            <div className="section-title"><h2>PREFIXES</h2></div>
            <p className="notice">PREFIX templates are the first part of [PREFIX]-[BASE] [JOB].</p>
            <DeltaPrefixEditor value={deltaPrefixes} onChange={setDeltaPrefixes} />
            <div className="split-actions">
              <button onClick={() => setDeltaPrefixes([...deltaPrefixes, { id: uid(), label: "", statModifiers: {}, notes: "" }])}><Plus size={18} /> Add PREFIX</button>
              <button onClick={() => saveDeltaPatch({ deltaPrefixes: cleanDeltaPrefixes(deltaPrefixes) })}><Save size={18} /> Save PREFIXES</button>
              {deltaSaved && <span className="save-status">Saved</span>}
            </div>
          </section>

          <section className="panel stack">
            <div className="section-title"><h2>BASES</h2></div>
            <p className="notice">BASE templates are modifiers applied on top of Default NPC Values, not full repeated stat blocks.</p>
            <DeltaBaseEditor value={deltaBases} onChange={setDeltaBases} />
            <div className="split-actions">
              <button onClick={() => setDeltaBases([...deltaBases, { id: uid(), label: "", statModifiers: {}, notes: "" }])}><Plus size={18} /> Add BASE</button>
              <button onClick={() => saveDeltaPatch({ deltaBases: cleanDeltaBases(deltaBases) })}><Save size={18} /> Save BASES</button>
              {deltaSaved && <span className="save-status">Saved</span>}
            </div>
          </section>

          <section className="panel stack">
            <div className="section-title"><h2>JOBS</h2></div>
            <p className="notice">Upload one or more .txt files. Each file is one JOB category; each line must be JOB STR DEX CON INT WIS CHA.</p>
            <DeltaJobImport value={deltaJobs} onChange={setDeltaJobs} />
            <div className="split-actions"><button onClick={() => saveDeltaPatch({ deltaJobs: cleanDeltaJobs(deltaJobs) })}><Save size={18} /> Save JOBS</button>{deltaSaved && <span className="save-status">Saved</span>}</div>
          </section>
          <div className="split-actions"><button onClick={onDone}>Done</button></div>
        </section>
      )}
    </Page>
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
          <div className="form-row">
            <label>ID<input value={item.id} onChange={(event) => update(index, { id: event.target.value })} /></label>
            <label>Label<input value={item.label} onChange={(event) => update(index, { label: event.target.value.toUpperCase() })} placeholder="PREFIX" /></label>
            <button className="danger" onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={16} /> Remove</button>
          </div>
          <AbilityModifierEditor value={item.statModifiers} onChange={(statModifiers) => update(index, { statModifiers })} />
          <label>Notes<textarea value={item.notes ?? ""} onChange={(event) => update(index, { notes: event.target.value })} /></label>
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
          <div className="form-row">
            <label>ID<input value={item.id} onChange={(event) => update(index, { id: event.target.value })} /></label>
            <label>Label<input value={item.label} onChange={(event) => update(index, { label: event.target.value.toUpperCase() })} placeholder="BASE" /></label>
            <label>HP bonus<input type="number" value={item.hpBonus ?? 0} onChange={(event) => update(index, { hpBonus: Number(event.target.value) })} /></label>
            <button className="danger" onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={16} /> Remove</button>
          </div>
          <AbilityModifierEditor value={item.statModifiers} onChange={(statModifiers) => update(index, { statModifiers })} />
          <label>Notes<textarea value={item.notes ?? ""} onChange={(event) => update(index, { notes: event.target.value })} /></label>
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
  const categories = jobCategories(value);
  return (
    <div className="delta-template-list">
      <label className="file-pick"><Upload size={18} /> Import JOB .txt files<input type="file" accept=".txt,text/plain" multiple onChange={(event) => void importFiles(event.target.files)} /></label>
      {errors.length > 0 && (
        <div className="import-errors">
          {errors.map((error) => <p key={error}>{error}</p>)}
        </div>
      )}
      {categories.length === 0 && <p className="notice">No JOB categories are set up for this project.</p>}
      {categories.map(([category, count]) => (
        <section className="delta-category-row" key={category}>
          <span>{category}</span>
          <small>{count} JOB{count === 1 ? "" : "S"}</small>
          <button className="danger" onClick={() => deleteCategory(category)}><Trash2 size={16} /> Delete category</button>
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
          <div className="swatches">{accents.map((accent) => <button key={accent.name} className={draft.accent === accent.name ? "picked" : ""} style={{ background: accent.value }} onClick={() => setDraft({ ...draft, accent: accent.name })} />)}</div>
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
          <div className="split-actions"><button onClick={save}><Save size={18} /> Save settings</button>{saved && <span className="save-status">Saved</span>}</div>
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
      <div className="split-actions"><button onClick={() => setShow(!show)}>{show ? "Hide" : "Show"}</button><button onClick={save}><Save size={18} /> Save</button><button className="danger" onClick={remove}>Remove</button>{saved && <span className="save-status">Saved</span>}</div>
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
    await createMemory(projectId, text, splitTags(tags));
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
      <button onClick={add}><Plus size={18} /> Add memory</button>
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
        <div className="split-actions"><button onClick={save}><Save size={18} /> Save compaction memory</button>{saved && <span className="save-status">Saved</span>}</div>
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
        <button onClick={saveDraft}>Save edit</button>
        <button className="danger" onClick={reject}><Trash2 size={18} /> Reject</button>
        {saved && <span className="save-status">Saved</span>}
      </div>
    </section>
  );
}

function SourceFilesPage({ project }: { project?: Project }) {
  const [files, setFiles] = useState<{ id: string; name: string; size: number; mimeType: string }[]>([]);
  async function load() {
    if (project) setFiles(await db.sourceFiles.where("projectId").equals(project.id).reverse().sortBy("updatedAt"));
  }
  useEffect(() => { load(); }, [project?.id]);
  if (!project) return <EmptyState title="No project selected" body="Choose a project to manage source files." />;
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
    <Page>
      <label className="file-pick"><Upload size={18} /> Upload source files<input type="file" multiple onChange={(event) => add(event.target.files)} /></label>
      {files.map((file) => <section className="item-card mini-row" key={file.id}><span>{file.name}</span><small>{Math.ceil(file.size / 1024)} KB</small><button className="danger" onClick={() => remove(file.id)}><Trash2 size={16} /> Remove</button></section>)}
    </Page>
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
      {imageUrl ? <img src={imageUrl} alt="" /> : <UserRound size={48} />}
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
  const valid = validatePointBuy(draft);
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
    await db.characters.put({ ...draft, normalisedName: normaliseTag(draft.name), updatedAt: now() });
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
    await db.transaction("rw", [db.characters, db.characterBonuses, db.attachments], async () => {
      await db.characterBonuses.where("characterId").equals(character.id).delete();
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
          <label>Identity: Gender<input value={draft.gender} onChange={(event) => setDraft({ ...draft, gender: event.target.value })} /></label>
          <label>Identity: Personality<textarea value={draft.personality} onChange={(event) => setDraft({ ...draft, personality: event.target.value })} /></label>
          <label>Identity: Misc<textarea value={draft.misc} onChange={(event) => setDraft({ ...draft, misc: event.target.value })} /></label>
          <label>Bio:<textarea className="large-entry" value={draft.bio} onChange={(event) => setDraft({ ...draft, bio: event.target.value })} /></label>
          <label className="file-pick"><ImageIcon size={18} /> Add images<input type="file" accept="image/*" multiple onChange={(event) => addImages(event.target.files)} /></label>
          <ImageStrip attachments={attachments} onOpen={setViewerIndex} />
          <label className="compact-check"><input type="checkbox" checked={draft.statsEnabled} onChange={(event) => setDraft({ ...draft, statsEnabled: event.target.checked })} /> Enable ability scores</label>
          {draft.statsEnabled && <PointBuyEditor project={project} draft={draft} bonuses={bonuses} onDraft={setDraft} />}
          {!valid && <p className="error">Point buy must stay within 27 points, with base scores from 8 to 15.</p>}
          <div className="split-actions"><button disabled={!valid} onClick={save}><Save size={18} /> Save</button><button onClick={() => setEditing(false)}>Cancel</button>{saved && <span className="save-status">Saved</span>}</div>
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

function characterTemplateBonus(project: Project, character: Character) {
  const defaultStats = project.deltaDefaultNpcStats ?? defaultDeltaNpcStats();
  const generated = generatedDeltaStats(project, {
    prefix: character.prefix,
    base: character.base,
    job: character.job,
    jobCategory: character.jobCategory
  });
  return {
    generated,
    bonus: abilities.reduce((scores, ability) => ({ ...scores, [ability]: generated.scores[ability] - defaultStats[ability] }), {} as AbilityScores)
  };
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
  return <div className="stat-display">{abilities.map((ability) => {
    const key = ability.toLowerCase() as "str" | "dex" | "con" | "int" | "wis" | "cha";
    const legacyBonus = bonuses.filter((item) => item.stat === ability).reduce((sum, item) => sum + item.value, 0);
    const total = character[key] + template.bonus[ability] + legacyBonus;
    return <span key={ability}>{ability} {total} <small>{modifierLabel(total)}</small></span>;
  })}{template.generated.templateTag && <small className="delta-template-tag">{template.generated.templateTag}</small>}</div>;
}

function PointBuyEditor({ project, draft, bonuses, onDraft }: { project: Project; draft: Character; bonuses: CharacterBonus[]; onDraft: (character: Character) => void }) {
  const pointCost = abilities.reduce((sum, ability) => {
    const key = ability.toLowerCase() as "str" | "dex" | "con" | "int" | "wis" | "cha";
    const costs: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
    return sum + costs[draft[key]];
  }, 0);
  const template = characterTemplateBonus(project, draft);
  const categories = jobCategories(project.deltaJobs ?? []);
  const jobsForCategory = (project.deltaJobs ?? []).filter((job) => job.category === draft.jobCategory);
  const legacyConBonus = bonuses.filter((item) => item.stat === "CON").reduce((sum, item) => sum + item.value, 0);
  const totalCon = draft.con + template.bonus.CON + legacyConBonus;
  const baseHp = Math.max(1, 10 + scoreModifier(totalCon));
  const tagHpBonus = template.generated.hpBonus;
  const totalHp = Math.max(1, baseHp + tagHpBonus);
  const hpScale = Math.max(baseHp, totalHp, baseHp + Math.max(0, tagHpBonus), 1);
  const statRows = abilities.map((ability) => {
    const key = ability.toLowerCase() as "str" | "dex" | "con" | "int" | "wis" | "cha";
    const base = draft[key];
    const legacyBonus = bonuses.filter((item) => item.stat === ability).reduce((sum, item) => sum + item.value, 0);
    const bonus = template.bonus[ability] + legacyBonus;
    const total = base + bonus;
    return { ability, key, base, bonus, total };
  });
  const statScale = Math.max(20, ...statRows.map((row) => Math.max(row.base, row.total)));
  return (
    <div className="point-buy">
      <div className="mini-row"><strong>{pointCost} / 27 spent</strong>{template.generated.templateTag && <small className="delta-template-tag">{template.generated.templateTag}</small>}</div>
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
      </div>
      <div className={`hp-summary ${tagHpBonus < 0 ? "negative" : ""}`}>
        <div className="hp-summary-head">
          <span>HP</span>
          <strong>{totalHp} <small>({signedBonus(tagHpBonus)})</small></strong>
        </div>
        <div className="hp-total-bar" aria-label={`HP base ${baseHp} plus tag ${signedBonus(tagHpBonus)} equals ${totalHp}`}>
          <i style={{ width: `${(totalHp / hpScale) * 100}%` }} />
          <em style={{ left: `${(baseHp / hpScale) * 100}%` }} />
        </div>
        <div className="hp-summary-foot"><span>{baseHp} {signedBonus(tagHpBonus)} = {totalHp}</span></div>
      </div>
      {statRows.map(({ ability, key, base, bonus, total }) => {
        const baseWidth = (Math.max(0, bonus < 0 ? total : base) / statScale) * 100;
        const bonusWidth = (Math.abs(bonus) / statScale) * 100;
        return (
          <div className="stat-bar-row" key={ability}>
            <span className="stat-label"><strong>{ability}</strong></span>
            <button disabled={base <= 8} onClick={() => onDraft({ ...draft, [key]: base - 1 })}>-</button>
            <div className="stat-bar-cell">
              <div className={`stat-bar ${bonus < 0 ? "negative" : ""}`}><i style={{ width: `${baseWidth}%` }} />{bonus !== 0 && <b style={{ width: `${bonusWidth}%` }} />}</div>
              <small>{abilityHints[ability]}</small>
            </div>
            <button disabled={base >= 15} onClick={() => onDraft({ ...draft, [key]: base + 1 })}>+</button>
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
      {stars.map((star) => <button className="star-card" key={star.id} onClick={() => setOpenStar(star)}><small>{star.role} · {formatDate(star.updatedAt)}</small><p>{star.bodyCopy}</p></button>)}
      {openStar && <div className="modal-backdrop" onClick={() => setOpenStar(undefined)}><section className="star-modal" onClick={(event) => event.stopPropagation()}><small>{openStar.role} · {formatDate(openStar.updatedAt)}</small><p>{openStar.bodyCopy}</p><div className="split-actions"><button onClick={() => setOpenStar(undefined)}>Close</button><button className="danger" onClick={() => removeStar(openStar.id)}><Trash2 size={18} /> Delete star</button></div></section></div>}
    </Page>
  );
}

function DataSettingsContent() {
  const [importStatus, setImportStatus] = useState("");
  async function backupAll() {
    if (!confirm("Generate a backup of all app data except API keys?")) return;
    const data = {
      schemaVersion: 1,
      appVersion: "0.1.0",
      exportedAt: new Date().toISOString(),
      settings: { ...(await db.settings.get("settings")), apiKey: undefined },
      projects: await db.projects.toArray(),
      chats: await db.chats.toArray(),
      branches: await db.branches.toArray(),
      messages: await db.messages.toArray(),
      stars: await db.stars.toArray(),
      archives: await db.archives.toArray(),
      archiveEntries: await db.archiveEntries.toArray(),
      memories: await db.memories.toArray(),
      characters: await db.characters.toArray(),
      modelLibrary: await db.modelLibrary.toArray(),
      sourceFiles: await db.sourceFiles.toArray(),
      inventoryItems: await db.inventoryItems.toArray(),
      inventoryLogs: await db.inventoryLogs.toArray(),
      deltaSessions: await db.deltaSessions.toArray(),
      deltaMessages: await db.deltaMessages.toArray(),
      deltaEntities: await db.deltaEntities.toArray(),
      deltaAllyCache: await db.deltaAllyCache.toArray(),
      deltaActionMacros: await db.deltaActionMacros.toArray()
    };
    downloadJson("mirror-backup.json", data);
  }
  async function importBackup(file: File | undefined) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.projects)) {
        setImportStatus("Invalid import file.");
        return;
      }
      const counts = ["projects", "chats", "branches", "messages", "stars", "archives", "archiveEntries", "memories", "characters", "modelLibrary", "sourceFiles", "inventoryItems", "inventoryLogs", "deltaSessions", "deltaMessages", "deltaEntities", "deltaAllyCache", "deltaActionMacros"]
        .map((key) => `${key}: ${Array.isArray(parsed[key]) ? parsed[key].length : 0}`)
        .join(", ");
      if (!confirm(`Import this backup?\n${counts}`)) return;
      await db.transaction("rw", [db.settings, db.projects, db.chats, db.branches, db.messages, db.stars, db.archives, db.archiveEntries, db.memories, db.characters, db.modelLibrary, db.sourceFiles, db.inventoryItems, db.inventoryLogs, db.deltaSessions, db.deltaMessages, db.deltaEntities, db.deltaAllyCache, db.deltaActionMacros], async () => {
        if (parsed.settings && typeof parsed.settings === "object") await db.settings.put(parsed.settings as AppSettings);
        if (Array.isArray(parsed.projects)) await db.projects.bulkPut(parsed.projects as Project[]);
        if (Array.isArray(parsed.chats)) await db.chats.bulkPut(parsed.chats as Chat[]);
        if (Array.isArray(parsed.branches)) await db.branches.bulkPut(parsed.branches as never[]);
        if (Array.isArray(parsed.messages)) await db.messages.bulkPut(parsed.messages as Message[]);
        if (Array.isArray(parsed.stars)) await db.stars.bulkPut(parsed.stars as never[]);
        if (Array.isArray(parsed.archives)) await db.archives.bulkPut(parsed.archives as never[]);
        if (Array.isArray(parsed.archiveEntries)) await db.archiveEntries.bulkPut(parsed.archiveEntries as never[]);
        if (Array.isArray(parsed.memories)) await db.memories.bulkPut(parsed.memories as Memory[]);
        if (Array.isArray(parsed.characters)) await db.characters.bulkPut(parsed.characters as Character[]);
        if (Array.isArray(parsed.modelLibrary)) await db.modelLibrary.bulkPut(parsed.modelLibrary as never[]);
        if (Array.isArray(parsed.sourceFiles)) await db.sourceFiles.bulkPut(parsed.sourceFiles as never[]);
        if (Array.isArray(parsed.inventoryItems)) await db.inventoryItems.bulkPut(parsed.inventoryItems as never[]);
        if (Array.isArray(parsed.inventoryLogs)) await db.inventoryLogs.bulkPut(parsed.inventoryLogs as never[]);
        if (Array.isArray(parsed.deltaSessions)) await db.deltaSessions.bulkPut(parsed.deltaSessions as DeltaSession[]);
        if (Array.isArray(parsed.deltaMessages)) await db.deltaMessages.bulkPut(parsed.deltaMessages as DeltaMessage[]);
        if (Array.isArray(parsed.deltaEntities)) await db.deltaEntities.bulkPut(parsed.deltaEntities as DeltaEntity[]);
        if (Array.isArray(parsed.deltaAllyCache)) await db.deltaAllyCache.bulkPut(parsed.deltaAllyCache as DeltaAllyCacheEntry[]);
        if (Array.isArray(parsed.deltaActionMacros)) await db.deltaActionMacros.bulkPut(parsed.deltaActionMacros as DeltaActionMacro[]);
      });
      setImportStatus("Import complete.");
    } catch {
      setImportStatus("Import failed.");
    }
  }
  async function clearAll() {
    if (!confirm("Back up first if you need this data. Continue to clear all local Mirror data?")) return;
    if (prompt("Type DELETE MIRROR DATA to permanently clear local data.") !== "DELETE MIRROR DATA") return;
    await db.delete();
    location.reload();
  }
  return <><button onClick={backupAll}><Download size={18} /> Backup All</button><button onClick={backupAll}><Download size={18} /> Backup Memories Only</button><label className="file-pick"><Upload size={18} /> Import backup<input type="file" accept="application/json" onChange={(event) => importBackup(event.target.files?.[0])} /></label>{importStatus && <p className="save-status">{importStatus}</p>}<button className="danger separated" onClick={clearAll}><Trash2 size={18} /> Clear All</button></>;
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
