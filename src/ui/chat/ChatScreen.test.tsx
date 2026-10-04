import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { db } from "../../data/db";
import { defaultSettings, sampleProject } from "../../data/defaults";
import { createChat, createMemory } from "../../data/repositories";
import { addTimelineEntry, timelineEntries } from "../../data/timeline";
import type { Chat, Message, Project } from "../../types";
import { ChatScreen } from "./ChatScreen";

// Keep orchestration tests independent of browser-only virtualization measurements.
vi.mock("./MessageList", () => ({ VirtualMessageList: ({ messages, onResend }: { messages: Message[]; onResend: (message: Message) => Promise<void> }) => (
  <div>{messages.map((message) => <div key={message.id}>{message.body}{message.role === "user" && <button onClick={() => void onResend(message)}>Regenerate {message.body}</button>}</div>)}</div>
) }));

afterEach(async () => {
  cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  await Promise.all(db.tables.map((table) => table.clear()));
});

it("replaces the settings history entry when opening compaction without going back", async () => {
  await setup();
  const back = vi.spyOn(window.history, "back");
  fireEvent.click(screen.getByRole("button", { name: "Chat settings and attachments" }));
  fireEvent.click(screen.getByRole("button", { name: "Chat settings" }));
  fireEvent.click(screen.getByRole("button", { name: "Open compaction memory" }));
  expect(back).not.toHaveBeenCalled();
  expect(window.history.state).toMatchObject({ mirrorRoute: "compaction", mirrorChatSettings: false });
  expect(screen.queryByRole("button", { name: "Close chat settings" })).not.toBeInTheDocument();
});

async function setup(timelineContinuityEnabled = false, memoryMode: Project["memoryMode"] = "manual", historyLimit?: number) {
  const project = { ...sampleProject(), worldSetting: "Unique world setting", instructions: "Unique instructions", memoryMode };
  await db.projects.put(project);
  const id = await createChat(project.id, "Initial");
  await db.chats.update(id, { timelineContinuityEnabled });
  await db.messages.where("chatId").equals(id).delete();
  const chat = (await db.chats.get(id))!;
  render(<Harness project={project} chat={chat} historyLimit={historyLimit} />);
  return chat;
}

it("saves a model choice without requesting a full settings or conversation refresh", async () => {
  await db.settings.put(defaultSettings());
  const onRefresh = vi.fn();
  const onSettingsSaved = vi.fn();
  const onModelSelected = vi.fn();
  render(<ChatScreen project={sampleProject()} messages={[]} settings={defaultSettings()} onRefresh={onRefresh}
    onChatCreated={() => {}} onMessageUpdated={() => {}} onRoute={() => {}}
    selectedModelId="old-model" models={[{ modelId: "new-model", cosmeticName: "New model" }]}
    deltaLocked={false} onOpenDelta={async () => {}} onSettingsSaved={onSettingsSaved}
    onModelSelected={onModelSelected} />);
  fireEvent.click(screen.getByRole("button", { name: "Chat settings and attachments" }));
  fireEvent.click(screen.getByRole("button", { name: /Current model/ }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: /New model/ }));
  await waitFor(() => expect(onModelSelected).toHaveBeenCalledWith("new-model"));
  expect((await db.settings.get("settings"))?.defaultModelId).toBe("new-model");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(onSettingsSaved).not.toHaveBeenCalled();
  expect(onRefresh).not.toHaveBeenCalled();
});
function Harness({ project, chat, historyLimit }: { project: Project; chat: Chat; historyLimit?: number }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [settings] = useState({ ...defaultSettings(), ...(historyLimit !== undefined ? { maxHistoryMessages: historyLimit, historySettingsInitialized: true } : {}), apiKey: "test-key", charactersMode: "none" as const, sourceFilesMode: "none" as const });
  async function refresh() { setMessages(await db.messages.where("chatId").equals(chat.id).sortBy("sequence")); }
  return <ChatScreen project={project} chat={chat} messages={messages} settings={settings}
    onRefresh={refresh} onChatCreated={refresh} onRoute={() => {}} selectedModelId="test-model"
    models={[{ modelId: "test-model", cosmeticName: "Test" }]} deltaLocked={false}
    onOpenDelta={async () => {}} onSettingsSaved={async () => {}} onModelSelected={() => {}}
    onMessageUpdated={(id, patch) => setMessages((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row))} />;
}
function event(text: string) { return new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`); }
function reply(text: string) {
  return new Response(new ReadableStream({ start(controller) {
    controller.enqueue(event(text));
    controller.enqueue(new TextEncoder().encode('data: {"usage":{"prompt_tokens":10,"completion_tokens":3}}\n\ndata: [DONE]\n\n'));
    controller.close();
  } }));
}
function send() {
  fireEvent.change(screen.getByPlaceholderText("Message this project"), { target: { value: "Hello" } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
}

it("executes source list, search, and read calls and returns real stored passages to the model", async () => {
  const calls = [
    { name: "list_sources", arguments: "{}" },
    { name: "search_sources", arguments: JSON.stringify({ query: "celestial" }) },
    { name: "read_source", arguments: JSON.stringify({ sourceId: "lookup-source" }) }
  ];
  const fetch = vi.fn(async (_url: string, options: RequestInit) => {
    const payload = JSON.parse(String(options.body));
    const results = payload.messages.filter((message: { role: string }) => message.role === "tool");
    const round = results.length;
    if (round === 0) {
      expect(JSON.stringify(payload.messages)).not.toContain("The observatory houses the celestial archive.");
      expect(payload.tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual(expect.arrayContaining(calls.map((call) => call.name)));
    }
    if (round >= 1) expect(JSON.parse(results[0].content)).toMatchObject({ sources: [{ id: "lookup-source", readable: true }] });
    if (round >= 2) expect(JSON.parse(results[1].content)).toMatchObject({ hits: [{ id: "lookup-source", passages: [{ text: "The observatory houses the celestial archive." }] }] });
    if (round >= 3) expect(JSON.parse(results[2].content)).toMatchObject({ text: "The observatory houses the celestial archive.", nextStart: null });
    return new Response(JSON.stringify({ choices: [{ message: round < 3
      ? { content: null, tool_calls: [{ id: `lookup-${round}`, type: "function", function: calls[round] }] }
      : { content: "The archive is in the observatory." } }] }));
  });
  vi.stubGlobal("fetch", fetch);
  const chat = await setup();
  await db.sourceFiles.put({ id: "lookup-source", projectId: chat.projectId, name: "observatory.md", textContent: "The observatory houses the celestial archive.", mimeType: "text/markdown", size: 44, createdAt: 1, updatedAt: 1 });
  fireEvent.click(screen.getByRole("button", { name: "Chat settings and attachments" }));
  fireEvent.click(screen.getByRole("button", { name: "Chat settings" }));
  fireEvent.click(within(screen.getByRole("group", { name: "Source files" })).getByRole("radio", { name: "Lookup only" }));
  fireEvent.click(screen.getByRole("button", { name: "Close chat settings" }));
  send();
  await screen.findByText("The archive is in the observatory.");
  expect(fetch).toHaveBeenCalledTimes(4);
  const response = await db.messages.filter((message) => message.role === "assistant").first();
  expect(response?.status).toBe("complete");
  expect(response?.requestInfo?.audit?.toolEvents.map((event) => event.name)).toEqual(calls.map((call) => call.name));
  expect(response?.requestInfo?.audit?.toolEvents[2].result).toContain("The observatory houses the celestial archive.");
});

for (const mode of ["Send all", "Lookup only", "None"] as const) {
  it(`applies ${mode} to saved settings, outgoing requests, and regeneration`, async () => {
    const fetch = vi.fn(async (_url: string, options: RequestInit) => {
      const payload = JSON.parse(String(options.body));
      return payload.stream ? reply("Mode response") : new Response(JSON.stringify({ choices: [{ message: { content: "Mode response" } }] }));
    });
    vi.stubGlobal("fetch", fetch);
    const chat = await setup();
    await db.settings.put({ ...defaultSettings(), apiKey: "test-key" });
    await db.characters.put({ id: "mode-character", projectId: chat.projectId, name: "Test character", normalisedName: "test character", age: "24", gender: "", personality: "Unique personality", misc: "", bio: "Unique character biography", statsEnabled: false, str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, createdAt: 1, updatedAt: 1 });
    await db.sourceFiles.put({ id: "mode-source", projectId: chat.projectId, name: "notes.txt", textContent: "Unique source passage", mimeType: "text/plain", size: 21, createdAt: 1, updatedAt: 1 });
    await db.sourceFiles.put({ id: "foreign-source", projectId: "foreign", name: "secret.txt", textContent: "Foreign source passage", mimeType: "text/plain", size: 22, createdAt: 1, updatedAt: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Chat settings and attachments" }));
    fireEvent.click(screen.getByRole("button", { name: "Chat settings" }));
    for (const label of ["Source files", "Characters"]) {
      const group = within(screen.getByRole("group", { name: label }));
      fireEvent.click(group.getByRole("radio", { name: mode }));
      expect(group.getAllByRole("radio").filter((radio) => (radio as HTMLInputElement).checked)).toHaveLength(1);
    }
    for (const label of ["World Setting", "Instructions"]) {
      fireEvent.click(within(screen.getByRole("group", { name: label })).getByRole("radio", { name: mode === "Send all" ? "Send all" : "None" }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const storedMode = mode === "Send all" ? "all" : mode === "Lookup only" ? "lookup" : "none";
    await waitFor(async () => expect(await db.settings.get("settings")).toMatchObject({ sourceFilesMode: storedMode, charactersMode: storedMode, includeWorld: mode === "Send all", includeInstructions: mode === "Send all" }));
    if (screen.queryByRole("button", { name: "Close chat settings" })) fireEvent.click(screen.getByRole("button", { name: "Close chat settings" }));
    send();
    await screen.findByText("Mode response");
    await screen.findByRole("button", { name: "Send message" });
    fireEvent.click(screen.getByRole("button", { name: "Regenerate Hello" }));
    await waitFor(() => expect(fetch.mock.calls.length).toBeGreaterThanOrEqual(2));
    await screen.findByRole("button", { name: "Send message" });
    for (const [, options] of fetch.mock.calls) {
      const payload = JSON.parse(String(options.body));
      const context = JSON.stringify(payload.messages);
      expect(context.includes("Unique source passage")).toBe(mode === "Send all");
      expect(context).not.toContain("Foreign source passage");
      for (const text of ["Unique world setting", "Unique instructions", "Unique personality", "Unique character biography"]) expect(context.includes(text)).toBe(mode === "Send all");
      const names = (payload.tools ?? []).map((tool: { function: { name: string } }) => tool.function.name);
      expect(names.includes("read_source")).toBe(mode === "Lookup only");
      expect(names.includes("find_characters")).toBe(mode === "Lookup only");
      expect(context.includes("Project character library:")).toBe(mode === "Send all");
    }
  });
}

it("sends and regenerates through the shared pipeline, deleting replaced attachments and retaining audits", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(reply("First response")).mockResolvedValueOnce(reply("Replacement response"));
  vi.stubGlobal("fetch", fetch);
  await setup(); send();
  await waitFor(async () => expect((await db.messages.filter((message) => message.role === "assistant").first())?.status).toBe("complete"));
  await screen.findByText("First response");
  await screen.findByRole("button", { name: "Send message" });
  const first = (await db.messages.filter((message) => message.role === "assistant").first())!;
  await db.attachments.put({ id: "replaced-image", ownerType: "message", ownerId: first.id, mimeType: "image/png", size: 1, blob: new Blob(["x"]), createdAt: 1, updatedAt: 1 });
  fireEvent.click(screen.getByRole("button", { name: "Regenerate Hello" }));
  await screen.findByText("Replacement response");
  await waitFor(async () => expect((await db.messages.filter((message) => message.role === "assistant").first())?.requestInfo?.audit?.postResponseMemory?.status).toBe("skipped"));
  expect(await db.messages.get(first.id)).toBeUndefined();
  expect(await db.attachments.get("replaced-image")).toBeUndefined();
  const replacement = (await db.messages.filter((message) => message.role === "assistant").first())!;
  expect(replacement.requestInfo?.audit).toMatchObject({ requestKind: "resend", requests: [{ status: "complete", usage: { prompt_tokens: 10, completion_tokens: 3 } }] });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("stops an in-flight stream without saving it as a completed reply", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_url: string, options: RequestInit) => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(event("Partial response"));
    options.signal?.addEventListener("abort", () => controller.error(new DOMException("Stopped", "AbortError")), { once: true });
  } }))));
  await setup(); send();
  await screen.findByText("Partial response");
  fireEvent.click(screen.getByRole("button", { name: "Stop response" }));
  await screen.findByText("Response stopped.");
  const stopped = (await db.messages.filter((message) => message.role === "assistant").first())!;
  expect(stopped.status).toBe("cancelled");
  expect(stopped.requestInfo?.audit?.requests?.[0].status).toBe("failed");
});

it("saves Timeline continuity and memory compaction independently for the current chat", async () => {
  await db.settings.put({ ...defaultSettings(), compactionEnabled: true });
  const chat = await setup();
  const otherId = await createChat(chat.projectId, "Other chat");
  fireEvent.click(screen.getByRole("button", { name: "Chat settings and attachments" }));
  fireEvent.click(screen.getByRole("button", { name: "Chat settings" }));
  expect(screen.getByRole("checkbox", { name: "Memory compaction" })).toBeChecked();
  fireEvent.click(screen.getByRole("checkbox", { name: "Memory compaction" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Timeline continuity" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(async () => expect(await db.chats.get(chat.id)).toMatchObject({ compactionEnabled: false, timelineContinuityEnabled: true }));
  expect(await db.chats.get(otherId)).toMatchObject({ compactionEnabled: true, timelineContinuityEnabled: false });
  expect((await db.settings.get("settings"))?.compactionEnabled).toBe(true);
});

async function seedTimelineHistory(chat: Chat, firstReply = "Mara found the journal.") {
  await db.messages.bulkPut(Array.from({ length: 10 }, (_, index): Message => ({
    id: `${chat.id}-history-${index}`, chatId: chat.id, branchId: chat.activeBranchId, sequence: index,
    role: index % 2 ? "assistant" : "user", body: index === 1 ? firstReply : `Earlier message ${index}`,
    status: "complete", estimatedTokens: true, starred: false, createdAt: index, updatedAt: index
  })));
}

it("captures falling-off history before sending, shares it across chats, and excludes replaced outcomes on regeneration", async () => {
  let replyNumber = 0;
  const mainContexts: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, options: RequestInit) => {
    const payload = JSON.parse(String(options.body));
    if (payload.messages[0].content.startsWith("Update Timeline continuity")) {
      const turns = JSON.parse(payload.messages[1].content.split("Completed turns to review:\n")[1]);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ entries: turns.map((turn: { sourceMessageId: string; messages: { body: string }[] }) => ({ sourceMessageId: turn.sourceMessageId, title: "Development", body: turn.messages[turn.messages.length - 1].body })) }) } }] }));
    }
    mainContexts.push(payload.messages[0].content);
    replyNumber++;
    const text = replyNumber === 1 ? "Mara found the journal." : replyNumber === 2 ? "Ellis opened the archive." : "The journal remained missing.";
    return payload.stream ? reply(text) : new Response(JSON.stringify({ choices: [{ message: { content: text } }] }));
  }));
  const first = await setup(true, "manual", 10);
  await seedTimelineHistory(first);
  await addTimelineEntry(first.projectId, "Arrival:", "Mara entered the observatory.");
  send();
  await waitFor(async () => expect(await timelineEntries(first.projectId)).toHaveLength(2));
  await waitFor(() => expect(mainContexts[0]).toContain("Arrival: Mara entered the observatory."));
  expect(mainContexts[0]).not.toContain("Compaction memory:");
  expect(mainContexts[0]).toContain("Development: Mara found the journal.");
  await waitFor(async () => expect((await db.messages.where("chatId").equals(first.id).sortBy("sequence")).slice(-1)[0]?.requestInfo?.audit?.postResponseMemory).toBeDefined());
  expect(await timelineEntries(first.projectId)).toHaveLength(2);
  cleanup();
  const secondId = await createChat(first.projectId, "Initial", { timelineContinuityEnabled: true, compactionEnabled: false });
  await db.messages.where("chatId").equals(secondId).delete();
  const second = (await db.chats.get(secondId))!;
  const project = (await db.projects.get(first.projectId))!;
  await seedTimelineHistory(second, "Ellis arrived at the archive.");
  render(<Harness project={project} chat={second} historyLimit={10} />);
  send();
  await waitFor(async () => expect(await timelineEntries(first.projectId)).toHaveLength(3));
  await waitFor(() => expect(mainContexts[1]).toContain("Development: Mara found the journal."));
  await waitFor(async () => expect((await db.messages.where("chatId").equals(secondId).sortBy("sequence")).slice(-1)[0]?.requestInfo?.audit?.postResponseMemory).toBeDefined());
  const secondReply = (await db.messages.where("chatId").equals(secondId).sortBy("sequence")).slice(-1)[0]!;
  const secondPrompt = (await db.messages.where("chatId").equals(secondId).sortBy("sequence")).slice(-2)[0]!;
  await db.timelineEntries.put({ id: `timeline:${secondReply.id}`, projectId: project.id, orderIndex: 3, title: "Later outcome", body: secondReply.body,
    sourceChatId: secondId, sourceBranchId: second.activeBranchId, sourceMessageIds: [secondPrompt.id, secondReply.id], sourceSequence: secondReply.sequence, createdAt: 1, updatedAt: 1 });
  fireEvent.click(screen.getByRole("button", { name: "Regenerate Hello" }));
  await screen.findByText("The journal remained missing.");
  expect(mainContexts[2]).toContain("Mara found the journal.");
  expect(mainContexts[2]).not.toContain("Ellis opened the archive.");
  expect((await timelineEntries(first.projectId)).map((entry) => entry.body)).not.toContain("Ellis opened the archive.");
});

it.each([10, 0])("does not auto-capture recent turns with history limit %s, but still sends existing continuity", async (historyLimit) => {
  const chat = await setup(true, "manual", historyLimit);
  if (historyLimit === 0) await seedTimelineHistory(chat);
  await addTimelineEntry(chat.projectId, "Established", "The archive is open.");
  const fetch = vi.fn(async (_url: string, options: RequestInit) => {
    const payload = JSON.parse(String(options.body));
    expect(payload.messages[0].content).not.toMatch(/^Update Timeline continuity/);
    expect(payload.messages[0].content).toContain("Established: The archive is open.");
    return new Response(JSON.stringify({ choices: [{ message: { content: "A recent scene." } }] }));
  });
  vi.stubGlobal("fetch", fetch);
  send();
  await waitFor(async () => expect((await db.messages.where("chatId").equals(chat.id).sortBy("sequence")).slice(-1)[0]?.requestInfo?.audit?.postResponseMemory).toBeDefined());
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(await timelineEntries(chat.projectId)).toHaveLength(1);
});

it("keeps a successful reply when timeline review fails and exposes a retryable error", async () => {
  const chat = await setup(true, "manual", 10);
  await seedTimelineHistory(chat);
  vi.stubGlobal("fetch", vi.fn(async (_url: string, options: RequestInit) => {
    const payload = JSON.parse(String(options.body));
    return payload.messages[0].content.startsWith("Update Timeline continuity")
      ? new Response(JSON.stringify({ choices: [{ message: { content: "invalid review" } }] }))
      : new Response(JSON.stringify({ choices: [{ message: { content: "A completed scene." } }] }));
  }));
  send();
  await screen.findByText("A completed scene.");
  await waitFor(async () => expect((await db.chats.get(chat.id))?.timelineError).toBeTruthy());
  expect(await timelineEntries(chat.projectId)).toHaveLength(0);
  expect((await db.messages.where("chatId").equals(chat.id).sortBy("sequence")).slice(-1)[0]).toMatchObject({ status: "complete", body: "A completed scene." });
  await screen.findByText(/Timeline continuity needs an update:/);
});

it("disabling compaction excludes stored compaction and condensed messages and stops automatic condensation", async () => {
  const chat = await setup();
  const original = "Original narration with details that must stay intact. ".repeat(12);
  await db.chats.update(chat.id, { compactionMemory: "Stored compacted history", compactionEnabled: false });
  await db.messages.put({ id: "older", chatId: chat.id, branchId: chat.activeBranchId, sequence: 0,
    role: "assistant", body: original, contextCondensation: "A shorter condensation", contextCondensationSourceUpdatedAt: 1,
    status: "complete", starred: false, estimatedTokens: true, createdAt: 1, updatedAt: 1 });
  await addTimelineEntry(chat.projectId, "Disabled timeline", "This must not be included.");
  const fetch = vi.fn(async (_url: string, options: RequestInit) => {
    const payload = JSON.parse(String(options.body));
    expect(JSON.stringify(payload.messages)).toContain(original);
    expect(JSON.stringify(payload.messages)).not.toContain("A shorter condensation");
    expect(JSON.stringify(payload.messages)).not.toContain("Stored compacted history");
    expect(JSON.stringify(payload.messages)).not.toContain("This must not be included.");
    const text = "Another detailed scene. ".repeat(25);
    return payload.stream ? reply(text) : new Response(JSON.stringify({ choices: [{ message: { content: text } }] }));
  });
  vi.stubGlobal("fetch", fetch);
  send();
  await waitFor(async () => {
    const response = await db.messages.where("chatId").equals(chat.id).and((message) => message.role === "assistant" && message.id !== "older").first();
    expect(response?.requestInfo?.audit?.postResponseMemory?.status).toBe("skipped");
    expect(response?.requestInfo?.audit?.selectedHistory[0].usedCondensation).toBe(false);
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("actually deletes memories, pending suggestions, and timeline entries through tool results without recreating them", async () => {
  const chat = await setup(true, "automatic");
  await db.chats.update(chat.id, { compactionMemory: "Leave compaction alone." });
  const memory = await createMemory(chat.projectId, "Mara trusts Ellis.", [], "automatic");
  const timeline = await addTimelineEntry(chat.projectId, "Arrival", "Mara arrived at the observatory.");
  await db.pendingMemories.put({ id: "pending-delete", projectId: chat.projectId, text: "Mara keeps a journal.", tags: [], sourceMessageIds: [], reason: "Durable", confidence: 1, createdAt: 1, updatedAt: 1 });
  const fetch = vi.fn(async (_url: string, options: RequestInit) => {
    const payload = JSON.parse(String(options.body));
    if (payload.messages[0].content.startsWith("Review one completed")) {
      expect(payload.messages[0].content).toContain("Never recreate deleted memories");
      // Even a provider ignoring the empty-array instruction must not recreate the deleted fact.
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ memories: [{ text: memory.text, tags: [], confidence: 1 }], condensedMessages: [] }) } }] }));
    }
    expect(payload.messages[0].content).toContain("Memory management:");
    expect(payload.tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual(expect.arrayContaining(["find_memory_entries", "delete_memory_entry"]));
    const results = payload.messages.filter((message: { role: string }) => message.role === "tool");
    const call = (name: string, args: object, id: string) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
    let message;
    if (!results.length) message = { tool_calls: [call("find_memory_entries", { module: "all", query: "Mara" }, "find")] };
    else if (results.length === 1) {
      expect(JSON.parse(results[0].content).entries).toHaveLength(3);
      message = { tool_calls: [
        call("delete_memory_entry", { module: "memories", entryId: memory.id }, "delete-saved"),
        call("delete_memory_entry", { module: "pending", entryId: "pending-delete" }, "delete-pending"),
        call("delete_memory_entry", { module: "timeline", entryId: timeline.id }, "delete-timeline")
      ] };
    } else {
      expect(results.slice(1).map((result: { content: string }) => JSON.parse(result.content).deleted)).toEqual([true, true, true]);
      message = { content: "Deleted the requested entries from project memories and Timeline continuity." };
    }
    return new Response(JSON.stringify({ choices: [{ message }] }));
  });
  vi.stubGlobal("fetch", fetch);
  fireEvent.change(screen.getByPlaceholderText("Message this project"), { target: { value: "Delete the Mara entries from both memory modules, including pending memories." } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByText("Deleted the requested entries from project memories and Timeline continuity.");
  await waitFor(async () => {
    const response = await db.messages.where("chatId").equals(chat.id).and((message) => message.role === "assistant").first();
    expect(response?.memoryManagementTurn).toBe(true);
    expect(response?.requestInfo?.audit?.postResponseMemory?.status).toBe("completed");
    expect(response?.requestInfo?.audit?.toolEvents).toHaveLength(4);
  });
  expect(await db.memories.get(memory.id)).toBeUndefined();
  expect(await db.pendingMemories.count()).toBe(0);
  expect(await timelineEntries(chat.projectId)).toEqual([]);
  expect(await db.timelineEntries.get(timeline.id)).toMatchObject({ deleted: true });
  expect((await db.chats.get(chat.id))?.compactionMemory).toBe("Leave compaction alone.");
  expect(fetch).toHaveBeenCalledTimes(4);
});

it("offers deletion for existing memories even when automatic memory and timeline capture are disabled", async () => {
  const chat = await setup();
  const memory = await createMemory(chat.projectId, "An obsolete fact.", []);
  vi.stubGlobal("fetch", vi.fn(async (_url: string, options: RequestInit) => {
    const payload = JSON.parse(String(options.body));
    expect(payload.tools.map((tool: { function: { name: string } }) => tool.function.name)).toContain("delete_memory_entry");
    const results = payload.messages.filter((message: { role: string }) => message.role === "tool");
    const message = results.length === 2 ? { content: "Removed the obsolete memory." } : { tool_calls: [{ id: `manage-${results.length}`, type: "function", function: {
      name: results.length ? "delete_memory_entry" : "find_memory_entries",
      arguments: JSON.stringify(results.length ? { module: "memories", entryId: memory.id } : { module: "memories", query: "obsolete" })
    } }] };
    return new Response(JSON.stringify({ choices: [{ message }] }));
  }));
  fireEvent.change(screen.getByPlaceholderText("Message this project"), { target: { value: "Forget the obsolete memory." } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByText("Removed the obsolete memory.");
  expect(await db.memories.get(memory.id)).toBeUndefined();
});
