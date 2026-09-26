import { afterEach, describe, expect, it } from "vitest";
import { MirrorDatabase } from "./db";
import { deleteCharacters, deleteMessages, deleteProject } from "./deletion";

const databases: MirrorDatabase[] = [];
function database() {
  const value = new MirrorDatabase(`deletion-test-${crypto.randomUUID()}`);
  databases.push(value);
  return value;
}
afterEach(async () => { await Promise.all(databases.splice(0).map((value) => value.delete())); });

async function seedProject(db: MirrorDatabase, projectId: string) {
  const id = (name: string) => `${projectId}-${name}`;
  const rows: Record<string, object[]> = {
    projects: [{ id: projectId }],
    chats: [{ id: id("chat"), projectId }],
    branches: [{ id: id("branch"), chatId: id("chat") }],
    messages: [{ id: id("message"), chatId: id("chat"), branchId: id("branch"), sequence: 0 }],
    stars: [{ id: id("star"), projectId, chatId: id("chat"), messageId: id("message") }],
    characters: [{ id: id("character"), projectId }],
    characterBonuses: [{ id: id("bonus"), characterId: id("character") }],
    characterGearSlots: [{ id: id("gear"), characterId: id("character") }],
    characterActionSlots: [{ id: id("slot"), characterId: id("character") }],
    characterActionMacros: [{ id: id("macro"), slotId: id("slot") }],
    archives: [{ id: id("archive"), projectId }],
    archiveEntries: [{ id: id("entry"), archiveId: id("archive") }],
    sourceFiles: [{ id: id("source"), projectId }],
    memories: [{ id: id("memory"), projectId }],
    pendingMemories: [{ id: id("pending"), projectId }],
    inventoryItems: [{ id: id("inventory"), projectId, chatId: id("chat") }],
    inventoryLogs: [{ id: id("log"), projectId, chatId: id("chat") }],
    deltaSessions: [{ id: id("session"), chatId: id("chat") }],
    deltaMessages: [{ id: id("delta-message"), sessionId: id("session") }],
    deltaEntities: [{ id: id("entity"), sessionId: id("session") }],
    deltaAllyCache: [{ id: id("ally"), chatId: id("chat") }],
    deltaActionMacros: [{ id: id("delta-macro"), chatId: id("chat") }],
    deltaEffects: [{ id: id("effect"), projectId }],
    deltaIcons: [{ id: id("icon"), projectId }],
    attachments: ["message", "character", "sourceFile", "archiveEntry"].map((ownerType, index) => ({
      id: id(`attachment-${index}`), ownerType,
      ownerId: id(["message", "character", "source", "entry"][index]), blob: new Blob(["image"])
    }))
  };
  for (const [name, records] of Object.entries(rows)) await db.table(name).bulkPut(records);
  return Object.keys(rows);
}

describe("owned-data deletion", () => {
  it("removes all project-owned rows and blobs while preserving a second project", async () => {
    const db = database();
    const tables = await seedProject(db, "deleted");
    await seedProject(db, "kept");
    await deleteProject("deleted", db);
    for (const table of tables) {
      const rows = await db.table(table).toArray();
      expect(rows.length, table).toBe(table === "attachments" ? 4 : 1);
      expect(rows.every((row) => row.id.startsWith("kept")), table).toBe(true);
    }
  });

  it("deletes selected messages and their stars/images without touching other owners", async () => {
    const db = database();
    await seedProject(db, "p");
    await db.messages.put({ id: "kept-message", chatId: "p-chat" } as never);
    await deleteMessages(["p-message"], db);
    expect(await db.messages.get("p-message")).toBeUndefined();
    expect(await db.messages.get("kept-message")).toBeDefined();
    expect(await db.stars.count()).toBe(0);
    expect((await db.attachments.toArray()).map((row) => row.ownerType).sort()).toEqual(["archiveEntry", "character", "sourceFile"]);
  });

  it("uses the same complete cleanup for single and bulk character deletion", async () => {
    const db = database();
    await seedProject(db, "p");
    await deleteCharacters(["p-character"], db);
    for (const table of [db.characters, db.characterBonuses, db.characterGearSlots, db.characterActionSlots, db.characterActionMacros]) expect(await table.count()).toBe(0);
    expect(await db.attachments.count()).toBe(3);
    expect(await db.projects.count()).toBe(1);
  });

  it("rolls back earlier deletions when any later part of project cleanup fails", async () => {
    const db = database();
    await seedProject(db, "p");
    db.sourceFiles.hook("deleting", () => { throw new Error("Storage failure"); });
    await expect(deleteProject("p", db)).rejects.toThrow("Storage failure");
    expect(await db.messages.count()).toBe(1);
    expect(await db.characters.count()).toBe(1);
    expect(await db.attachments.count()).toBe(4);
    expect(await db.projects.count()).toBe(1);
  });
});
