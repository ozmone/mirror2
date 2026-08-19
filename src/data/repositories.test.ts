import { afterEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { defaultDeltaBases, defaultSettings, sampleProject } from "./defaults";
import { addDeltaMessage, applyDeltaDamage, applyInventoryChange, createChat, createMemory, formatDeltaTemplateTag, generatedDeltaStats, getCharacterBio, getCharacterIdentity, getCharacterStats, messagesForIncrementalCompaction, normaliseInventoryName, searchMemories, validatePointBuy } from "./repositories";
import { Character, DeltaRollReceipt, Message } from "../types";

describe("local data rules", () => {
  afterEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });

  it("normalises tags and keeps memory search inside the active project", async () => {
    const first = sampleProject();
    const second = { ...sampleProject(), id: "other-project", name: "Other" };
    await testDb.projects.bulkAdd([first, second]);
    await createMemory(first.id, "Jaeger dislikes icecream.", ["Jaeger", "Ice Cream"]);
    await createMemory(second.id, "Other project memory about icecream.", ["icecream"]);

    const found = await searchMemories(first.id, ["ice cream"], "icecream");

    expect(found).toHaveLength(1);
    expect(found[0].text).toContain("Jaeger");
    expect(found[0].relevance).toBeGreaterThan(0);
  });

  it("selects only newly expired completed messages for incremental compaction", () => {
    const message = (sequence: number, status: Message["status"] = "complete"): Message => ({
      id: `message-${sequence}`,
      chatId: "chat",
      branchId: "branch",
      sequence,
      role: sequence % 2 ? "assistant" : "user",
      body: status === "pending" ? "..." : `Message ${sequence}`,
      status,
      starred: false,
      estimatedTokens: true,
      createdAt: sequence,
      updatedAt: sequence
    });
    const history = [message(0), message(1), message(2), message(3), message(4), message(5), message(6, "pending")];

    expect(messagesForIncrementalCompaction(history, 4).map((row) => row.sequence)).toEqual([0, 1]);
    expect(messagesForIncrementalCompaction(history, 4, 0).map((row) => row.sequence)).toEqual([1]);
    expect(messagesForIncrementalCompaction(history, 2).map((row) => row.sequence)).toEqual([0, 1, 2, 3]);
    expect(messagesForIncrementalCompaction(history, 10)).toEqual([]);
  });

  it("returns only the requested character division", async () => {
    const project = sampleProject();
    const character: Character = {
      id: "character-1",
      projectId: project.id,
      name: "Jaeger",
      normalisedName: "jaeger",
      age: "29",
      gender: "male",
      personality: "dry, stubborn",
      misc: "hates icecream",
      bio: "A field medic with a long memory.",
      statsEnabled: true,
      str: 8,
      dex: 15,
      con: 14,
      int: 10,
      wis: 12,
      cha: 8,
      createdAt: 1,
      updatedAt: 1
    };
    await testDb.projects.add(project);
    await testDb.characters.add(character);
    await testDb.characterBonuses.add({ id: "bonus-1", characterId: character.id, name: "training", stat: "DEX", value: 2, createdAt: 1, updatedAt: 1 });

    expect(await getCharacterIdentity(project.id, character.id)).toEqual({
      character: "Jaeger",
      identity: {
        age: "29",
        gender: "male",
        personality: "dry, stubborn",
        misc: "hates icecream"
      }
    });
    expect(await getCharacterBio(project.id, character.id)).toEqual({
      character: "Jaeger",
      bio: "A field medic with a long memory."
    });
    expect(await getCharacterStats(project.id, character.id)).toEqual({
      character: "Jaeger",
      stats: {
        STR: 8,
        DEX: 17,
        CON: 14,
        INT: 10,
        WIS: 12,
        CHA: 8
      }
    });
  });

  it("validates 27 point-buy limits", () => {
    expect(validatePointBuy({ str: 8, dex: 15, con: 14, int: 10, wis: 12, cha: 8 })).toBe(true);
    expect(validatePointBuy({ str: 15, dex: 15, con: 15, int: 15, wis: 15, cha: 15 })).toBe(false);
    expect(validatePointBuy({ str: 7, dex: 15, con: 14, int: 10, wis: 12, cha: 8 })).toBe(false);
  });

  it("normalises inventory item names to singular and logs changes", async () => {
    const project = sampleProject();
    await testDb.projects.add(project);
    const chatId = await createChat(project.id, "Inventory test");

    expect(normaliseInventoryName("Acorns")).toBe("acorn");
    const added = await applyInventoryChange(project.id, chatId, "inventory", "Acorns", 2, "Found 2 acorns under the tree.");
    const removed = await applyInventoryChange(project.id, chatId, "inventory", "acorn", -1, "Lost 1 acorn.");

    const item = await db.inventoryItems.where("chatId").equals(chatId).and((row) => row.kind === "inventory" && row.normalisedName === "acorn").first();
    const logs = (await db.inventoryLogs.where("chatId").equals(chatId).toArray()).sort((a, b) => a.createdAt - b.createdAt);
    expect(added).toEqual({ item: "acorn", quantity: 2 });
    expect(removed).toEqual({ item: "acorn", quantity: 1 });
    expect(item?.quantity).toBe(1);
    expect(logs.map((log) => log.sentence)).toEqual(["Found 2 acorns under the tree.", "Lost 1 acorn."]);
  });

  it("keeps Delta generated template tags readable and derives stats from labels", () => {
    const project = {
      ...sampleProject(),
      deltaDefaultNpcStats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
      deltaPrefixes: [{ id: "prefix-dex", label: "DEX", statModifiers: { DEX: 1 } }],
      deltaBases: defaultDeltaBases(),
      deltaJobs: [{ id: "job-rogue", label: "ROGUE", category: "street", statModifiers: { DEX: 2, CHA: 1 } }]
    };

    expect(formatDeltaTemplateTag("DEX", "LIGHT", "ROGUE")).toBe("DEX-LIGHT ROGUE");
    const generated = generatedDeltaStats(project, { prefix: "DEX", base: "LIGHT", job: "ROGUE", jobCategory: "street" });

    expect(generated.templateTag).toBe("DEX-LIGHT ROGUE");
    expect(generated.prefix).toBe("DEX");
    expect(generated.base).toBe("LIGHT");
    expect(generated.job).toBe("ROGUE");
    expect(generated.scores).toEqual({ STR: 9, DEX: 15, CON: 9, INT: 10, WIS: 10, CHA: 11 });
    expect(generated.maxHp).toBe(4);
  });

  it("applies character PREFIX BASE JOB tags to saved character stats", async () => {
    const project = {
      ...sampleProject(),
      deltaDefaultNpcStats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
      deltaPrefixes: [{ id: "prefix-int", label: "INT", statModifiers: { INT: 1 } }],
      deltaBases: defaultDeltaBases(),
      deltaJobs: [{ id: "job-sharpshooter", label: "SHARPSHOOTER", category: "ranged", statModifiers: { DEX: 2, WIS: 1 } }]
    };
    const character: Character = {
      id: "legolas",
      projectId: project.id,
      name: "Legolas",
      normalisedName: "legolas",
      age: "",
      gender: "",
      personality: "",
      misc: "",
      bio: "",
      statsEnabled: true,
      str: 10,
      dex: 14,
      con: 10,
      int: 11,
      wis: 12,
      cha: 10,
      prefix: "INT",
      base: "LIGHT",
      jobCategory: "ranged",
      job: "SHARPSHOOTER",
      createdAt: 1,
      updatedAt: 1
    };
    await testDb.projects.add(project);
    await testDb.characters.add(character);

    expect(await getCharacterStats(project.id, character.id)).toEqual({
      character: "Legolas",
      stats: {
        STR: 9,
        DEX: 14,
        CON: 9,
        INT: 11,
        WIS: 11,
        CHA: 10
      }
    });
  });

  it("does not apply imported JOB modifiers to custom character builds", async () => {
    const project = {
      ...sampleProject(),
      deltaDefaultNpcStats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
      deltaPrefixes: [{ id: "prefix-int", label: "INT", statModifiers: { INT: 1 } }],
      deltaBases: defaultDeltaBases(),
      deltaJobs: [{ id: "job-sharpshooter", label: "SHARPSHOOTER", category: "ranged", statModifiers: { DEX: 2, WIS: 1 } }]
    };
    const character: Character = {
      id: "custom-ranger",
      projectId: project.id,
      name: "Custom Ranger",
      normalisedName: "custom-ranger",
      age: "",
      gender: "",
      personality: "",
      misc: "",
      bio: "",
      statsEnabled: true,
      str: 10,
      dex: 14,
      con: 10,
      int: 11,
      wis: 12,
      cha: 10,
      prefix: "INT",
      base: "LIGHT",
      jobCategory: "ranged",
      job: "SHARPSHOOTER",
      buildMode: "custom",
      customJobName: "Ranger",
      createdAt: 1,
      updatedAt: 1
    };
    await testDb.projects.add(project);
    await testDb.characters.add(character);

    expect(await getCharacterStats(project.id, character.id)).toEqual({
      character: "Custom Ranger",
      stats: {
        STR: 9,
        DEX: 16,
        CON: 9,
        INT: 12,
        WIS: 12,
        CHA: 10
      }
    });
  });

  it("can prepare settings for backup without an API key", async () => {
    await testDb.settings.put({ ...defaultSettings(), apiKey: "sk-or-secret" });
    const settings = { ...(await testDb.settings.get("settings")), apiKey: undefined };
    expect(settings.apiKey).toBeUndefined();
  });

  it("persists app-generated Delta roll receipts on their own turn event", async () => {
    const receipt: DeltaRollReceipt = {
      id: "roll-receipt-1",
      source: "client-web-crypto",
      generator: "crypto.getRandomValues",
      algorithm: "uint32-rejection-sampling-v1",
      toolName: "request_delta_roll",
      rollerName: "Jaeger",
      label: "disarm contest",
      die: 20,
      count: 1,
      rawValues: [123456789],
      results: [10],
      generatedAt: 1
    };

    const message = await addDeltaMessage("delta-session-1", "system", "Jaeger: Roll disarm contest: d20 = 10", {
      turnNumber: 7,
      eventType: "roll",
      rollReceipt: receipt
    });

    expect(await testDb.deltaMessages.get(message.id)).toMatchObject({
      turnNumber: 7,
      eventType: "roll",
      rollReceipt: receipt
    });
  });

  it("subtracts Delta damage once through its verified roll receipt", async () => {
    const receipt: DeltaRollReceipt = {
      id: "damage-receipt-1",
      source: "client-web-crypto",
      generator: "crypto.getRandomValues",
      algorithm: "uint32-rejection-sampling-v1",
      toolName: "request_delta_roll",
      rollerName: "Jaeger",
      label: "damage",
      die: 8,
      count: 1,
      rawValues: [1],
      results: [2],
      generatedAt: 1
    };
    const rollMessage = await addDeltaMessage("delta-session-1", "system", "Jaeger: Roll damage: d8 = 2", {
      turnNumber: 1,
      eventType: "roll",
      rollReceipt: receipt
    });
    await testDb.deltaEntities.add({
      id: "unknown-figure-2",
      sessionId: "delta-session-1",
      name: "Unknown Figure 2",
      side: "hostile",
      currentHp: 4,
      maxHp: 4,
      orderIndex: 0,
      createdAt: 1,
      updatedAt: 1
    });

    expect(await applyDeltaDamage("delta-session-1", "unknown-figure-2", 2, receipt.id)).toMatchObject({ beforeHp: 4, damage: 2, afterHp: 2 });
    expect(await applyDeltaDamage("delta-session-1", "unknown-figure-2", 2, receipt.id)).toMatchObject({ duplicate: true, currentHp: 2 });
    expect((await testDb.deltaEntities.get("unknown-figure-2"))?.currentHp).toBe(2);
    expect((await testDb.deltaMessages.get(rollMessage.id))?.rollReceipt?.hpApplications).toEqual([
      expect.objectContaining({ entityName: "Unknown Figure 2", beforeHp: 4, amount: 2, afterHp: 2 })
    ]);
  });

  it("marks a zero-HP Delta entity KO or DEAD through the damage operation", async () => {
    const receipt: DeltaRollReceipt = {
      id: "lethal-damage-receipt",
      source: "client-web-crypto",
      generator: "crypto.getRandomValues",
      algorithm: "uint32-rejection-sampling-v1",
      toolName: "request_delta_roll",
      rollerName: "Halle",
      label: "damage",
      die: 8,
      count: 1,
      rawValues: [9],
      results: [8],
      generatedAt: 1
    };
    await addDeltaMessage("delta-session-2", "system", "Halle: Roll damage: d8 = 8", {
      turnNumber: 1,
      eventType: "roll",
      rollReceipt: receipt
    });
    await testDb.deltaEntities.add({
      id: "hostile-1",
      sessionId: "delta-session-2",
      name: "Enforcer",
      side: "hostile",
      currentHp: 3,
      maxHp: 3,
      orderIndex: 0,
      createdAt: 1,
      updatedAt: 1
    });

    expect(await applyDeltaDamage("delta-session-2", "hostile-1", 8, receipt.id, "dead")).toMatchObject({ afterHp: 0, engagementState: "dead" });
    expect(await testDb.deltaEntities.get("hostile-1")).toMatchObject({ currentHp: 0, engagementState: "dead" });
  });

  it("persists project-scoped Delta effects and reusable icon assets", async () => {
    await testDb.deltaIcons.add({
      id: "icon-1",
      projectId: "project-1",
      name: "Bandaged",
      dataUrl: "data:image/png;base64,AA==",
      sourceModel: "image-model",
      sourcePrompt: "bandage",
      createdAt: 1,
      updatedAt: 1
    });
    await testDb.deltaEffects.add({
      id: "effect-1",
      projectId: "project-1",
      name: "Bleeding",
      polarity: "negative",
      iconId: "icon-1",
      effectText: "Subtract 1 HP every turn.",
      curable: true,
      cureText: "Bandage and apply pressure.",
      cureEndBehavior: "retain",
      ko: false,
      koText: "",
      koEndBehavior: "remove",
      targetSelf: true,
      targetOthers: true,
      targetAllies: true,
      targetNeutral: true,
      targetEnemies: true,
      targetMode: "single",
      savingThrowEnabled: true,
      savingThrowStat: "CON",
      savingThrowMinimum: 12,
      savingThrowTiming: "every-turn",
      cancelledByStatus: false,
      cancellationPolarity: "positive",
      cancelledByEffectIds: [],
      createdAt: 1,
      updatedAt: 1
    });

    expect(await testDb.deltaEffects.where("projectId").equals("project-1").first()).toMatchObject({ name: "Bleeding", iconId: "icon-1", savingThrowTiming: "every-turn" });
    expect(await testDb.deltaIcons.where("projectId").equals("project-1").first()).toMatchObject({ name: "Bandaged", dataUrl: "data:image/png;base64,AA==" });
  });
});

const testDb = db;
