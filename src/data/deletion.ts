import { db } from "./db";

/** Shared by chat deletion and resend; attachments must disappear with their messages. */
export async function deleteMessages(messageIds: string[], database = db) {
  if (!messageIds.length) return;
  await database.transaction("rw", [database.messages, database.stars, database.attachments], async () => {
    await database.attachments.where("[ownerType+ownerId]").anyOf(messageIds.map((id) => ["message", id])).delete();
    await database.stars.where("messageId").anyOf(messageIds).delete();
    await database.messages.bulkDelete(messageIds);
  });
}

export async function deleteCharacters(characterIds: string[], database = db) {
  if (!characterIds.length) return;
  await database.transaction("rw", [database.characters, database.characterBonuses, database.characterGearSlots, database.characterActionSlots, database.characterActionMacros, database.attachments], async () => {
    await database.characterBonuses.where("characterId").anyOf(characterIds).delete();
    await database.characterGearSlots.where("characterId").anyOf(characterIds).delete();
    const slotIds = await database.characterActionSlots.where("characterId").anyOf(characterIds).primaryKeys();
    if (slotIds.length) await database.characterActionMacros.where("slotId").anyOf(slotIds).delete();
    await database.characterActionSlots.where("characterId").anyOf(characterIds).delete();
    await database.attachments.where("[ownerType+ownerId]").anyOf(characterIds.map((id) => ["character", id])).delete();
    await database.characters.bulkDelete(characterIds);
  });
}

export async function deleteProject(projectId: string, database = db) {
  const tables = [database.projects, database.chats, database.branches, database.messages, database.stars,
    database.attachments, database.archives, database.archiveEntries, database.characters, database.characterBonuses,
    database.characterGearSlots, database.characterActionSlots, database.characterActionMacros, database.memories,
    database.pendingMemories, database.sourceFiles, database.inventoryItems, database.inventoryLogs,
    database.deltaSessions, database.deltaMessages, database.deltaEntities, database.deltaAllyCache,
    database.deltaActionMacros, database.deltaEffects, database.deltaIcons];
  await database.transaction("rw", tables, async () => {
    const chatIds = await database.chats.where("projectId").equals(projectId).primaryKeys();
    const archiveIds = await database.archives.where("projectId").equals(projectId).primaryKeys();
    const characterIds = await database.characters.where("projectId").equals(projectId).primaryKeys();
    const sourceIds = await database.sourceFiles.where("projectId").equals(projectId).primaryKeys();
    const entryIds = await database.archiveEntries.where("archiveId").anyOf(archiveIds).primaryKeys();
    const messageIds = await database.messages.where("chatId").anyOf(chatIds).primaryKeys();
    const sessionIds = await database.deltaSessions.where("chatId").anyOf(chatIds).primaryKeys();
    await deleteMessages(messageIds, database);
    await deleteCharacters(characterIds, database);
    if (sourceIds.length) await database.attachments.where("[ownerType+ownerId]").anyOf(sourceIds.map((id) => ["sourceFile", id])).delete();
    if (entryIds.length) await database.attachments.where("[ownerType+ownerId]").anyOf(entryIds.map((id) => ["archiveEntry", id])).delete();
    await database.archiveEntries.bulkDelete(entryIds);
    await database.archives.bulkDelete(archiveIds);
    await database.branches.where("chatId").anyOf(chatIds).delete();
    await database.deltaMessages.where("sessionId").anyOf(sessionIds).delete();
    await database.deltaEntities.where("sessionId").anyOf(sessionIds).delete();
    await database.deltaSessions.bulkDelete(sessionIds);
    await database.deltaAllyCache.where("chatId").anyOf(chatIds).delete();
    await database.deltaActionMacros.where("chatId").anyOf(chatIds).delete();
    await database.chats.bulkDelete(chatIds);
    for (const table of [database.stars, database.memories, database.pendingMemories, database.sourceFiles,
      database.inventoryItems, database.inventoryLogs, database.deltaEffects, database.deltaIcons]) {
      await table.where("projectId").equals(projectId).delete();
    }
    await database.projects.delete(projectId);
  });
}
