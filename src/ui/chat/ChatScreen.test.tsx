import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { db } from "../../data/db";
import { defaultSettings, sampleProject } from "../../data/defaults";
import { createChat } from "../../data/repositories";
import type { Chat, Message, Project } from "../../types";
import { ChatScreen } from "./ChatScreen";

// Keep orchestration tests independent of browser-only virtualization measurements.
vi.mock("./MessageList", () => ({ VirtualMessageList: ({ messages, onResend }: { messages: Message[]; onResend: (message: Message) => Promise<void> }) => (
  <div>{messages.map((message) => <div key={message.id}>{message.body}{message.role === "user" && <button onClick={() => void onResend(message)}>Regenerate {message.body}</button>}</div>)}</div>
) }));

afterEach(async () => {
  cleanup(); vi.unstubAllGlobals();
  await Promise.all(db.tables.map((table) => table.clear()));
});

async function setup() {
  const project = { ...sampleProject(), worldSetting: "Unique world setting", instructions: "Unique instructions", memoryMode: "manual" as const };
  await db.projects.put(project);
  const id = await createChat(project.id, "Initial");
  await db.messages.where("chatId").equals(id).delete();
  const chat = (await db.chats.get(id))!;
  render(<Harness project={project} chat={chat} />);
  return chat;
}
function Harness({ project, chat }: { project: Project; chat: Chat }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [settings] = useState({ ...defaultSettings(), apiKey: "test-key", charactersMode: "none" as const, sourceFilesMode: "none" as const });
  async function refresh() { setMessages(await db.messages.where("chatId").equals(chat.id).sortBy("sequence")); }
  return <ChatScreen project={project} chat={chat} messages={messages} settings={settings}
    onRefresh={refresh} onChatCreated={refresh} onRoute={() => {}} selectedModelId="test-model"
    models={[{ modelId: "test-model", cosmeticName: "Test" }]} deltaLocked={false}
    onOpenDelta={async () => {}} onSettingsSaved={async () => {}}
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
