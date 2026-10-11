import { db } from "./db";
import type { ChatSource } from "../types";
import { now, uid } from "../utils";

export async function chatSourcesFor(chatId: string, branchId: string) {
  const rows = await db.chatSources.where("chatId").equals(chatId).toArray();
  return rows.filter((row) => !row.branchId || row.branchId === branchId).sort((a, b) => a.name.localeCompare(b.name));
}

export async function chatSourceContext(chatId: string, branchId: string) {
  const rows = await chatSourcesFor(chatId, branchId);
  const userSources = rows.filter((row) => !row.internal && row.textContent.trim());
  const state = rows.find((row) => row.kind === "last-confirmed-story-state" && row.branchId === branchId);
  return {
    text: [
      state ? `LAST CONFIRMED STORY STATE (already happened; continue after it, never replay or plan from it):\n${state.textContent}` : "LAST CONFIRMED STORY STATE: none yet. Establish the opening scene naturally.",
      userSources.length ? `CHAT SOURCES (chat-specific reference material):\n${userSources.map((row) => `## ${row.name}\n${row.textContent}`).join("\n\n")}` : ""
    ].filter(Boolean).join("\n\n")
  };
}

export async function saveLastConfirmedStoryState(projectId: string, chatId: string, branchId: string, textContent: string, confirmedReplyId: string) {
  const existing = (await db.chatSources.where("chatId").equals(chatId).toArray()).find((row) => row.kind === "last-confirmed-story-state" && row.branchId === branchId);
  const timestamp = now();
  if (existing) { await db.chatSources.update(existing.id, { textContent, confirmedReplyId, revision: (existing.revision ?? 0) + 1, updatedAt: timestamp }); return; }
  await db.chatSources.add({ id: uid(), projectId, chatId, branchId, name: "Last Confirmed Story State.txt", textContent, internal: true, kind: "last-confirmed-story-state", confirmedReplyId, revision: 1, createdAt: timestamp, updatedAt: timestamp });
}

export async function addChatSource(projectId: string, chatId: string, name: string, textContent: string) {
  const timestamp = now();
  const row: ChatSource = { id: uid(), projectId, chatId, name: name.trim() || "Chat source.txt", textContent, internal: false, kind: "source", createdAt: timestamp, updatedAt: timestamp };
  await db.chatSources.add(row);
  return row;
}
