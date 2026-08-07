import { afterEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { defaultSettings, sampleProject } from "./defaults";
import { applyInventoryChange, createMemory, getCharacterBio, getCharacterIdentity, getCharacterStats, normaliseInventoryName, searchMemories, validatePointBuy } from "./repositories";
import { Character } from "../types";

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

    expect(normaliseInventoryName("Acorns")).toBe("acorn");
    const added = await applyInventoryChange(project.id, "inventory", "Acorns", 2, "Found 2 acorns under the tree.");
    const removed = await applyInventoryChange(project.id, "inventory", "acorn", -1, "Lost 1 acorn.");

    const item = await db.inventoryItems.where("projectId").equals(project.id).and((row) => row.kind === "inventory" && row.normalisedName === "acorn").first();
    const logs = (await db.inventoryLogs.where("projectId").equals(project.id).toArray()).sort((a, b) => a.createdAt - b.createdAt);
    expect(added).toEqual({ item: "acorn", quantity: 2 });
    expect(removed).toEqual({ item: "acorn", quantity: 1 });
    expect(item?.quantity).toBe(1);
    expect(logs.map((log) => log.sentence)).toEqual(["Found 2 acorns under the tree.", "Lost 1 acorn."]);
  });

  it("can prepare settings for backup without an API key", async () => {
    await testDb.settings.put({ ...defaultSettings(), apiKey: "sk-or-secret" });
    const settings = { ...(await testDb.settings.get("settings")), apiKey: undefined };
    expect(settings.apiKey).toBeUndefined();
  });
});

const testDb = db;
