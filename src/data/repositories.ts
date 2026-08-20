import Dexie from "dexie";
import { db } from "./db";
import { defaultDeltaBases, defaultDeltaJobs, defaultDeltaNpcStats, defaultDeltaPrefixes, defaultDeltaSystemPrompt, defaultMemoryInstruction } from "./defaults";
import { Ability, AbilityModifiers, AbilityScores, Character, CharacterBonus, Chat, DeltaAllyCacheEntry, DeltaBaseTemplate, DeltaEntity, DeltaMessage, DeltaPrefixTemplate, DeltaSession, InventoryKind, Memory, Message, Project } from "../types";
import { estimateTokens, fallbackChatTitle, normaliseTag, now, uid } from "../utils";

export const abilities: Ability[] = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];
export const pointBuyCosts: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };

export function totalPointCost(scores: Pick<Character, "str" | "dex" | "con" | "int" | "wis" | "cha">) {
  return pointBuyCosts[scores.str] + pointBuyCosts[scores.dex] + pointBuyCosts[scores.con] + pointBuyCosts[scores.int] + pointBuyCosts[scores.wis] + pointBuyCosts[scores.cha];
}

export function validatePointBuy(scores: Pick<Character, "str" | "dex" | "con" | "int" | "wis" | "cha">) {
  return abilities.every((ability) => {
    const value = scores[ability.toLowerCase() as Lowercase<Ability>];
    return value >= 8 && value <= 15;
  }) && totalPointCost(scores) <= 27;
}

export function messagesForIncrementalCompaction(messages: Message[], historyLimit: number, compactedThroughSequence = -1) {
  if (!Number.isFinite(historyLimit) || historyLimit < 1) return [];
  const stableHistory = [...messages]
    .filter((message) => message.status !== "pending" && message.status !== "streaming" && message.status !== "failed" && message.body.trim() !== "...")
    .sort((a, b) => a.sequence - b.sequence);
  const expired = stableHistory.slice(0, Math.max(0, stableHistory.length - Math.floor(historyLimit)));
  return expired.filter((message) => message.sequence > compactedThroughSequence);
}

function abilityModifier(score: number) {
  return Math.floor((score - 10) / 2);
}

function derivedHp(con: number, hpBonus = 0) {
  return Math.max(1, 10 + abilityModifier(con) + hpBonus);
}

function applyModifiers(scores: AbilityScores, modifiers?: AbilityModifiers) {
  const next = { ...scores };
  for (const ability of abilities) next[ability] += modifiers?.[ability] ?? 0;
  return next;
}

function normaliseTemplateValue(value?: string) {
  return value?.trim().toUpperCase() || undefined;
}

function sameModifiers(a: AbilityModifiers | undefined, b: AbilityModifiers | undefined) {
  return abilities.every((ability) => (a?.[ability] ?? 0) === (b?.[ability] ?? 0));
}

function isLegacyDefaultBase(item: DeltaBaseTemplate) {
  const label = item.label.trim().toUpperCase();
  const hpBonus = item.hpBonus ?? 0;
  if (item.notes?.trim()) return false;
  if (label === "LIGHT") return (sameModifiers(item.statModifiers, { STR: -2, DEX: 4 }) || sameModifiers(item.statModifiers, { STR: -2, DEX: 4, CON: -2 })) && hpBonus === -5;
  if (label === "MEDIUM") return (sameModifiers(item.statModifiers, { DEX: 2, CON: 2 }) || sameModifiers(item.statModifiers, { STR: 2, DEX: 2, CON: 2 })) && hpBonus === 0;
  if (label === "HEAVY") return (sameModifiers(item.statModifiers, { STR: 4, DEX: -1, CON: 4 }) || sameModifiers(item.statModifiers, { STR: 3, DEX: -3, CON: 3 })) && hpBonus === 8;
  return false;
}

function isLegacyDefaultPrefix(item: DeltaPrefixTemplate) {
  const label = item.label.trim().toUpperCase();
  if (!abilities.includes(label as Ability) || item.notes?.trim()) return false;
  return sameModifiers(item.statModifiers, { [label]: 3 });
}

export function effectiveDeltaPrefixes(value?: DeltaPrefixTemplate[]) {
  const defaults = defaultDeltaPrefixes();
  return (value?.length ? value : defaults).map((item) => {
    if (!isLegacyDefaultPrefix(item)) return item;
    return defaults.find((prefix) => prefix.label === item.label) ?? item;
  });
}

export function effectiveDeltaBases(value?: DeltaBaseTemplate[]) {
  const defaults = defaultDeltaBases();
  return (value?.length ? value : defaults).map((item) => {
    if (!isLegacyDefaultBase(item)) return item;
    return defaults.find((base) => base.label === item.label) ?? item;
  });
}

export function formatDeltaTemplateTag(prefix?: string, base?: string, job?: string) {
  const cleanPrefix = normaliseTemplateValue(prefix);
  const cleanBase = normaliseTemplateValue(base);
  const cleanJob = normaliseTemplateValue(job);
  const first = cleanPrefix && cleanBase ? `${cleanPrefix}-${cleanBase}` : cleanPrefix ?? cleanBase;
  return [first, cleanJob].filter(Boolean).join(" ") || undefined;
}

export function generatedDeltaStats(project: Project, template: { prefix?: string; base?: string; job?: string; jobCategory?: string }) {
  const baseStats = project.deltaDefaultNpcStats ?? defaultDeltaNpcStats();
  let scores = { ...baseStats };
  const prefix = normaliseTemplateValue(template.prefix);
  const base = normaliseTemplateValue(template.base);
  const job = normaliseTemplateValue(template.job);
  const jobCategory = template.jobCategory?.trim().toLowerCase();
  const prefixTemplate = effectiveDeltaPrefixes(project.deltaPrefixes).find((item) => item.label.trim().toUpperCase() === prefix);
  const baseTemplate = effectiveDeltaBases(project.deltaBases).find((item) => item.label.trim().toUpperCase() === base);
  const jobTemplate = (project.deltaJobs ?? []).find((item) => {
    if (item.label.trim().toUpperCase() !== job) return false;
    if (!jobCategory) return true;
    return item.category.trim().toLowerCase() === jobCategory;
  });
  scores = applyModifiers(scores, prefixTemplate?.statModifiers);
  scores = applyModifiers(scores, baseTemplate?.statModifiers);
  scores = applyModifiers(scores, jobTemplate?.statModifiers);
  const hpBonus = baseTemplate?.hpBonus ?? 0;
  const maxHp = derivedHp(scores.CON, hpBonus);
  return {
    scores,
    hpBonus,
    maxHp,
    templateTag: formatDeltaTemplateTag(prefix, base, job),
    prefix,
    base,
    job
  };
}

export function generatedStatsPatch(project: Project, template: { prefix?: string; base?: string; job?: string; jobCategory?: string }) {
  const generated = generatedDeltaStats(project, template);
  return {
    str: generated.scores.STR,
    dex: generated.scores.DEX,
    con: generated.scores.CON,
    int: generated.scores.INT,
    wis: generated.scores.WIS,
    cha: generated.scores.CHA,
    maxHp: generated.maxHp,
    currentHp: generated.maxHp,
    templateTag: generated.templateTag,
    prefix: generated.prefix,
    base: generated.base,
    job: generated.job,
    generatedStatsSource: generated.templateTag ? "generated-template" as const : undefined
  };
}

export async function characterTemplateStats(project: Project, character: Character) {
  const templateBuild = character.buildMode ? character.buildMode === "template" : Boolean(character.job);
  const defaultStats = project.deltaDefaultNpcStats ?? defaultDeltaNpcStats();
  const generated = generatedDeltaStats(project, {
    prefix: character.prefix,
    base: character.base,
    job: templateBuild ? character.job : undefined,
    jobCategory: templateBuild ? character.jobCategory : undefined
  });
  const bonuses = await db.characterBonuses.where("characterId").equals(character.id).toArray();
  const total = (base: number, stat: Ability) => {
    const legacyBonus = bonuses.filter((bonus) => bonus.stat === stat).reduce((sum, bonus) => sum + bonus.value, 0);
    const baseScore = templateBuild ? defaultStats[stat] : base;
    return baseScore + (generated.scores[stat] - defaultStats[stat]) + legacyBonus;
  };
  return {
    STR: total(character.str, "STR"),
    DEX: total(character.dex, "DEX"),
    CON: total(character.con, "CON"),
    INT: total(character.int, "INT"),
    WIS: total(character.wis, "WIS"),
    CHA: total(character.cha, "CHA"),
    maxHp: derivedHp(total(character.con, "CON"), generated.hpBonus),
    templateTag: generated.templateTag,
    prefix: generated.prefix,
    base: generated.base,
    job: generated.job
  };
}

async function characterEntityPatch(project: Project, character: Character) {
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

export async function upsertDeltaAllyCache(chatId: string, entity: DeltaEntity) {
  if (entity.side !== "ally" || entity.characterId || entity.generatedStatsSource !== "generated-template") return;
  const timestamp = now();
  const existing = await db.deltaAllyCache.where("chatId").equals(chatId).and((item) => item.name.trim().toLowerCase() === entity.name.trim().toLowerCase()).first();
  const patch: Omit<DeltaAllyCacheEntry, "id" | "createdAt"> = {
    chatId,
    name: entity.name,
    templateTag: entity.templateTag,
    prefix: entity.prefix,
    base: entity.base,
    job: entity.job,
    generatedStatsSource: entity.generatedStatsSource,
    currentHp: entity.currentHp,
    maxHp: entity.maxHp,
    statusText: entity.statusText,
    str: entity.str,
    dex: entity.dex,
    con: entity.con,
    int: entity.int,
    wis: entity.wis,
    cha: entity.cha,
    updatedAt: timestamp
  };
  if (existing) await db.deltaAllyCache.update(existing.id, patch);
  else await db.deltaAllyCache.add({ id: uid(), ...patch, createdAt: timestamp });
}

export function normaliseInventoryName(value: string) {
  const clean = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (clean.endsWith("ies")) return `${clean.slice(0, -3)}y`;
  if (clean.endsWith("ses") || clean.endsWith("xes") || clean.endsWith("ches") || clean.endsWith("shes")) return clean.slice(0, -2);
  if (clean.endsWith("s") && !clean.endsWith("ss")) return clean.slice(0, -1);
  return clean;
}

export async function createProject(name: string) {
  const count = await db.projects.count();
  const timestamp = now();
  const project: Project = {
    id: uid(),
    createdAt: timestamp,
    updatedAt: timestamp,
    name,
    iconName: "folder",
    iconColor: "#a7d8c4",
    orderIndex: count,
    pinned: false,
    instructions: "",
    worldSetting: "",
    memoryMode: "approval",
    memoryInstruction: defaultMemoryInstruction,
    inventoryEnabled: false,
    currencyName: "money",
    gearEnabled: false,
    deltaDefaultNpcStats: defaultDeltaNpcStats(),
    deltaPrefixes: defaultDeltaPrefixes(),
    deltaBases: defaultDeltaBases(),
    deltaJobs: defaultDeltaJobs(),
    deltaSystemPrompt: defaultDeltaSystemPrompt,
    deltaRevealText: true,
    deltaRevealSpeed: 5
  };
  await db.projects.add(project);
  return project;
}

export async function createChat(projectId: string, firstMessage: string) {
  const timestamp = now();
  const chatId = uid();
  const branchId = uid();
  await db.transaction("rw", db.chats, db.branches, db.messages, async () => {
    await db.branches.add({ id: branchId, chatId, label: "Main", createdAt: timestamp, updatedAt: timestamp });
    await db.chats.add({
      id: chatId,
      projectId,
      title: fallbackChatTitle(firstMessage),
      pinned: false,
      titleState: "fallback",
      activeBranchId: branchId,
      createdAt: timestamp,
      updatedAt: timestamp,
      archived: false,
      compactionMemory: ""
    });
    await addMessage(chatId, branchId, "user", firstMessage, undefined, 0);
  });
  return chatId;
}

export async function addMessage(chatId: string, branchId: string, role: Message["role"], body: string, parentMessageId?: string, sequence?: number) {
  const timestamp = now();
  const resolvedSequence =
    sequence ??
    ((await db.messages.where("[chatId+branchId+sequence]").between([chatId, branchId, Dexie.minKey], [chatId, branchId, Dexie.maxKey]).last())?.sequence ?? -1) + 1;
  const message: Message = {
    id: uid(),
    chatId,
    branchId,
    parentMessageId,
    sequence: resolvedSequence,
    role,
    body,
    createdAt: timestamp,
    updatedAt: timestamp,
    estimatedTokens: true,
    inputTokens: role === "user" ? estimateTokens(body) : undefined,
    outputTokens: role === "assistant" ? estimateTokens(body) : undefined,
    starred: false,
    status: "complete"
  };
  await db.messages.add(message);
  await db.chats.update(chatId, { updatedAt: timestamp });
  return message;
}

export async function getOrCreateDeltaSession(chat: Chat) {
  const existing = await db.deltaSessions.where("chatId").equals(chat.id).and((session) => session.active).first();
  if (existing) {
    const legacyPlaceholderMessages = await db.deltaMessages
      .where("sessionId")
      .equals(existing.id)
      .and((message) => message.role === "system" && message.body.startsWith("Engagement Summary\n\nDelta Mode workspace initialized."))
      .primaryKeys() as string[];
    if (legacyPlaceholderMessages.length) await db.deltaMessages.bulkDelete(legacyPlaceholderMessages);
    const activeEntities = await db.deltaEntities.where("sessionId").equals(existing.id).sortBy("orderIndex");
    const seenEntities = new Set<string>();
    const duplicateEntityIds: string[] = [];
    for (const entity of activeEntities) {
      const identity = entity.characterId
        ? `character:${entity.characterId}`
        : `generated:${entity.name.trim().toLocaleLowerCase()}`;
      if (seenEntities.has(identity)) duplicateEntityIds.push(entity.id);
      else seenEntities.add(identity);
    }
    if (duplicateEntityIds.length) await db.deltaEntities.bulkDelete(duplicateEntityIds);
    const messageCount = await db.deltaMessages.where("sessionId").equals(existing.id).count();
    if (messageCount === 0) {
      const placeholderIds = await db.deltaEntities
        .where("sessionId")
        .equals(existing.id)
        .and((entity) => (entity.name === "Opposition" && entity.statusText === "Placeholder") || entity.name.trim().toLocaleLowerCase() === "player character")
        .primaryKeys() as string[];
      if (placeholderIds.length) await db.deltaEntities.bulkDelete(placeholderIds);
    }
    return existing;
  }
  const timestamp = now();
  const project = await db.projects.get(chat.projectId);
  const session: DeltaSession = {
    id: uid(),
    chatId: chat.id,
    projectId: chat.projectId,
    title: "Untitled Engagement",
    active: true,
    settings: {
      temperature: 0,
      topP: 0,
      revealText: project?.deltaRevealText ?? chat.deltaRevealText ?? true,
      revealSpeed: project?.deltaRevealSpeed ?? chat.deltaRevealSpeed ?? 5
    },
    createdAt: timestamp,
    updatedAt: timestamp
  };
  const playerCharacter = chat.deltaPlayerCharacterId ? await db.characters.get(chat.deltaPlayerCharacterId) : undefined;
  const playerPatch = playerCharacter && project && playerCharacter.projectId === chat.projectId
    ? await characterEntityPatch(project, playerCharacter)
    : undefined;
  await db.transaction("rw", db.deltaSessions, db.deltaEntities, async () => {
    await db.deltaSessions.add(session);
    if (playerPatch) {
      await db.deltaEntities.add({ id: uid(), sessionId: session.id, ...playerPatch, side: "ally", orderIndex: 0, createdAt: timestamp, updatedAt: timestamp });
    }
  });
  return session;
}

export async function archiveDeltaSession(sessionId: string, title: string) {
  const timestamp = now();
  await db.deltaSessions.update(sessionId, { title, active: false, archivedAt: timestamp, updatedAt: timestamp });
}

export async function addDeltaMessage(
  sessionId: string,
  role: "user" | "assistant" | "system",
  body: string,
  metadata: Partial<Pick<DeltaMessage, "turnNumber" | "eventType" | "rollReceipt" | "modelId">> = {}
) {
  const timestamp = now();
  const sequence = ((await db.deltaMessages.where("[sessionId+sequence]").between([sessionId, Dexie.minKey], [sessionId, Dexie.maxKey]).last())?.sequence ?? -1) + 1;
  const message: DeltaMessage = { id: uid(), sessionId, sequence, role, body, status: "complete", ...metadata, createdAt: timestamp, updatedAt: timestamp };
  await db.deltaMessages.add(message);
  await db.deltaSessions.update(sessionId, { updatedAt: timestamp });
  return message;
}

export async function applyDeltaDamage(
  sessionId: string,
  entityId: string,
  amount: number,
  rollReceiptId: string,
  zeroHpOutcome: "ko" | "dead" = "ko"
) {
  const damage = Math.max(0, Math.floor(amount));
  if (damage <= 0) return { error: "Damage must be a positive whole number." } as const;
  return db.transaction("rw", db.deltaEntities, db.deltaMessages, async () => {
    const entity = await db.deltaEntities.get(entityId);
    if (!entity || entity.sessionId !== sessionId) return { error: "Entity not found in this Delta engagement." } as const;
    const receiptMessage = await db.deltaMessages
      .where("sessionId")
      .equals(sessionId)
      .filter((message) => message.rollReceipt?.id === rollReceiptId)
      .first();
    if (!receiptMessage?.rollReceipt) return { error: "Verified roll receipt not found in this Delta engagement." } as const;
    const appliedReceiptIds = entity.appliedDamageReceiptIds ?? [];
    if (appliedReceiptIds.includes(rollReceiptId)) {
      return {
        duplicate: true,
        entityId: entity.id,
        entityName: entity.name,
        currentHp: entity.currentHp ?? entity.maxHp ?? 1,
        maxHp: entity.maxHp ?? 1,
        rollReceiptId
      } as const;
    }
    const maxHp = Math.max(1, Math.floor(entity.maxHp ?? 1));
    const beforeHp = Math.max(0, Math.min(maxHp, Math.floor(entity.currentHp ?? maxHp)));
    const afterHp = Math.max(0, beforeHp - damage);
    const appliedAt = now();
    const application = { entityId: entity.id, entityName: entity.name, kind: "damage" as const, amount: damage, beforeHp, afterHp, appliedAt };
    await db.deltaEntities.update(entity.id, {
      currentHp: afterHp,
      ...(afterHp === 0 ? { engagementState: zeroHpOutcome } : {}),
      appliedDamageReceiptIds: [...appliedReceiptIds, rollReceiptId],
      updatedAt: appliedAt
    });
    await db.deltaMessages.update(receiptMessage.id, {
      rollReceipt: {
        ...receiptMessage.rollReceipt,
        hpApplications: [...(receiptMessage.rollReceipt.hpApplications ?? []), application]
      },
      updatedAt: appliedAt
    });
    return {
      applied: true,
      entityId: entity.id,
      entityName: entity.name,
      damage,
      beforeHp,
      afterHp,
      maxHp,
      ...(afterHp === 0 ? { engagementState: zeroHpOutcome } : {}),
      rollReceiptId
    } as const;
  });
}

export async function toggleStar(projectId: string, message: Message) {
  const existing = await db.stars.where("messageId").equals(message.id).first();
  if (existing) {
    await db.transaction("rw", db.stars, db.messages, async () => {
      await db.stars.delete(existing.id);
      await db.messages.update(message.id, { starred: false, updatedAt: now() });
    });
    return false;
  }
  const timestamp = now();
  await db.transaction("rw", db.stars, db.messages, async () => {
    await db.stars.add({
      id: uid(),
      projectId,
      chatId: message.chatId,
      branchId: message.branchId,
      messageId: message.id,
      role: message.role,
      bodyCopy: message.body,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    await db.messages.update(message.id, { starred: true, updatedAt: timestamp });
  });
  return true;
}

export async function createMemory(projectId: string, text: string, tags: string[], sourceType: Memory["sourceType"] = "manual", sourceMessageIds?: string[]) {
  const cleanText = text.trim();
  if (!cleanText) throw new Error("A memory needs text.");
  const timestamp = now();
  const normalisedTags = Array.from(new Set(tags.map(normaliseTag).filter(Boolean)));
  const memory: Memory = {
    id: uid(),
    projectId,
    text: cleanText,
    normalisedTags,
    visibleTags: tags.filter(Boolean),
    sourceType,
    sourceMessageIds,
    createdAt: timestamp,
    updatedAt: timestamp,
    recallCount: 0,
    relevance: 5,
    archived: false
  };
  await db.memories.add(memory);
  return memory;
}

export async function searchMemories(projectId: string, tags: string[], query = "", limit = 8) {
  const normalised = tags.map(normaliseTag).filter(Boolean);
  const queryTerms = Array.from(new Set(query.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 2)));
  const all = await db.memories.where("projectId").equals(projectId).and((memory) => !memory.archived).toArray();
  return all
    .map((memory) => {
      const tagHits = normalised.filter((tag) => memory.normalisedTags.some((saved) => saved === tag || saved.startsWith(tag))).length;
      const queryHit = query && memory.text.toLowerCase().includes(query.toLowerCase()) ? 1 : 0;
      const memoryText = `${memory.text} ${memory.visibleTags.join(" ")}`.toLowerCase();
      const termHits = queryTerms.filter((term) => memoryText.includes(term)).length;
      const userRelevance = memory.relevance ?? 5;
      return { memory, relevance: tagHits * 3 + queryHit * 2 + termHits + userRelevance / 10 };
    })
    .filter((item) => item.relevance > 0.9 || (!normalised.length && !query))
    .sort((a, b) => b.relevance - a.relevance || b.memory.updatedAt - a.memory.updatedAt)
    .slice(0, limit)
    .map(({ memory, relevance }) => ({
      id: memory.id,
      text: memory.text,
      tags: memory.visibleTags,
      relevance,
      updatedAt: memory.updatedAt
    }));
}

export async function applyInventoryChange(projectId: string, chatId: string, kind: InventoryKind, rawName: string, delta: number, logSentence: string, unitWeightKg?: number) {
  const name = normaliseInventoryName(rawName);
  if (!name || !Number.isFinite(delta) || delta === 0) return null;
  const timestamp = now();
  const existingItems = await db.inventoryItems
    .where("chatId")
    .equals(chatId)
    .and((item) => item.kind === kind && item.normalisedName === name)
    .toArray();
  const existing = existingItems[0];
  const currentQuantity = existingItems.reduce((sum, item) => sum + item.quantity, 0);
  const quantity = Math.max(0, currentQuantity + delta);
  const nextUnitWeightKg = Number.isFinite(unitWeightKg) && (unitWeightKg ?? 0) > 0
    ? Math.max(0.01, Math.round((unitWeightKg ?? 0) * 100) / 100)
    : existing?.unitWeightKg;
  await db.transaction("rw", db.inventoryItems, db.inventoryLogs, async () => {
    if (existing) {
      if (quantity === 0) await db.inventoryItems.delete(existing.id);
      else await db.inventoryItems.update(existing.id, { name, normalisedName: name, quantity, unitWeightKg: nextUnitWeightKg, updatedAt: timestamp });
      const duplicateIds = existingItems.slice(1).map((item) => item.id);
      if (duplicateIds.length) await db.inventoryItems.bulkDelete(duplicateIds);
    } else if (delta > 0) {
      await db.inventoryItems.add({ id: uid(), projectId, chatId, kind, name, normalisedName: name, quantity, unitWeightKg: nextUnitWeightKg, createdAt: timestamp, updatedAt: timestamp });
    } else {
      return;
    }
    await db.inventoryLogs.add({ id: uid(), projectId, chatId, sentence: logSentence.trim(), createdAt: timestamp, updatedAt: timestamp });
  });
  return { item: name, quantity };
}

export async function findCharacters(projectId: string, nameQuery: string, limit = 8) {
  const query = normaliseTag(nameQuery);
  const all = await db.characters.where("projectId").equals(projectId).toArray();
  return all
    .filter((character) => character.normalisedName.includes(query))
    .slice(0, limit)
    .map((character) => ({ id: character.id, name: character.name }));
}

export async function getCharacterIdentity(projectId: string, characterId: string) {
  const character = await db.characters.get(characterId);
  if (!character || character.projectId !== projectId) return null;
  return {
    character: character.name,
    identity: {
      age: character.age,
      gender: character.gender,
      personality: character.personality,
      misc: character.misc
    }
  };
}

export async function getCharacterBio(projectId: string, characterId: string) {
  const character = await db.characters.get(characterId);
  if (!character || character.projectId !== projectId) return null;
  return {
    character: character.name,
    bio: character.bio
  };
}

export async function getCharacterStats(projectId: string, characterId: string) {
  const character = await db.characters.get(characterId);
  if (!character || character.projectId !== projectId) return null;
  const project = await db.projects.get(projectId);
  if (!project) return null;
  const stats = await characterTemplateStats(project, character);
  return {
    character: character.name,
    stats: {
      STR: stats.STR,
      DEX: stats.DEX,
      CON: stats.CON,
      INT: stats.INT,
      WIS: stats.WIS,
      CHA: stats.CHA
    }
  };
}
