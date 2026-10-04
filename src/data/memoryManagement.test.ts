import { afterEach, expect, it } from "vitest";
import { MirrorDatabase } from "./db";
import { hasMemoryManagementEntries, runMemoryManagementTool, type MemoryManagementSession } from "./memoryManagement";
import { sampleProject } from "./defaults";
import { timelineEntries, updateTimelineContinuity } from "./timeline";
import type { Chat, Memory } from "../types";

const databases: MirrorDatabase[] = [];
afterEach(async () => { await Promise.all(databases.splice(0).map((database) => database.delete())); });

async function setup() {
  const database = new MirrorDatabase(`memory-management-${crypto.randomUUID()}`);
  databases.push(database);
  await database.projects.put({ ...sampleProject(), id: "project" });
  const chat: Chat = { id: "chat", projectId: "project", title: "Story", activeBranchId: "main", titleState: "manual", archived: false, compactionMemory: "Compaction stays intact", compactionEnabled: true, timelineContinuityEnabled: true, createdAt: 1, updatedAt: 1 };
  await database.chats.put(chat);
  const memory: Memory = { id: "memory", projectId: "project", text: "Mara trusts Ellis.", visibleTags: [], normalisedTags: [], recallCount: 0, relevance: 5, archived: false, sourceType: "automatic", createdAt: 1, updatedAt: 1 };
  await database.memories.bulkPut([memory, { ...memory, id: "foreign", projectId: "other" }]);
  await database.pendingMemories.put({ id: "pending", projectId: "project", text: "Ellis keeps a journal.", tags: [], reason: "Durable", confidence: 1, sourceMessageIds: [], createdAt: 1, updatedAt: 1 });
  await database.messages.put({ id: "reply", chatId: chat.id, branchId: "main", sequence: 1, role: "assistant", body: "Mara arrived.", estimatedTokens: true, starred: false, status: "complete", createdAt: 1, updatedAt: 1 });
  await database.timelineEntries.put({ id: "timeline:reply", projectId: "project", orderIndex: 0, title: "Arrival", body: "Mara arrived.", sourceChatId: chat.id, sourceBranchId: "main", sourceSequence: 1, sourceMessageIds: ["reply"], createdAt: 1, updatedAt: 1 });
  const session: MemoryManagementSession = new Map();
  const run = (name: string, args: object) => runMemoryManagementTool("project", name, JSON.stringify(args), session, database);
  return { database, chat, session, run };
}

it("finds exact saved, pending, and timeline records only in the active project", async () => {
  const { run, database } = await setup();
  expect(await hasMemoryManagementEntries("project", database)).toBe(true);
  expect(await hasMemoryManagementEntries("empty", database)).toBe(false);
  const result = await run("find_memory_entries", { module: "all", query: "" });
  expect(result).toMatchObject({ total: 3, nextOffset: null, entries: [
    { id: "memory", module: "memories", text: "Mara trusts Ellis." },
    { id: "pending", module: "pending" }, { id: "timeline:reply", module: "timeline", title: "Arrival" }
  ] });
  expect(await run("find_memory_entries", { module: "timeline", query: "arrival mara" })).toMatchObject({ total: 1 });
  expect(await run("find_memory_entries", { module: "memories", query: "missing" })).toMatchObject({ entries: [] });
  await database.timelineEntries.update("timeline:reply", { includedInContext: false });
  expect(await run("find_memory_entries", { module: "timeline", query: "" })).toMatchObject({ entries: [] });
});

it("requires a lookup receipt and rejects guessed IDs, other projects, changed entries, and compaction", async () => {
  const { run, database, session } = await setup();
  expect(await run("delete_memory_entry", { module: "memories", entryId: "memory" })).toHaveProperty("error");
  await run("find_memory_entries", { module: "all", query: "" });
  expect(await run("delete_memory_entry", { module: "memories", entryId: "foreign" })).toHaveProperty("error");
  expect(await run("delete_memory_entry", { module: "compaction", entryId: "chat" })).toHaveProperty("error");
  expect(await run("find_memory_entries", { module: "compaction", query: "" })).toHaveProperty("error");
  await database.memories.update("memory", { text: "User corrected this memory." });
  expect(await run("delete_memory_entry", { module: "memories", entryId: "memory" })).toMatchObject({ deleted: false });
  await run("find_memory_entries", { module: "memories", query: "corrected" });
  await database.memories.update("memory", { projectId: "other" });
  expect(await run("delete_memory_entry", { module: "memories", entryId: "memory" })).toMatchObject({ deleted: false });
  expect(await runMemoryManagementTool("other", "delete_memory_entry", '{"module":"memories","entryId":"memory"}', session, database)).toHaveProperty("error");
  expect((await database.chats.get("chat"))?.compactionMemory).toBe("Compaction stays intact");
});

it("deletes saved/pending records and suppresses timeline regeneration without altering chat or compaction", async () => {
  const { database, chat, run } = await setup();
  await run("find_memory_entries", { module: "all", query: "" });
  for (const [module, entryId] of [["memories", "memory"], ["pending", "pending"], ["timeline", "timeline:reply"]]) {
    expect(await run("delete_memory_entry", { module, entryId })).toMatchObject({ deleted: true, module, entryId });
  }
  expect(await database.memories.get("memory")).toBeUndefined();
  expect(await database.memories.get("foreign")).toBeDefined();
  expect(await database.pendingMemories.count()).toBe(0);
  expect(await timelineEntries("project", database)).toEqual([]);
  expect(await database.timelineEntries.get("timeline:reply")).toMatchObject({ deleted: true });
  await updateTimelineContinuity(chat.id, "model", async () => { throw new Error("Deleted entries must not be re-reviewed"); }, database);
  expect(await database.chats.get(chat.id)).toMatchObject({ compactionMemory: "Compaction stays intact", compactionEnabled: true });
  expect(await database.messages.get("reply")).toMatchObject({ body: "Mara arrived." });
});

it("paginates lookup results and rejects malformed arguments without mutation", async () => {
  const { database, run, session } = await setup();
  const memory = (await database.memories.get("memory"))!;
  await database.memories.bulkPut(Array.from({ length: 30 }, (_, index) => ({ ...memory, id: `many-${index}`, text: `Extra fact ${index}` })));
  expect(await run("find_memory_entries", { module: "memories", query: "Extra" })).toMatchObject({ total: 30, nextOffset: 25 });
  const last = await run("find_memory_entries", { module: "memories", query: "Extra", offset: 25 });
  expect(last).toMatchObject({ nextOffset: null });
  expect("entries" in last ? last.entries : undefined).toHaveLength(5);
  for (const raw of ["null", "[]", "not JSON", '{"module":"memories","entryId":4}']) {
    expect(await runMemoryManagementTool("project", "delete_memory_entry", raw, session, database)).toHaveProperty("error");
  }
  expect(await database.memories.count()).toBe(32);
});
