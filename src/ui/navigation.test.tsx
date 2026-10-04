import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { db } from "../data/db";
import { defaultSettings, sampleProject } from "../data/defaults";
import { createChat } from "../data/repositories";
import type { Message } from "../types";
import { App } from "./App";

vi.mock("../data/backup", async (importOriginal) => ({
  ...await importOriginal<typeof import("../data/backup")>(),
  installAutomaticRecoverySnapshots: vi.fn()
}));

let initialRefresh: (() => Promise<void>) | undefined;
let createdId = "";
vi.mock("./chat/ChatScreen", () => ({
  ChatScreen: ({ messages, onRefresh, onChatCreated, onModelSelected, selectedModelId }: {
    messages: Message[]; onRefresh: () => Promise<void>; onChatCreated: (id: string) => Promise<void>;
    onModelSelected: (modelId: string) => void; selectedModelId: string
  }) => <div>
    {messages.map((message) => <p key={message.id}>{message.body}</p>)}
    <button onClick={() => { initialRefresh = onRefresh; void onChatCreated(createdId); }}>Select new chat</button>
    <button onClick={() => onModelSelected("new-model")}>Change model</button>
    <span>Selected model: {selectedModelId}</span>
  </div>
}));

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  initialRefresh = undefined;
  await Promise.all(db.tables.map((table) => table.clear()));
});

it("updates the selected model without reading the conversation again", async () => {
  const project = sampleProject();
  await db.projects.put(project);
  await db.settings.put(defaultSettings());
  createdId = await createChat(project.id, "Model selection chat");
  const chat = (await db.chats.get(createdId))!;
  await db.messages.put({ id: "model-reply", chatId: chat.id, branchId: chat.activeBranchId, sequence: 10,
    role: "assistant", body: "Conversation stays loaded", status: "complete", estimatedTokens: true, starred: false, createdAt: 1, updatedAt: 1 });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Select new chat" }));
  await screen.findByText("Conversation stays loaded");
  // Finish the selection refresh before measuring reads caused by a model change.
  await act(async () => { await initialRefresh!(); });
  const messageReads = vi.spyOn(db.messages, "where");
  const projectReads = vi.spyOn(db.projects, "orderBy");
  fireEvent.click(screen.getByRole("button", { name: "Change model" }));
  await screen.findByText("Selected model: new-model");
  expect(screen.getByText("Conversation stays loaded")).toBeInTheDocument();
  expect(messageReads).not.toHaveBeenCalled();
  expect(projectReads).not.toHaveBeenCalled();
});

it("keeps the selected conversation when the first reply calls its original refresh callback", async () => {
  const project = sampleProject();
  await db.projects.put(project);
  await db.settings.put(defaultSettings());
  createdId = await createChat(project.id, "New chat");
  const chat = (await db.chats.get(createdId))!;
  await db.messages.put({ id: "reply", chatId: chat.id, branchId: chat.activeBranchId, sequence: 10,
    role: "assistant", body: "First reply stays visible", status: "complete", estimatedTokens: true, starred: false, createdAt: 1, updatedAt: 1 });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Select new chat" }));
  await screen.findByText("First reply stays visible");
  await act(async () => { await initialRefresh!(); });
  expect(screen.getByText("First reply stays visible")).toBeInTheDocument();
});
