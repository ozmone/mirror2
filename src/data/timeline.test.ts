import { afterEach, expect, it, vi } from "vitest";
import Dexie from "dexie";
import { MirrorDatabase } from "./db";
import { defaultSettings, sampleProject } from "./defaults";
import { createFullBackup, replaceWithFullBackup } from "./backup";
import { deleteMessages, deleteProject } from "./deletion";
import { addTimelineEntry, formatTimelineContinuity, invalidateTimelineMessages, moveTimelineEntry, timelineEntries, timelineHistoryBoundary, updateTimelineContinuity } from "./timeline";
import type { Chat, Message } from "../types";

const databases: MirrorDatabase[] = [];
afterEach(async () => { await Promise.all(databases.splice(0).map((database) => database.delete())); });

it("upgrades existing databases without losing chats or changing their compaction preference", async () => {
  const database = new MirrorDatabase(`timeline-upgrade-${crypto.randomUUID()}`);
  databases.push(database);
  const legacy = new Dexie(database.name);
  const stores = Object.fromEntries(database.tables.filter((table) => table.name !== "timelineEntries")
    .map((table) => [table.name, [table.schema.primKey.src, ...table.schema.indexes.map((index) => index.src)].join(", ")]));
  legacy.version(15).stores(stores);
  await legacy.table("settings").put({ ...defaultSettings(), compactionEnabled: true });
  await legacy.table("chats").put({ id: "legacy", projectId: "p", compactionMemory: "Keep this outline." });
  legacy.close();
  await database.open();
  expect(await database.chats.get("legacy")).toMatchObject({ compactionEnabled: true, timelineContinuityEnabled: false, compactionMemory: "Keep this outline." });
  expect(await database.timelineEntries.count()).toBe(0);
});

async function setup() {
  const database = new MirrorDatabase(`timeline-${crypto.randomUUID()}`);
  databases.push(database);
  const project = { ...sampleProject(), id: "project" };
  await database.projects.put(project);
  const chat: Chat = { id: "chat", projectId: project.id, activeBranchId: "main", title: "Observatory", titleState: "manual", archived: false, compactionMemory: "", timelineContinuityEnabled: true, createdAt: 1, updatedAt: 1 };
  await database.chats.put(chat);
  const messages: Message[] = [
    { id: "user", chatId: chat.id, branchId: "main", role: "user", body: "Enter the observatory.", sequence: 0, status: "complete", estimatedTokens: true, starred: false, createdAt: 900, updatedAt: 900 },
    { id: "reply", chatId: chat.id, branchId: "main", role: "assistant", body: "Mara entered through the maintenance passage.", sequence: 1, status: "complete", estimatedTokens: true, starred: false, createdAt: 2, updatedAt: 2 }
  ];
  await database.messages.bulkPut(messages);
  return { database, project, chat, messages };
}

function result(sourceMessageId = "reply", title = "Arrival", body = "Mara entered the observatory.") {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ entries: [{ sourceMessageId, title, body }] }) } }] }));
}

it("waits for history overflow and captures a whole turn at a split boundary only once", async () => {
  const { database, chat, messages } = await setup();
  const history = Array.from({ length: 10 }, (_, index): Message => ({ ...messages[index % 2], id: index < 2 ? messages[index].id : `recent-${index}`, sequence: index }));
  await database.messages.bulkPut(history);
  expect(timelineHistoryBoundary(history, 10)).toBeUndefined();
  const withPrompt: Message[] = [...history, { ...messages[0], id: "next-prompt", sequence: 10 }];
  expect(timelineHistoryBoundary(withPrompt)).toBeUndefined();
  expect(timelineHistoryBoundary(withPrompt, 10)).toBe(2);
  const request = vi.fn(async () => result());
  await updateTimelineContinuity(chat.id, "model", request, database, timelineHistoryBoundary(withPrompt, 10));
  await updateTimelineContinuity(chat.id, "model", request, database, timelineHistoryBoundary(withPrompt, 10));
  expect(request).toHaveBeenCalledTimes(1);
  expect(await database.timelineEntries.count()).toBe(1);
});

it("excludes unchecked entries from AI review context and preserves exclusion when rebuilt", async () => {
  const { database, project, chat } = await setup();
  const manual = await addTimelineEntry(project.id, "Hidden fact", "The secret door is blue.", database);
  await database.timelineEntries.update(manual.id, { includedInContext: false });
  await updateTimelineContinuity(chat.id, "model", async (payload) => {
    expect(JSON.stringify(payload)).not.toContain("The secret door is blue");
    return result();
  }, database);
  await database.timelineEntries.update("timeline:reply", { includedInContext: false, stale: true });
  await updateTimelineContinuity(chat.id, "model", async () => result(), database);
  expect(await database.timelineEntries.get("timeline:reply")).toMatchObject({ includedInContext: false });
  expect(await timelineEntries(project.id, database)).toHaveLength(2);
  expect(formatTimelineContinuity(await timelineEntries(project.id, database))).toContain("No developments recorded yet.");
});

it("captures completed turns once, formats one colon-linked record, and preserves edits and removals", async () => {
  const { database, chat, project } = await setup();
  const request = vi.fn(async () => result());
  await updateTimelineContinuity(chat.id, "model", request, database);
  const [entry] = await timelineEntries(project.id, database);
  expect(entry).toMatchObject({ orderIndex: 0, sourceMessageIds: ["user", "reply"], sourceSequence: 1 });
  expect(formatTimelineContinuity([entry])).toContain("Arrival: Mara entered the observatory.");
  await database.timelineEntries.update(entry.id, { title: "User correction", body: "Ellis arrived first.", manuallyEdited: true });
  await updateTimelineContinuity(chat.id, "model", request, database);
  expect(request).toHaveBeenCalledTimes(1);
  expect((await timelineEntries(project.id, database))[0].body).toBe("Ellis arrived first.");
  await database.messages.update("reply", { body: "A revised source message." });
  await invalidateTimelineMessages(["reply"], database);
  await updateTimelineContinuity(chat.id, "model", request, database);
  expect((await timelineEntries(project.id, database))[0].body).toBe("Ellis arrived first.");
  await database.timelineEntries.update(entry.id, { deleted: true });
  await updateTimelineContinuity(chat.id, "model", request, database);
  expect(request).toHaveBeenCalledTimes(1);
  expect(await timelineEntries(project.id, database)).toEqual([]);
});

it("does not capture disabled, incomplete, cancelled, or inactive-branch turns", async () => {
  const { database, chat, messages } = await setup();
  const request = vi.fn(async () => result());
  await database.chats.update(chat.id, { timelineContinuityEnabled: false });
  await updateTimelineContinuity(chat.id, "model", request, database);
  await database.chats.update(chat.id, { timelineContinuityEnabled: true });
  for (const status of ["pending", "streaming", "failed", "cancelled"] as const) {
    await database.messages.update("reply", { status });
    await updateTimelineContinuity(chat.id, "model", request, database);
  }
  await database.messages.update("reply", { status: "complete", branchId: "alternate" });
  await updateTimelineContinuity(chat.id, "model", request, database);
  expect(request).not.toHaveBeenCalled();
  await database.messages.put(messages[1]);
  await updateTimelineContinuity(chat.id, "model", request, database);
  expect(request).toHaveBeenCalledTimes(1);
});

it("records empty reviews, retries invalid output, and never marks malformed output reviewed", async () => {
  const { database, chat, project } = await setup();
  await expect(updateTimelineContinuity(chat.id, "model", async () => new Response('{"choices":[]}'), database)).rejects.toThrow();
  expect((await database.chats.get(chat.id))?.timelineError).toBeTruthy();
  expect(await database.timelineEntries.count()).toBe(0);
  const request = vi.fn(async () => result("reply", "", ""));
  await updateTimelineContinuity(chat.id, "model", request, database);
  await updateTimelineContinuity(chat.id, "model", request, database);
  expect(request).toHaveBeenCalledTimes(1);
  expect(await timelineEntries(project.id, database)).toEqual([]);
  expect((await database.chats.get(chat.id))?.timelineError).toBeUndefined();
});

it("invalidates edited sources and rebuilds in place; excludes abandoned future events during regeneration", async () => {
  const { database, chat, project } = await setup();
  await updateTimelineContinuity(chat.id, "model", async () => result(), database);
  const manual = await addTimelineEntry(project.id, "Next:", "They searched the archive.", database);
  await database.messages.update("reply", { body: "Ellis entered first." });
  await invalidateTimelineMessages(["reply"], database);
  expect((await timelineEntries(project.id, database)).map((entry) => entry.id)).toEqual([manual.id]);
  await updateTimelineContinuity(chat.id, "model", async () => result("reply", "Correction", "Ellis entered first."), database);
  expect((await timelineEntries(project.id, database))[0]).toMatchObject({ orderIndex: 0, body: "Ellis entered first." });
  expect((await timelineEntries(project.id, database, { chatId: chat.id, sequence: 0 })).map((entry) => entry.id)).toEqual([manual.id]);
  await deleteMessages(["reply"], database);
  expect(await database.timelineEntries.get("timeline:reply")).toBeUndefined();
  expect(await database.timelineEntries.get(manual.id)).toBeDefined();
});

it("discards reviews whose sources change or disappear while the model is responding", async () => {
  const { database, chat } = await setup();
  await updateTimelineContinuity(chat.id, "model", async () => {
    await database.messages.update("reply", { body: "A different outcome." });
    return result();
  }, database);
  expect(await database.timelineEntries.count()).toBe(0);
  await updateTimelineContinuity(chat.id, "model", async () => {
    await deleteMessages(["reply"], database);
    return result();
  }, database);
  expect(await database.timelineEntries.count()).toBe(0);
});

it("shares only project entries, orders by position rather than timestamps, supports moving, backup and project deletion", async () => {
  const { database, project, chat } = await setup();
  await updateTimelineContinuity(chat.id, "model", async () => result(), database);
  const manual = await addTimelineEntry(project.id, "Next", "The archive opened.", database);
  await database.timelineEntries.update(manual.id, { createdAt: 0, updatedAt: 0 });
  await database.projects.put({ ...project, id: "other" });
  await addTimelineEntry("other", "Elsewhere", "Another continuity.", database);
  expect((await timelineEntries(project.id, database)).map((entry) => entry.title)).toEqual(["Arrival", "Next"]);
  await moveTimelineEntry(manual.id, -1, database);
  expect((await timelineEntries(project.id, database)).map((entry) => entry.title)).toEqual(["Next", "Arrival"]);
  const backup = await createFullBackup(database);
  await database.timelineEntries.clear();
  await replaceWithFullBackup(backup, database);
  expect((await timelineEntries(project.id, database)).map((entry) => entry.title)).toEqual(["Next", "Arrival"]);
  await deleteProject(project.id, database);
  expect(await timelineEntries(project.id, database)).toEqual([]);
  expect((await timelineEntries("other", database))[0].title).toBe("Elsewhere");
});

it("serializes overlapping reviews so a turn is never recorded twice", async () => {
  const { database, chat } = await setup();
  const request = vi.fn(async () => result());
  await Promise.all([updateTimelineContinuity(chat.id, "model", request, database), updateTimelineContinuity(chat.id, "model", request, database)]);
  expect(request).toHaveBeenCalledTimes(1);
  expect(await database.timelineEntries.count()).toBe(1);
});
