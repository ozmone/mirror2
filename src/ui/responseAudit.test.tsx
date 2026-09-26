import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MessageInfoModal } from "./chat/MessageList";
import type { MainChatRequestAudit, Message } from "../types";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const audit: MainChatRequestAudit = {
  version: 2, capturedAt: 1, requestKind: "send", projectId: "project", projectName: "Project", chatId: "chat",
  selectedHistory: [], contextSources: [{ name: "Source library", included: true }], memoryRetrieval: { mode: "manual", query: "", concepts: [], hits: [] }, toolEvents: [], sourceVersions: [],
  requests: [{ purpose: "reply", capturedAt: 1, payload: { model: "model", stream: true }, status: "complete", usage: { prompt_tokens: 100, completion_tokens: 25 }, pricing: { inputPricePerMillionUsd: 1, outputPricePerMillionUsd: 2 } }]
};
const message: Message = { id: "reply", chatId: "chat", branchId: "branch", sequence: 1, role: "assistant", body: "Hello", estimatedTokens: false, starred: false, status: "complete", createdAt: 1, updatedAt: 1, inputTokens: 100, outputTokens: 25, requestInfo: { settings: [], toggles: [], toolCalls: [], audit } };

it("opens, expands and copies saved audit data with no network requests", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  render(<MessageInfoModal message={message} onClose={() => {}} />);
  expect(screen.getByText("125t")).toBeInTheDocument();
  expect(screen.getByText("Available for lookup")).toBeInTheDocument();
  expect(screen.getByText(/Sources with returned text: None/)).toBeInTheDocument();
  fireEvent.click(screen.getByText("Actual requests (1)"));
  fireEvent.click(screen.getByRole("button", { name: "Copy complete audit" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(JSON.stringify(audit, null, 2)));
  expect(fetch).not.toHaveBeenCalled();
});

it("labels legacy snapshots and adds stored input and output without claiming a complete total", () => {
  render(<MessageInfoModal message={{ ...message, requestInfo: { ...message.requestInfo!, audit: { ...audit, version: 1, requests: undefined, requestPayload: { stream: false } } } }} onClose={() => {}} />);
  expect(screen.getByText("125t")).toBeInTheDocument();
  expect(screen.getByText("Legacy request snapshot")).toBeInTheDocument();
  expect(screen.getByText(/Legacy records may omit/)).toBeInTheDocument();
  expect(screen.queryByText("Total recorded tokens")).not.toBeInTheDocument();
});
