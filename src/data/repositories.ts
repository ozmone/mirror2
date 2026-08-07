import Dexie from "dexie";
import { db } from "./db";
import { defaultMemoryInstruction } from "./defaults";
import { Ability, Character, CharacterBonus, InventoryKind, Memory, Message, Project } from "../types";
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
    locked: false,
    inventoryEnabled: false,
    gearEnabled: false
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

export async function createMemory(projectId: string, text: string, tags: string[]) {
  const timestamp = now();
  const normalisedTags = Array.from(new Set(tags.map(normaliseTag).filter(Boolean)));
  const memory: Memory = {
    id: uid(),
    projectId,
    text,
    normalisedTags,
    visibleTags: tags.filter(Boolean),
    sourceType: "manual",
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
  const all = await db.memories.where("projectId").equals(projectId).and((memory) => !memory.archived).toArray();
  return all
    .map((memory) => {
      const tagHits = normalised.filter((tag) => memory.normalisedTags.some((saved) => saved === tag || saved.startsWith(tag))).length;
      const queryHit = query && memory.text.toLowerCase().includes(query.toLowerCase()) ? 1 : 0;
      const userRelevance = memory.relevance ?? 5;
      return { memory, relevance: tagHits * 2 + queryHit + userRelevance / 10 };
    })
    .filter((item) => item.relevance > 0 || (!normalised.length && !query))
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

export async function applyInventoryChange(projectId: string, kind: InventoryKind, rawName: string, delta: number, logSentence: string) {
  const name = normaliseInventoryName(rawName);
  if (!name || !Number.isFinite(delta) || delta === 0) return null;
  const timestamp = now();
  const existingItems = await db.inventoryItems
    .where("projectId")
    .equals(projectId)
    .and((item) => item.kind === kind && item.normalisedName === name)
    .toArray();
  const existing = existingItems[0];
  const currentQuantity = existingItems.reduce((sum, item) => sum + item.quantity, 0);
  const quantity = Math.max(0, currentQuantity + delta);
  await db.transaction("rw", db.inventoryItems, db.inventoryLogs, async () => {
    if (existing) {
      await db.inventoryItems.update(existing.id, { name, normalisedName: name, quantity, updatedAt: timestamp });
      const duplicateIds = existingItems.slice(1).map((item) => item.id);
      if (duplicateIds.length) await db.inventoryItems.bulkDelete(duplicateIds);
    } else if (delta > 0) {
      await db.inventoryItems.add({ id: uid(), projectId, kind, name, normalisedName: name, quantity, createdAt: timestamp, updatedAt: timestamp });
    } else {
      return;
    }
    await db.inventoryLogs.add({ id: uid(), projectId, sentence: logSentence.trim(), createdAt: timestamp, updatedAt: timestamp });
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
  const bonuses = await db.characterBonuses.where("characterId").equals(characterId).toArray();
  const total = (base: number, stat: Ability) => base + bonuses.filter((bonus: CharacterBonus) => bonus.stat === stat).reduce((sum, bonus) => sum + bonus.value, 0);
  return {
    character: character.name,
    stats: {
      STR: total(character.str, "STR"),
      DEX: total(character.dex, "DEX"),
      CON: total(character.con, "CON"),
      INT: total(character.int, "INT"),
      WIS: total(character.wis, "WIS"),
      CHA: total(character.cha, "CHA")
    }
  };
}
