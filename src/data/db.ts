import Dexie, { Table } from "dexie";
import {
  AppSettings,
  Archive,
  ArchiveEntry,
  Attachment,
  Branch,
  Character,
  CharacterActionMacro,
  CharacterActionSlot,
  CharacterBonus,
  CharacterGearSlot,
  Chat,
  DeltaEntity,
  DeltaAllyCacheEntry,
  DeltaActionMacro,
  DeltaMessage,
  DeltaSession,
  InventoryItem,
  InventoryLog,
  Memory,
  Message,
  MigrationMetadata,
  ModelLibraryEntry,
  PendingMemory,
  Project,
  SourceFile,
  Star
} from "../types";
import { defaultSettings, sampleProject } from "./defaults";

export class MirrorDatabase extends Dexie {
  settings!: Table<AppSettings, string>;
  projects!: Table<Project, string>;
  chats!: Table<Chat, string>;
  branches!: Table<Branch, string>;
  messages!: Table<Message, string>;
  stars!: Table<Star, string>;
  archives!: Table<Archive, string>;
  archiveEntries!: Table<ArchiveEntry, string>;
  attachments!: Table<Attachment, string>;
  characters!: Table<Character, string>;
  characterBonuses!: Table<CharacterBonus, string>;
  characterGearSlots!: Table<CharacterGearSlot, string>;
  memories!: Table<Memory, string>;
  pendingMemories!: Table<PendingMemory, string>;
  modelLibrary!: Table<ModelLibraryEntry, string>;
  migrationMetadata!: Table<MigrationMetadata, string>;
  sourceFiles!: Table<SourceFile, string>;
  inventoryItems!: Table<InventoryItem, string>;
  inventoryLogs!: Table<InventoryLog, string>;
  deltaSessions!: Table<DeltaSession, string>;
  deltaMessages!: Table<DeltaMessage, string>;
  deltaEntities!: Table<DeltaEntity, string>;
  deltaAllyCache!: Table<DeltaAllyCacheEntry, string>;
  deltaActionMacros!: Table<DeltaActionMacro, string>;
  characterActionSlots!: Table<CharacterActionSlot, string>;
  characterActionMacros!: Table<CharacterActionMacro, string>;

  constructor(name = "mirror-2") {
    super(name);
    this.version(1).stores({
      settings: "id",
      projects: "id, orderIndex, pinned, updatedAt",
      chats: "id, [projectId+updatedAt], projectId, activeBranchId, archived",
      branches: "id, chatId, rootMessageId",
      messages: "id, [chatId+branchId+sequence], chatId, branchId, parentMessageId, sequence, starred",
      stars: "id, [projectId+updatedAt], messageId, chatId",
      archives: "id, [projectId+updatedAt], projectId",
      archiveEntries: "id, [archiveId+orderIndex], archiveId",
      attachments: "id, [ownerType+ownerId]",
      characters: "id, [projectId+normalisedName], projectId",
      characterBonuses: "id, characterId, stat",
      memories: "id, [projectId+updatedAt], projectId, *normalisedTags, archived",
      pendingMemories: "id, projectId, updatedAt",
      modelLibrary: "id, modelId, orderIndex",
      migrationMetadata: "id, schemaVersion",
      sourceFiles: "id, [projectId+updatedAt], projectId",
      inventoryItems: "id, [projectId+kind+normalisedName], projectId, kind, updatedAt",
      inventoryLogs: "id, [projectId+updatedAt], projectId"
    });
    this.version(2).stores({
      settings: "id",
      projects: "id, orderIndex, pinned, locked, updatedAt",
      chats: "id, [projectId+updatedAt], projectId, activeBranchId, archived",
      branches: "id, chatId, rootMessageId",
      messages: "id, [chatId+branchId+sequence], chatId, branchId, parentMessageId, sequence, starred",
      stars: "id, [projectId+updatedAt], messageId, chatId",
      archives: "id, [projectId+updatedAt], projectId",
      archiveEntries: "id, [archiveId+orderIndex], archiveId",
      attachments: "id, [ownerType+ownerId]",
      characters: "id, [projectId+normalisedName], projectId",
      characterBonuses: "id, characterId, stat",
      memories: "id, [projectId+updatedAt], projectId, *normalisedTags, archived",
      pendingMemories: "id, projectId, updatedAt",
      modelLibrary: "id, modelId, orderIndex",
      migrationMetadata: "id, schemaVersion",
      sourceFiles: "id, [projectId+updatedAt], projectId",
      inventoryItems: "id, [projectId+kind+normalisedName], projectId, kind, updatedAt",
      inventoryLogs: "id, [projectId+updatedAt], projectId"
    });
    this.version(3).stores({
      settings: "id",
      projects: "id, orderIndex, pinned, locked, updatedAt",
      chats: "id, [projectId+updatedAt], projectId, activeBranchId, archived",
      branches: "id, chatId, rootMessageId",
      messages: "id, [chatId+branchId+sequence], chatId, branchId, parentMessageId, sequence, starred",
      stars: "id, [projectId+updatedAt], messageId, chatId",
      archives: "id, [projectId+updatedAt], projectId",
      archiveEntries: "id, [archiveId+orderIndex], archiveId",
      attachments: "id, [ownerType+ownerId]",
      characters: "id, [projectId+normalisedName], projectId",
      characterBonuses: "id, characterId, stat",
      memories: "id, [projectId+updatedAt], projectId, *normalisedTags, archived",
      pendingMemories: "id, projectId, updatedAt",
      modelLibrary: "id, modelId, orderIndex",
      migrationMetadata: "id, schemaVersion",
      sourceFiles: "id, [projectId+updatedAt], projectId",
      inventoryItems: "id, [projectId+kind+normalisedName], projectId, kind, updatedAt",
      inventoryLogs: "id, [projectId+updatedAt], projectId"
    });
    this.version(4).stores({
      settings: "id",
      projects: "id, orderIndex, pinned, locked, updatedAt",
      chats: "id, [projectId+updatedAt], projectId, activeBranchId, archived",
      branches: "id, chatId, rootMessageId",
      messages: "id, [chatId+branchId+sequence], chatId, branchId, parentMessageId, sequence, starred",
      stars: "id, [projectId+updatedAt], messageId, chatId",
      archives: "id, [projectId+updatedAt], projectId",
      archiveEntries: "id, [archiveId+orderIndex], archiveId",
      attachments: "id, [ownerType+ownerId]",
      characters: "id, [projectId+normalisedName], [projectId+orderIndex], projectId",
      characterBonuses: "id, characterId, stat",
      memories: "id, [projectId+updatedAt], projectId, *normalisedTags, archived",
      pendingMemories: "id, projectId, updatedAt",
      modelLibrary: "id, modelId, orderIndex",
      migrationMetadata: "id, schemaVersion",
      sourceFiles: "id, [projectId+updatedAt], projectId",
      inventoryItems: "id, [projectId+kind+normalisedName], projectId, kind, updatedAt",
      inventoryLogs: "id, [projectId+updatedAt], projectId"
    });
    this.version(5).stores({
      settings: "id",
      projects: "id, orderIndex, pinned, locked, updatedAt",
      chats: "id, [projectId+updatedAt], projectId, activeBranchId, archived",
      branches: "id, chatId, rootMessageId",
      messages: "id, [chatId+branchId+sequence], chatId, branchId, parentMessageId, sequence, starred",
      stars: "id, [projectId+updatedAt], messageId, chatId",
      archives: "id, [projectId+updatedAt], projectId",
      archiveEntries: "id, [archiveId+orderIndex], archiveId",
      attachments: "id, [ownerType+ownerId]",
      characters: "id, [projectId+normalisedName], [projectId+orderIndex], projectId",
      characterBonuses: "id, characterId, stat",
      memories: "id, [projectId+updatedAt], projectId, *normalisedTags, archived",
      pendingMemories: "id, projectId, updatedAt",
      modelLibrary: "id, modelId, orderIndex",
      migrationMetadata: "id, schemaVersion",
      sourceFiles: "id, [projectId+updatedAt], projectId",
      inventoryItems: "id, [projectId+kind+normalisedName], projectId, kind, updatedAt",
      inventoryLogs: "id, [projectId+updatedAt], projectId",
      deltaSessions: "id, [projectId+updatedAt], projectId, active",
      deltaMessages: "id, [sessionId+sequence], sessionId, sequence",
      deltaEntities: "id, [sessionId+orderIndex], sessionId, orderIndex"
    });
    this.version(6).stores({
      settings: "id",
      projects: "id, orderIndex, pinned, locked, updatedAt",
      chats: "id, [projectId+updatedAt], projectId, activeBranchId, archived",
      branches: "id, chatId, rootMessageId",
      messages: "id, [chatId+branchId+sequence], chatId, branchId, parentMessageId, sequence, starred",
      stars: "id, [projectId+updatedAt], messageId, chatId",
      archives: "id, [projectId+updatedAt], projectId",
      archiveEntries: "id, [archiveId+orderIndex], archiveId",
      attachments: "id, [ownerType+ownerId]",
      characters: "id, [projectId+normalisedName], [projectId+orderIndex], projectId",
      characterBonuses: "id, characterId, stat",
      memories: "id, [projectId+updatedAt], projectId, *normalisedTags, archived",
      pendingMemories: "id, projectId, updatedAt",
      modelLibrary: "id, modelId, orderIndex",
      migrationMetadata: "id, schemaVersion",
      sourceFiles: "id, [projectId+updatedAt], projectId",
      inventoryItems: "id, [projectId+kind+normalisedName], projectId, kind, updatedAt",
      inventoryLogs: "id, [projectId+updatedAt], projectId",
      deltaSessions: "id, [chatId+updatedAt], chatId, projectId, active",
      deltaMessages: "id, [sessionId+sequence], sessionId, sequence",
      deltaEntities: "id, [sessionId+orderIndex], sessionId, orderIndex"
    });
    this.version(7).stores({
      settings: "id",
      projects: "id, orderIndex, pinned, locked, updatedAt",
      chats: "id, [projectId+updatedAt], projectId, activeBranchId, archived",
      branches: "id, chatId, rootMessageId",
      messages: "id, [chatId+branchId+sequence], chatId, branchId, parentMessageId, sequence, starred",
      stars: "id, [projectId+updatedAt], messageId, chatId",
      archives: "id, [projectId+updatedAt], projectId",
      archiveEntries: "id, [archiveId+orderIndex], archiveId",
      attachments: "id, [ownerType+ownerId]",
      characters: "id, [projectId+normalisedName], [projectId+orderIndex], projectId",
      characterBonuses: "id, characterId, stat",
      memories: "id, [projectId+updatedAt], projectId, *normalisedTags, archived",
      pendingMemories: "id, projectId, updatedAt",
      modelLibrary: "id, modelId, orderIndex",
      migrationMetadata: "id, schemaVersion",
      sourceFiles: "id, [projectId+updatedAt], projectId",
      inventoryItems: "id, [projectId+kind+normalisedName], projectId, kind, updatedAt",
      inventoryLogs: "id, [projectId+updatedAt], projectId",
      deltaSessions: "id, [chatId+updatedAt], chatId, projectId, active",
      deltaMessages: "id, [sessionId+sequence], sessionId, sequence",
      deltaEntities: "id, [sessionId+orderIndex], sessionId, orderIndex",
      deltaActionMacros: "id, [chatId+parentId+orderIndex], chatId, parentId, orderIndex"
    });
    this.version(8).stores({
      settings: "id",
      projects: "id, orderIndex, pinned, locked, updatedAt",
      chats: "id, [projectId+updatedAt], projectId, activeBranchId, archived",
      branches: "id, chatId, rootMessageId",
      messages: "id, [chatId+branchId+sequence], chatId, branchId, parentMessageId, sequence, starred",
      stars: "id, [projectId+updatedAt], messageId, chatId",
      archives: "id, [projectId+updatedAt], projectId",
      archiveEntries: "id, [archiveId+orderIndex], archiveId",
      attachments: "id, [ownerType+ownerId]",
      characters: "id, [projectId+normalisedName], [projectId+orderIndex], projectId",
      characterBonuses: "id, characterId, stat",
      memories: "id, [projectId+updatedAt], projectId, *normalisedTags, archived",
      pendingMemories: "id, projectId, updatedAt",
      modelLibrary: "id, modelId, orderIndex",
      migrationMetadata: "id, schemaVersion",
      sourceFiles: "id, [projectId+updatedAt], projectId",
      inventoryItems: "id, [chatId+kind+normalisedName], chatId, projectId, kind, updatedAt",
      inventoryLogs: "id, [chatId+updatedAt], chatId, projectId",
      deltaSessions: "id, [chatId+updatedAt], chatId, projectId, active",
      deltaMessages: "id, [sessionId+sequence], sessionId, sequence",
      deltaEntities: "id, [sessionId+orderIndex], sessionId, orderIndex",
      deltaActionMacros: "id, [chatId+parentId+orderIndex], chatId, parentId, orderIndex"
    });
    this.version(9).stores({
      settings: "id",
      projects: "id, orderIndex, pinned, locked, updatedAt",
      chats: "id, [projectId+updatedAt], projectId, activeBranchId, archived",
      branches: "id, chatId, rootMessageId",
      messages: "id, [chatId+branchId+sequence], chatId, branchId, parentMessageId, sequence, starred",
      stars: "id, [projectId+updatedAt], messageId, chatId",
      archives: "id, [projectId+updatedAt], projectId",
      archiveEntries: "id, [archiveId+orderIndex], archiveId",
      attachments: "id, [ownerType+ownerId]",
      characters: "id, [projectId+normalisedName], [projectId+orderIndex], projectId",
      characterBonuses: "id, characterId, stat",
      memories: "id, [projectId+updatedAt], projectId, *normalisedTags, archived",
      pendingMemories: "id, projectId, updatedAt",
      modelLibrary: "id, modelId, orderIndex",
      migrationMetadata: "id, schemaVersion",
      sourceFiles: "id, [projectId+updatedAt], projectId",
      inventoryItems: "id, [chatId+kind+normalisedName], chatId, projectId, kind, updatedAt",
      inventoryLogs: "id, [chatId+updatedAt], chatId, projectId",
      deltaSessions: "id, [chatId+updatedAt], chatId, projectId, active",
      deltaMessages: "id, [sessionId+sequence], sessionId, sequence",
      deltaEntities: "id, [sessionId+orderIndex], sessionId, orderIndex",
      deltaAllyCache: "id, [chatId+updatedAt], chatId, name",
      deltaActionMacros: "id, [chatId+parentId+orderIndex], chatId, parentId, orderIndex"
    });
    this.version(10).stores({
      settings: "id",
      projects: "id, orderIndex, pinned, locked, updatedAt",
      chats: "id, [projectId+updatedAt], projectId, activeBranchId, archived",
      branches: "id, chatId, rootMessageId",
      messages: "id, [chatId+branchId+sequence], chatId, branchId, parentMessageId, sequence, starred",
      stars: "id, [projectId+updatedAt], messageId, chatId",
      archives: "id, [projectId+updatedAt], projectId",
      archiveEntries: "id, [archiveId+orderIndex], archiveId",
      attachments: "id, [ownerType+ownerId]",
      characters: "id, [projectId+normalisedName], [projectId+orderIndex], projectId",
      characterBonuses: "id, characterId, stat",
      characterActionSlots: "id, [characterId+orderIndex], characterId, orderIndex",
      characterActionMacros: "id, [slotId+parentId+orderIndex], slotId, parentId, orderIndex",
      memories: "id, [projectId+updatedAt], projectId, *normalisedTags, archived",
      pendingMemories: "id, projectId, updatedAt",
      modelLibrary: "id, modelId, orderIndex",
      migrationMetadata: "id, schemaVersion",
      sourceFiles: "id, [projectId+updatedAt], projectId",
      inventoryItems: "id, [chatId+kind+normalisedName], chatId, projectId, kind, updatedAt",
      inventoryLogs: "id, [chatId+updatedAt], chatId, projectId",
      deltaSessions: "id, [chatId+updatedAt], chatId, projectId, active",
      deltaMessages: "id, [sessionId+sequence], sessionId, sequence",
      deltaEntities: "id, [sessionId+orderIndex], sessionId, orderIndex",
      deltaAllyCache: "id, [chatId+updatedAt], chatId, name",
      deltaActionMacros: "id, [chatId+parentId+orderIndex], chatId, parentId, orderIndex"
    }).upgrade(async (transaction) => {
      await transaction.table("deltaActionMacros").clear();
    });
    this.version(11).stores({
      settings: "id",
      projects: "id, orderIndex, pinned, locked, updatedAt",
      chats: "id, [projectId+updatedAt], projectId, activeBranchId, archived",
      branches: "id, chatId, rootMessageId",
      messages: "id, [chatId+branchId+sequence], chatId, branchId, parentMessageId, sequence, starred",
      stars: "id, [projectId+updatedAt], messageId, chatId",
      archives: "id, [projectId+updatedAt], projectId",
      archiveEntries: "id, [archiveId+orderIndex], archiveId",
      attachments: "id, [ownerType+ownerId]",
      characters: "id, [projectId+normalisedName], [projectId+orderIndex], projectId",
      characterBonuses: "id, characterId, stat",
      characterGearSlots: "id, [characterId+slot], characterId, slot",
      characterActionSlots: "id, [characterId+orderIndex], characterId, orderIndex",
      characterActionMacros: "id, [slotId+parentId+orderIndex], slotId, parentId, orderIndex",
      memories: "id, [projectId+updatedAt], projectId, *normalisedTags, archived",
      pendingMemories: "id, projectId, updatedAt",
      modelLibrary: "id, modelId, orderIndex",
      migrationMetadata: "id, schemaVersion",
      sourceFiles: "id, [projectId+updatedAt], projectId",
      inventoryItems: "id, [chatId+kind+normalisedName], chatId, projectId, kind, updatedAt",
      inventoryLogs: "id, [chatId+updatedAt], chatId, projectId",
      deltaSessions: "id, [chatId+updatedAt], chatId, projectId, active",
      deltaMessages: "id, [sessionId+sequence], sessionId, sequence",
      deltaEntities: "id, [sessionId+orderIndex], sessionId, orderIndex",
      deltaAllyCache: "id, [chatId+updatedAt], chatId, name",
      deltaActionMacros: "id, [chatId+parentId+orderIndex], chatId, parentId, orderIndex"
    });
    this.version(12).stores({
      settings: "id",
      projects: "id, orderIndex, pinned, locked, updatedAt",
      chats: "id, [projectId+updatedAt], projectId, activeBranchId, archived",
      branches: "id, chatId, rootMessageId",
      messages: "id, [chatId+branchId+sequence], chatId, branchId, parentMessageId, sequence, starred",
      stars: "id, [projectId+updatedAt], messageId, chatId",
      archives: "id, [projectId+updatedAt], projectId",
      archiveEntries: "id, [archiveId+orderIndex], archiveId",
      attachments: "id, [ownerType+ownerId]",
      characters: "id, [projectId+normalisedName], [projectId+orderIndex], projectId",
      characterBonuses: "id, characterId, stat",
      characterGearSlots: "id, [characterId+slot], characterId, slot",
      characterActionSlots: "id, [characterId+orderIndex], characterId, orderIndex",
      characterActionMacros: "id, [slotId+parentId+orderIndex], slotId, parentId, orderIndex",
      memories: "id, [projectId+updatedAt], projectId, *normalisedTags, archived",
      pendingMemories: "id, projectId, updatedAt",
      modelLibrary: "id, modelId, orderIndex",
      migrationMetadata: "id, schemaVersion",
      sourceFiles: "id, [projectId+updatedAt], projectId",
      inventoryItems: "id, [chatId+kind+normalisedName], chatId, projectId, kind, updatedAt",
      inventoryLogs: "id, [chatId+updatedAt], chatId, projectId",
      deltaSessions: "id, [chatId+updatedAt], chatId, projectId, active",
      deltaMessages: "id, [sessionId+sequence], sessionId, sequence",
      deltaEntities: "id, [sessionId+orderIndex], sessionId, orderIndex",
      deltaAllyCache: "id, [chatId+updatedAt], chatId, name",
      deltaActionMacros: "id, [chatId+parentId+orderIndex], chatId, parentId, orderIndex"
    }).upgrade(async (transaction) => {
      await transaction.table("inventoryItems").filter((item) => item.kind === "gear").delete();
    });
  }
}

export const db = new MirrorDatabase();

export async function ensureSeedData(database = db) {
  const settings = await database.settings.get("settings");
  if (!settings) await database.settings.put(defaultSettings());

  const projectCount = await database.projects.count();
  if (projectCount === 0) await database.projects.add(sampleProject());
}
