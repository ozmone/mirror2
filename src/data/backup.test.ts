import { afterEach, describe, expect, it } from "vitest";
import { createFullBackup, createProjectBackup, createRecoverySnapshot, decodeBackupValue, encodeBackupValue, replaceWithFullBackup, restoreProjectBackup, restoreRecoverySnapshot, unclassifiedProjectBackupTables } from "./backup";
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
  it("coalesces concurrent recovery snapshots and preserves restorable data", async () => {
    const database = new MirrorDatabase(`backup-test-${crypto.randomUUID()}`);
    databases.push(database);
    await database.characterBonuses.put({ id: "bonus", characterId: "character", name: "Lucky", stat: "CHA", value: 1, createdAt: 1, updatedAt: 1 });
    const first = createRecoverySnapshot(database);
    expect(createRecoverySnapshot(database)).toBe(first);
    const snapshot = await first;
    await database.characterBonuses.clear();
    await restoreRecoverySnapshot(snapshot.slot, database);
    expect(await database.characterBonuses.count()).toBe(1);
    expect((await createRecoverySnapshot(database)).slot).not.toBe(snapshot.slot);
  });
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

describe("project backups", () => {
  it("covers every current content table and restores a complete project without touching another project", async () => {
    const source = new MirrorDatabase(`project-backup-source-${crypto.randomUUID()}`);
    const target = new MirrorDatabase(`project-backup-target-${crypto.randomUUID()}`);
    databases.push(source, target);
    const stamp = 1;
    const project = { id: "project", name: "Campaign", iconName: "book", iconColor: "blue", orderIndex: 0, pinned: false, instructions: "Keep the voice.", worldSetting: "World", memoryMode: "automatic" as const, memoryInstruction: "Remember.", inventoryEnabled: true, gearEnabled: true, createdAt: stamp, updatedAt: stamp };
    await source.settings.put({ id: "settings", apiKey: "secret", theme: "onyx", accent: "sage", font: "system", fontSize: "standard", fontScale: 1, bubbleMode: "bubbles", bubbleScope: "global", entryWidth: 80, messageSpacing: 4, privacyPreset: "balanced", includeInstructions: true, createdAt: stamp, updatedAt: stamp });
    await source.modelLibrary.put({ id: "model", modelId: "model/test", cosmeticName: "Test", orderIndex: 0, createdAt: stamp, updatedAt: stamp });
    await source.projects.put(project);
    await source.chats.put({ id: "chat", projectId: project.id, title: "Story", titleState: "manual", activeBranchId: "branch", archived: false, compactionMemory: "Summary", createdAt: stamp, updatedAt: stamp });
    await source.branches.put({ id: "branch", chatId: "chat", label: "Main", createdAt: stamp, updatedAt: stamp });
    await source.messages.put({ id: "message", chatId: "chat", branchId: "branch", sequence: 1, role: "user", body: "Hello", estimatedTokens: false, starred: true, status: "complete", createdAt: stamp, updatedAt: stamp });
    await source.stars.put({ id: "star", projectId: project.id, chatId: "chat", branchId: "branch", messageId: "message", role: "user", bodyCopy: "Hello", createdAt: stamp, updatedAt: stamp });
    await source.archives.put({ id: "archive", projectId: project.id, name: "Notes", createdAt: stamp, updatedAt: stamp });
    await source.archiveEntries.put({ id: "entry", archiveId: "archive", header: "Entry", body: "Body", orderIndex: 0, createdAt: stamp, updatedAt: stamp });
    await source.characters.put({ id: "character", projectId: project.id, name: "Hero", normalisedName: "hero", age: "", gender: "", personality: "", misc: "", bio: "", profileAttachmentId: "character-image", statsEnabled: false, str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8, createdAt: stamp, updatedAt: stamp });
    await source.characterBonuses.put({ id: "bonus", characterId: "character", name: "Lucky", stat: "CHA", value: 1, createdAt: stamp, updatedAt: stamp });
    await source.characterGearSlots.put({ id: "gear-slot", characterId: "character", slot: "head", itemName: "Hat", createdAt: stamp, updatedAt: stamp });
    await source.characterBackgroundDetails.put({ id: "detail", projectId: project.id, characterId: "character", text: "Background", tags: ["past"], normalisedTags: ["past"], createdAt: stamp, updatedAt: stamp });
    await source.characterActionSlots.put({ id: "action-slot", characterId: "character", name: "Attack", orderIndex: 0, createdAt: stamp, updatedAt: stamp });
    await source.characterActionMacros.put({ id: "macro", slotId: "action-slot", label: "Strike", orderIndex: 0, createdAt: stamp, updatedAt: stamp });
    await source.memories.put({ id: "memory", projectId: project.id, text: "Fact", normalisedTags: [], visibleTags: [], sourceType: "manual", recallCount: 0, relevance: 0, archived: false, createdAt: stamp, updatedAt: stamp });
    await source.pendingMemories.put({ id: "pending", projectId: project.id, text: "Maybe", tags: [], reason: "", confidence: 1, sourceMessageIds: ["message"], createdAt: stamp, updatedAt: stamp });
    await source.sourceFiles.put({ id: "source", projectId: project.id, name: "world.png", mimeType: "image/png", size: 3, attachmentId: "source-image", createdAt: stamp, updatedAt: stamp });
    await source.chatSources.put({ id: "chat-source", projectId: project.id, chatId: "chat", name: "State", textContent: "Now", internal: true, kind: "last-confirmed-story-state", createdAt: stamp, updatedAt: stamp });
    await source.inventoryItems.put({ id: "item", projectId: project.id, chatId: "chat", kind: "inventory", name: "Torch", normalisedName: "torch", quantity: 1, createdAt: stamp, updatedAt: stamp });
    await source.inventoryLogs.put({ id: "log", projectId: project.id, chatId: "chat", sentence: "Found torch", createdAt: stamp, updatedAt: stamp });
    await source.deltaSessions.put({ id: "session", projectId: project.id, chatId: "chat", title: "Fight", active: true, settings: {}, createdAt: stamp, updatedAt: stamp });
    await source.deltaMessages.put({ id: "delta-message", sessionId: "session", sequence: 1, role: "user", body: "Act", status: "complete", createdAt: stamp, updatedAt: stamp });
    await source.deltaEntities.put({ id: "entity", sessionId: "session", name: "Enemy", side: "hostile", imageAttachmentId: "delta-image", orderIndex: 0, createdAt: stamp, updatedAt: stamp });
    await source.deltaAllyCache.put({ id: "ally", chatId: "chat", name: "Friend", createdAt: stamp, updatedAt: stamp });
    await source.deltaActionMacros.put({ id: "delta-macro", chatId: "chat", label: "Move", orderIndex: 0, createdAt: stamp, updatedAt: stamp });
    await source.deltaEffects.put({ id: "effect", projectId: project.id, name: "Poison", polarity: "negative", effectText: "", curable: false, cureText: "", cureEndBehavior: "remove", ko: false, koText: "", koEndBehavior: "remove", targetSelf: true, targetOthers: false, targetAllies: false, targetNeutral: false, targetEnemies: true, targetMode: "single", savingThrowEnabled: false, savingThrowTiming: "inflict", cancelledByStatus: false, cancellationPolarity: "positive", cancelledByEffectIds: [], createdAt: stamp, updatedAt: stamp });
    await source.deltaIcons.put({ id: "icon", projectId: project.id, name: "Skull", dataUrl: "data:image/png;base64,AA==", createdAt: stamp, updatedAt: stamp });
    await source.timelineEntries.put({ id: "timeline", projectId: project.id, orderIndex: 0, title: "Start", body: "Started", sourceMessageIds: ["message"], createdAt: stamp, updatedAt: stamp });
    for (const [id, ownerType, ownerId] of [["message-image", "message", "message"], ["entry-image", "archiveEntry", "entry"], ["character-image", "character", "character"], ["source-image", "sourceFile", "source"]] as const) await source.attachments.put({ id, ownerType, ownerId, mimeType: "image/png", size: 3, blob: new Blob(["img"]), createdAt: stamp, updatedAt: stamp });
    await source.attachments.put({ id: "delta-image", ownerType: "message", ownerId: "external-reference", mimeType: "image/png", size: 3, blob: new Blob(["img"]), createdAt: stamp, updatedAt: stamp });

    const backup = await createProjectBackup(project.id, source);
    expect(unclassifiedProjectBackupTables(source)).toEqual([]);
    expect(backup.tableCounts.attachments).toBe(5);
    expect(backup.tableCounts.messages).toBe(1);
    expect(JSON.stringify(backup)).not.toContain("secret");

    await target.projects.put({ ...project, id: "other", name: "Keep me" });
    await restoreProjectBackup(backup, target);
    const restored = await createProjectBackup(project.id, target);
    expect(restored.tableCounts).toEqual(backup.tableCounts);
    expect((await target.projects.get("other"))?.name).toBe("Keep me");
    expect(await target.attachments.get("source-image")).toMatchObject({ ownerId: "source" });
    expect(await target.attachments.get("delta-image")).toMatchObject({ ownerId: "external-reference" });
    expect((await target.settings.get("settings"))?.apiKey).toBeUndefined();
  });
});
