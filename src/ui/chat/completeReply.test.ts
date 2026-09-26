import { afterEach, expect, it, vi } from "vitest";
import { MirrorDatabase } from "../../data/db";
import type { MainChatAuditRequest, Message } from "../../types";
import { completeReply, readReplyStream } from "./completeReply";

const databases: MirrorDatabase[] = [];
afterEach(async () => { await Promise.all(databases.splice(0).map((db) => db.delete())); });

function stream(parts: Uint8Array[]) {
  return new Response(new ReadableStream({ start(controller) { parts.forEach((part) => controller.enqueue(part)); controller.close(); } }));
}
function bytes(text: string) { return new TextEncoder().encode(text); }
async function fixture() {
  const db = new MirrorDatabase(`reply-test-${crypto.randomUUID()}`);
  databases.push(db);
  await db.messages.put({ id: "reply", body: "", status: "pending" } as Message);
  const requests: MainChatAuditRequest[] = [{ purpose: "reply", capturedAt: 1, payload: {}, status: "pending" }];
  const requestInfo = { settings: [], toggles: [], toolCalls: [] } as unknown as NonNullable<Message["requestInfo"]>;
  return { db, requests, requestInfo };
}

it("handles split UTF-8, partial SSE lines, and a final usage record without a newline", async () => {
  const { db, requests, requestInfo } = await fixture();
  const encoded = bytes('data: {"choices":[{"delta":{"content":"Hi 🦋"}}]}\r\n\r\ndata: {"usage":{"prompt_tokens":12,"completion_tokens":4}}');
  const onProgress = vi.fn();
  const result = await completeReply({
    messageId: "reply", stream: true, requests, requestInfo, onProgress,
    request: async () => stream(Array.from(encoded, (byte) => new Uint8Array([byte])))
  }, db);
  expect(result.text).toBe("Hi 🦋");
  expect(onProgress).toHaveBeenCalledTimes(1);
  expect(await db.messages.get("reply")).toMatchObject({ body: "Hi 🦋", inputTokens: 12, outputTokens: 4, estimatedTokens: false, status: "complete" });
  expect(requests[0]).toMatchObject({ status: "complete", usage: { prompt_tokens: 12, completion_tokens: 4 } });
});

it("completes a non-streamed response without treating zero usage as missing", async () => {
  const { db, requests, requestInfo } = await fixture();
  await completeReply({ messageId: "reply", stream: false, requests, requestInfo, onProgress: vi.fn(),
    request: async () => new Response(JSON.stringify({ choices: [{ message: { content: "Hello" } }], usage: { prompt_tokens: 0, completion_tokens: 0 } }))
  }, db);
  expect(await db.messages.get("reply")).toMatchObject({ body: "Hello", inputTokens: 0, outputTokens: 0, estimatedTokens: false, requestInfo: { toolCalls: ["None"] } });
});

it("preserves tool finalization and the memory-handled flag without dispatching an extra reply", async () => {
  const { db, requests, requestInfo } = await fixture();
  const request = vi.fn();
  const result = await completeReply({ messageId: "reply", stream: false, requests, requestInfo, onProgress: vi.fn(), request,
    runTools: async () => {
      requestInfo.toolCalls.push("save_memory", "finalize_turn");
      return { replyText: "", finalizedTurn: { prose: "Done", metadata: { advanceSeconds: 5 } }, memoryHandledByTool: true, inputTokens: 3, outputTokens: 2 };
    }
  }, db);
  expect(request).not.toHaveBeenCalled();
  expect(result).toEqual({ text: "Done", memoryHandledByTool: true });
  expect(await db.messages.get("reply")).toMatchObject({ worldState: { advanceSeconds: 5 }, requestInfo: { toolCalls: ["save_memory", "finalize_turn"] } });
});

it("does not mark an interrupted response complete", async () => {
  const { db, requests, requestInfo } = await fixture();
  let pull = 0;
  const response = new Response(new ReadableStream({ pull(controller) {
    if (pull++ === 0) controller.enqueue(bytes('data: {"choices":[{"delta":{"content":"Partial"}}]}\n'));
    else controller.error(new DOMException("Stopped", "AbortError"));
  } }));
  await expect(completeReply({ messageId: "reply", stream: true, requests, requestInfo, onProgress: vi.fn(), request: async () => response }, db)).rejects.toThrow("Stopped");
  expect((await db.messages.get("reply"))?.status).toBe("pending");
  expect(requests[0].status).toBe("pending");
});

it("surfaces stream error records and releases the reader", async () => {
  const response = stream([bytes('data: {"error":{"message":"Provider failed"}}\n')]);
  await expect(readReplyStream(response, async () => {}, () => {})).rejects.toThrow("Provider failed");
  expect(response.body?.locked).toBe(false);
});
