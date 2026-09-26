import { db } from "../../data/db";
import { DeltaBriefRoster, DeltaMapSize, Message } from "../../types";
import { normaliseDeltaMapSize } from "../delta/config";
import { deltaRosterParticipants, extractJsonObject } from "../delta/workspaceSupport";
import { type OpenRouterMessage } from "../openRouter";

export function optionalNumber(value: string) {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseDeltaBriefPacket(text: string) {
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

export function parseDeltaAvoidPacket(text: string) {
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

const memoryStopWords = new Set([
  "about", "after", "again", "against", "also", "because", "before", "being", "between", "could", "every", "from", "have", "into", "just", "like", "more", "much", "need", "only", "over", "really", "should", "some", "that", "their", "them", "then", "there", "these", "thing", "this", "those", "through", "very", "want", "were", "what", "when", "where", "which", "while", "with", "would", "your"
]);

export function extractMemoryConcepts(parts: string[], limit = 16) {
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

export function normaliseDeltaBriefRoster(value: unknown): DeltaBriefRoster {
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

export function deltaBriefRosterFromContext(handoffContext = ""): DeltaBriefRoster {
  const roster = { team: [] as string[], neutral: [] as string[], enemies: [] as string[] };
  for (const participant of deltaRosterParticipants(handoffContext)) {
    const target = participant.side === "hostile" ? roster.enemies : participant.side === "neutral" ? roster.neutral : roster.team;
    if (!target.some((name) => name.toLowerCase() === participant.name.toLowerCase())) target.push(participant.name);
  }
  return roster;
}

export function deltaBriefRosterLines(roster: DeltaBriefRoster) {
  return [
    ...roster.team.map((name) => `Ally: ${name}`),
    ...roster.neutral.map((name) => `Neutral: ${name}`),
    ...roster.enemies.map((name) => `Hostile: ${name}`)
  ];
}

export function deltaContinuityWithoutRosterLines(handoffContext = "") {
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

export async function imageForOpenRouter(file: File) {
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

export function chatHistoryContent(history: Message[], currentMessageId: string | undefined, currentImages: { dataUrl: string; mimeType: string }[]) {
  return history.map((message) => ({
    role: (message.role === "system" ? "system" : message.role === "assistant" ? "assistant" : "user") as OpenRouterMessage["role"],
    content: message.id === currentMessageId && currentImages.length ? openRouterContent(clarifyLeadingOocForModel(message.body), currentImages) : messageHistoryText(message, message.id !== currentMessageId)
  }));
}

export async function storedMessageImages(messageId: string) {
  const attachments = await db.attachments.where("[ownerType+ownerId]").equals(["message", messageId]).toArray();
  return Promise.all(attachments.filter((attachment) => attachment.mimeType.startsWith("image/")).map((attachment) => imageForOpenRouter(new File([attachment.blob], attachment.name || "image", { type: attachment.mimeType }))));
}

function canReadChatFile(file: File) {
  return file.type.startsWith("text/") || /\.(txt|md|json|csv|log|yaml|yml|xml)$/i.test(file.name);
}

export async function chatFileContext(files: File[]) {
  if (!files.length) return "";
  const unsupported = files.find((file) => !canReadChatFile(file));
  if (unsupported) throw new Error(`${unsupported.name} cannot be sent as chat text. Attach text, Markdown, JSON, CSV, log, YAML, or XML files here.`);
  const oversized = files.find((file) => file.size > 1_000_000);
  if (oversized) throw new Error(`${oversized.name} is too large to include in one chat reply. Keep attached text files under 1 MB.`);
  const contents = await Promise.all(files.map(async (file) => `# Attached file: ${file.name}\n${await file.text()}`));
  return `Attached files for this reply:\n${contents.join("\n\n")}`;
}

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

export const contextCondensationMinimumCharacters = 400;
export const contextCondensationRatio = 0.8;

export function contextCondensationLimit(message: Message) {
  return Math.max(1, Math.floor(message.body.length * contextCondensationRatio));
}

export function parseContextCondensations(text: string): ContextCondensationCandidate[] {
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

export function parseMemoryReview(text: string): MemoryReviewCandidate[] {
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

export type DeltaImminentProposal = {
  brief: string;
  handoffContext?: string;
  playerCharacterName?: string;
  roster: DeltaBriefRoster;
  mapSize: DeltaMapSize;
  avoidLabel?: string;
  avoidPrompt?: string;
};
