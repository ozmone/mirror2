import { afterEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { buildSourceChunks, runSourceTool } from "./sources";
import type { SourceFile } from "../types";

const source = (id: string, overrides: Partial<SourceFile> = {}): SourceFile => ({
  id, projectId: "project", name: `${id}.md`, mimeType: "text/markdown", size: 50,
  textContent: "The observatory houses the celestial archive.", createdAt: 1, updatedAt: 1, ...overrides
});
afterEach(() => db.sourceFiles.clear());

describe("source lookup", () => {
  it("indexes original text into heading-aware chunks without rewriting it", () => {
    const text = "# Company\nThe authority watches the city.\n\n# Halo Tier\nThe licensed heroes answer to the Company.";
    const chunks = buildSourceChunks(text);
    expect(chunks.map((chunk) => chunk.text).join("\n")).toContain("The authority watches the city.");
    expect(chunks[0].heading).toBe("Company");
  });

  it("finds original text without cards and keeps listing, search and reads in the project", async () => {
    await db.sourceFiles.bulkAdd([source("local"), source("foreign", { projectId: "other" })]);
    const result = await runSourceTool("project", "search_sources", '{"query":"celestial"}');
    expect(result).toMatchObject({ totalMatches: 1, hits: [{ id: "local", passages: [{ start: 0, text: "The observatory houses the celestial archive." }] }] });
    expect(await runSourceTool("project", "list_sources", "{}")).toMatchObject({ sources: [{ id: "local", name: "local.md" }] });
    expect(await runSourceTool("project", "read_source", '{"sourceId":"foreign"}')).toHaveProperty("error");
    expect(await runSourceTool("project", "search_sources", '{"query":"celestial","sourceId":"foreign"}')).toMatchObject({ totalMatches: 0 });
  });
  it("reads long files in consecutive chunks", async () => {
    const file = source("long", { textContent: "A".repeat(25000) + "END" });
    await db.sourceFiles.add(file);
    expect(await runSourceTool("project", "read_source", '{"sourceId":"long","length":99999}')).toMatchObject({ end: 24000, nextStart: 24000 });
    expect(await runSourceTool("project", "read_source", '{"sourceId":"long","start":24000}')).toMatchObject({ text: "A".repeat(1000) + "END", nextStart: null });
  });
  it("rejects invalid arguments and reports unreadable sources", async () => {
    await db.sourceFiles.add(source("binary", { textContent: undefined }));
    for (const args of ["{", "null", "[]"]) expect(await runSourceTool("project", "list_sources", args)).toHaveProperty("error");
    expect(await runSourceTool("project", "read_source", '{"sourceId":"binary"}')).toHaveProperty("error");
    expect(await runSourceTool("project", "search_sources", '{"query":" "}')).toHaveProperty("error");
  });
});
