import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./db";
import { importCastSources, isCastSource } from "./castImport";
import { defaultSettings } from "./defaults";
import { findCharacters, getCharacterBio, getCharacterIdentity } from "./repositories";
import type { SourceFile } from "../types";

const source = (id: string, textContent: string, projectId = "project", name = `cast_${id}.md`): SourceFile => ({ id, name, textContent, projectId, mimeType: "text/markdown", size: textContent.length, createdAt: 1, updatedAt: 1 });
const extracted = (name: string, bio: string[], fields: Partial<Record<"age" | "gender" | "personality" | "misc", string[]>> = {}) => ({ name, bio, age: [], gender: [], personality: [], misc: [], ...fields });
const response = (characters: ReturnType<typeof extracted>[]) => ({ ok: true, json: async () => ({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ characters }) } }] }) });
beforeEach(async () => { await db.settings.put({ ...defaultSettings(), apiKey: "test-key", defaultModelId: "test-model" }); });
afterEach(async () => { vi.unstubAllGlobals(); await db.sourceFiles.clear(); await db.characters.clear(); await db.settings.clear(); });

describe("AI cast imports", () => {
  it("removes duplicated name and age lines from Jaeger's bio while retaining narrative", async () => {
    const original = "name: Jaeger\nage: 38\nJaeger survived the siege.\nHe still dreams about it.";
    await db.sourceFiles.add(source("jaeger", original));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response([extracted("Jaeger", [original], { age: ["38"] })])));
    await importCastSources("project", ["jaeger"]);
    expect((await db.characters.toArray())[0]).toMatchObject({ name: "Jaeger", age: "38", bio: "Jaeger survived the siege.\nHe still dreams about it." });
  });

  it("keeps a deliberately empty bio empty when only identity information exists", async () => {
    await db.sourceFiles.add(source("jaeger", "name: Jaeger\nage: 38"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response([extracted("Jaeger", [], { age: ["38"] })])));
    await importCastSources("project", ["jaeger"]);
    expect((await db.characters.toArray())[0]).toMatchObject({ name: "Jaeger", age: "38", bio: "" });
  });

  it("does not recover the entire file when a bio is omitted", async () => {
    await db.sourceFiles.add(source("sparse", "World notes: a distant planet.\nKairos eats shit\nBeth flies."));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ characters: [{ name: "Kairos" }] }) } }] }) }));
    await importCastSources("project", ["sparse"]);
    expect((await db.characters.toArray())[0].bio).toBe("Kairos eats shit");
  });

  it.each([
    { name: "Kairos", bio: "Kairos eats shit" },
    { name: "Kairos", bio: ["Kairos eats shit"], age: null, misc: "" },
    { name: "Kairos" },
  ])("imports sparse entries and tolerates omitted or plain-text fields: %j", async (character) => {
    await db.sourceFiles.add(source("sparse", "Kairos eats shit"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ characters: [character] }) } }] }) }));
    expect(await importCastSources("project", ["sparse"])).toMatchObject({ imported: 1 });
    expect((await db.characters.toArray())[0]).toMatchObject({ name: "Kairos", bio: "Kairos eats shit", age: "", gender: "", personality: "", misc: "" });
  });

  it("recovers missing bios for multiple sparse entries from their source paragraphs", async () => {
    await db.sourceFiles.add(source("sparse", "Kairos eats shit\n\nBeth flies."));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ characters: [{ name: "Kairos" }, { name: "Beth" }] }) } }] }) }));
    await importCastSources("project", ["sparse"]);
    const characters = await db.characters.toArray();
    expect(characters.find((character) => character.name === "Kairos")?.bio).toBe("Kairos eats shit");
    expect(characters.find((character) => character.name === "Beth")?.bio).toBe("Beth flies.");
  });

  it("processes only selected files and rejects empty or unavailable selections before calling AI", async () => {
    await db.sourceFiles.bulkAdd([source("a", "Alice: selected character"), source("b", "Beth: unselected character"), source("foreign", "Other project", "other")]);
    const request = vi.fn().mockResolvedValue(response([extracted("Alice", ["Alice: selected character"])]));
    vi.stubGlobal("fetch", request);
    for (const ids of [[], ["missing"], ["foreign"], ["a", "missing"]]) await expect(importCastSources("project", ids)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    expect(await importCastSources("project", ["a"])).toMatchObject({ files: 1, imported: 1 });
    expect(request).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(request.mock.calls[0][1].body).messages[1].content;
    expect(sent).toContain("Alice: selected character");
    expect(sent).not.toContain("Beth: unselected character");
  });

  it("matches arbitrary cast suffixes and case while excluding other files", () => {
    expect(["cast_Girls.md", "CAST_Unity.MD", "cast_my group.md"].every(isCastSource)).toBe(true);
    expect(["cast_.md", "cast.md", "forecast_Girls.md", "cast_Girls.txt"].some(isCastSource)).toBe(false);
  });

  it("preserves uncategorized narrative and fills identity fields for chat lookup", async () => {
    const original = "Alice is 24, a woman; stubborn, but kind.\r\n\r\nShe wears **blue**.  Never red!\r\n- Keeps an old compass.\r\n- Won’t sell it.\r\n";
    await db.sourceFiles.add(source("a", original));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response([extracted("Alice", [], { age: ["24"], gender: ["woman"], personality: ["stubborn, but kind"], misc: ["She wears **blue**.  Never red!", "- Keeps an old compass.\r\n- Won’t sell it."] })])));
    await importCastSources("project", ["a"]);
    const [alice] = await findCharacters("project", "Alice");
    expect(await getCharacterBio("project", alice.id)).toEqual({ character: "Alice", bio: "" });
    expect(await getCharacterIdentity("project", alice.id)).toEqual({ character: "Alice", identity: { age: "24", gender: "woman", personality: "stubborn, but kind", misc: "She wears **blue**.  Never red!\n\n- Keeps an old compass.\r\n- Won’t sell it." } });
    expect((await db.characters.get(alice.id))?.bio).not.toContain("Source:");
    expect((await db.characters.get(alice.id))?.bio).not.toContain("cast_a.md");
  });

  it("imports same-name entries from separate files and creates fresh entries on repeat import", async () => {
    await db.sourceFiles.bulkAdd([source("a", "Alice flies. Beth is her sister."), source("b", "Alice owns a red ship.")]);
    const request = vi.fn().mockResolvedValueOnce(response([extracted("Alice", ["Alice flies. Beth is her sister."]), extracted("Beth", ["Beth is her sister."])])).mockResolvedValueOnce(response([extracted("Alice", ["Alice owns a red ship."])]));
    vi.stubGlobal("fetch", request);
    expect(await importCastSources("project", ["a", "b"])).toMatchObject({ files: 2, imported: 3 });
    const matches = await findCharacters("project", "Alice");
    expect(matches).toHaveLength(2);
    const alice = matches[0];
    await db.characters.update(alice.id, { bio: "User edited bio", misc: "User notes" });
    request.mockResolvedValueOnce(response([extracted("Alice", ["Alice flies."])])).mockResolvedValueOnce(response([extracted("Alice", ["Alice owns a red ship."])]));
    expect(await importCastSources("project", ["a", "b"])).toMatchObject({ imported: 2 });
    expect(await db.characters.get(alice.id)).toMatchObject({ bio: "User edited bio", misc: "User notes" });
    expect(await db.characters.count()).toBe(5);
  });

  it("preserves a long character passage across overlapping chunks without duplicating or dropping text", async () => {
    const original = "Alice\n" + "x".repeat(24000) + "tail";
    await db.sourceFiles.add(source("long", original));
    const request = vi.fn().mockResolvedValueOnce(response([extracted("Alice", [original.slice(0, 24000)])])).mockResolvedValueOnce(response([extracted("Alice", [original.slice(22000)])]));
    vi.stubGlobal("fetch", request);
    await importCastSources("project", ["long"]);
    expect(request).toHaveBeenCalledTimes(2);
    expect((await db.characters.toArray())[0].bio).toBe(original.slice("Alice\n".length));
  });

  it("rejects paraphrased biographies, changed identity text and invented names without saving", async () => {
    await db.sourceFiles.add(source("a", "Alice is 24 and stubborn."));
    for (const character of [
      extracted("Alice", ["Alice is a stubborn 24-year-old."]),
      extracted("Alice", ["Alice is 24 and stubborn."], { personality: ["Determined"] }),
      extracted("Alicia", ["Alice is 24 and stubborn."]),
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response([character])));
      await expect(importCastSources("project", ["a"])).rejects.toThrow("No changes were saved");
      expect(await db.characters.count()).toBe(0);
    }
  });

  it("saves nothing when a later AI result is invalid or truncated", async () => {
    await db.sourceFiles.bulkAdd([source("a", "Alice"), source("b", "Beth")]);
    for (const choice of [{ message: { content: "invalid" } }, { finish_reason: "length", message: { content: '{"characters":[]}' } }]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response([extracted("Alice", ["Alice"])])).mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [choice] }) }));
      await expect(importCastSources("project", ["a", "b"])).rejects.toThrow("No changes were saved");
      expect(await db.characters.count()).toBe(0);
    }
  });
});
