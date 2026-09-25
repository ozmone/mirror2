import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./db";
import { importCastSources, isCastSource } from "./castImport";
import { defaultSettings } from "./defaults";
import { findCharacters, getCharacterBio } from "./repositories";
import type { SourceFile } from "../types";

const source = (id: string, textContent: string, projectId = "project", name = `cast_${id}.md`): SourceFile => ({ id, name, textContent, projectId, mimeType: "text/markdown", size: textContent.length, createdAt: 1, updatedAt: 1 });
const response = (characters: { name: string; bio: string }[]) => ({ ok: true, json: async () => ({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ characters }) } }] }) });
beforeEach(async () => { await db.settings.put({ ...defaultSettings(), apiKey: "test-key", defaultModelId: "test-model" }); });
afterEach(async () => { vi.unstubAllGlobals(); await db.sourceFiles.clear(); await db.characters.clear(); await db.settings.clear(); });

describe("AI cast imports", () => {
  it("matches arbitrary cast suffixes and case while excluding other files", () => {
    expect(["cast_Girls.md", "CAST_Unity.MD", "cast_my group.md"].every(isCastSource)).toBe(true);
    expect(["cast_.md", "cast.md", "forecast_Girls.md", "cast_Girls.txt"].some(isCastSource)).toBe(false);
  });

  it("imports same-name entries from separate sources and exposes details through chat lookup", async () => {
    await db.sourceFiles.bulkAdd([source("a", "Alice flies. Beth is her sister."), source("b", "Alice / owns a red ship"), source("c", "Foreign", "other"), source("d", "World", "project", "world.md")]);
    const request = vi.fn().mockResolvedValueOnce(response([{ name: "Alice", bio: "Alice flies. Beth is her sister." }, { name: "Beth", bio: "Beth is Alice's sister." }])).mockResolvedValueOnce(response([{ name: "ALICE", bio: "Owns a red ship." }]));
    vi.stubGlobal("fetch", request);
    expect(await importCastSources("project")).toMatchObject({ files: 2, imported: 3 });
    expect(request).toHaveBeenCalledTimes(2);
    const payload = JSON.parse(request.mock.calls[0][1].body);
    expect(payload.model).toBe("test-model");
    expect(payload.messages[1].content).toContain("Alice flies. Beth is her sister.");
    const matches = await findCharacters("project", "Alice");
    expect(matches).toHaveLength(2);
    const bios = await Promise.all(matches.map((character) => getCharacterBio("project", character.id)));
    expect(bios.some((entry) => entry?.bio.includes("Owns a red ship."))).toBe(true);
    expect(bios.some((entry) => entry?.bio.includes("Beth is her sister."))).toBe(true);
    const alice = matches[0];
    await db.characters.update(alice.id, { misc: "User notes" });
    request.mockResolvedValueOnce(response([{ name: "Alice", bio: "Alice flies." }])).mockResolvedValueOnce(response([{ name: "Alice", bio: "Owns a red ship." }]));
    expect(await importCastSources("project")).toMatchObject({ imported: 2 });
    expect(await db.characters.get(alice.id)).toMatchObject({ misc: "User notes" });
    expect(await db.characters.count()).toBe(5);
  });

  it("creates new entries on repeat import without skipping or changing existing characters", async () => {
    await db.sourceFiles.add(source("a", "Alice pilots a ship."));
    const request = vi.fn().mockResolvedValue(response([{ name: "Alice", bio: "Pilots a ship." }]));
    vi.stubGlobal("fetch", request);
    await importCastSources("project");
    const [alice] = await db.characters.toArray();
    await db.characters.update(alice.id, { bio: "My edited biography" });
    await db.sourceFiles.add(source("b", "Alice has a pet owl."));
    request.mockResolvedValueOnce(response([{ name: "Alice", bio: "Pilots a ship." }])).mockResolvedValueOnce(response([{ name: "Alice", bio: "Has a pet owl." }]));
    expect(await importCastSources("project")).toMatchObject({ imported: 2 });
    expect((await db.characters.get(alice.id))?.bio).toBe("My edited biography");
    const rows = await db.characters.toArray();
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.id)).size).toBe(3);
    expect(rows.every((row) => row.name === "Alice")).toBe(true);
    expect(rows.some((row) => row.bio.includes("Has a pet owl."))).toBe(true);
  });

  it("reads every part of long sources and merges a character across passages", async () => {
    await db.sourceFiles.add(source("long", "x".repeat(24000) + "tail"));
    const request = vi.fn().mockResolvedValueOnce(response([{ name: "Alice", bio: "First details" }])).mockResolvedValueOnce(response([{ name: "Alice", bio: "Later details" }]));
    vi.stubGlobal("fetch", request);
    await importCastSources("project");
    expect(request).toHaveBeenCalledTimes(2);
    expect(JSON.parse(request.mock.calls[1][1].body).messages[1].content).toContain("tail");
    expect((await db.characters.toArray())[0].bio).toContain("Later details");
  });

  it("saves nothing when a later AI result is invalid or truncated", async () => {
    await db.sourceFiles.bulkAdd([source("a", "Alice"), source("b", "Beth")]);
    for (const choice of [{ message: { content: "invalid" } }, { finish_reason: "length", message: { content: '{"characters":[]}' } }]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response([{ name: "Alice", bio: "Pilot" }])).mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [choice] }) }));
      await expect(importCastSources("project")).rejects.toThrow("No changes were saved");
      expect(await db.characters.count()).toBe(0);
    }
  });
});
