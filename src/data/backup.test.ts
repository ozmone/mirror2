import { afterEach, describe, expect, it } from "vitest";
import { createFullBackup, decodeBackupValue, encodeBackupValue, replaceWithFullBackup } from "./backup";
import { MirrorDatabase } from "./db";

const databases: MirrorDatabase[] = [];

afterEach(async () => {
  await Promise.all(databases.map(async (database) => {
    database.close();
    await database.delete();
  }));
  databases.length = 0;
});

describe("full database backups", () => {
  it("includes every runtime table, blobs, gear, and data omitted by the old exporter", async () => {
    const database = new MirrorDatabase(`backup-test-${crypto.randomUUID()}`);
    databases.push(database);
    await database.settings.put({ id: "settings", apiKey: "secret", theme: "onyx", accent: "sage", font: "system", fontSize: "standard", fontScale: 1, bubbleMode: "bubbles", bubbleScope: "global", entryWidth: 80, messageSpacing: 4, privacyPreset: "balanced", createdAt: 1, updatedAt: 1 });
    await database.characterBonuses.put({ id: "bonus", characterId: "character", name: "Lucky", stat: "CHA", value: 1, createdAt: 1, updatedAt: 1 });
    await database.pendingMemories.put({ id: "pending", projectId: "project", text: "Remember this", normalisedTags: [], createdAt: 1, updatedAt: 1 } as never);
    await database.deltaActionMacros.put({ id: "delta-macro", chatId: "chat", parentId: "", orderIndex: 0, name: "Action", body: "Do it", createdAt: 1, updatedAt: 1 } as never);
    await database.inventoryItems.put({ id: "gear", projectId: "project", chatId: "chat", kind: "gear", name: "Sword", normalisedName: "sword", quantity: 1, unitWeightKg: 1, createdAt: 1, updatedAt: 1 });

    const backup = await createFullBackup(database);

    expect(backup.tableNames).toEqual(database.tables.map((table) => table.name).sort());
    expect(JSON.stringify(backup)).not.toContain("secret");
    const encodedBlob = await encodeBackupValue(new Blob(["hello"], { type: "text/plain" }));
    expect(encodedBlob).toMatchObject({ __mirrorBackupValue: "blob", type: "text/plain" });
    const decodedBlob = await decodeBackupValue(encodedBlob);
    expect(decodedBlob).toBeInstanceOf(Blob);
    expect((decodedBlob as Blob).size).toBe(5);
    await Promise.all(database.tables.map((table) => table.clear()));
    await replaceWithFullBackup(backup, database);

    expect(await database.characterBonuses.count()).toBe(1);
    expect(await database.pendingMemories.count()).toBe(1);
    expect(await database.deltaActionMacros.count()).toBe(1);
    expect((await database.inventoryItems.get("gear"))?.kind).toBe("gear");
    expect((await database.settings.get("settings"))?.apiKey).toBeUndefined();
  });
});
