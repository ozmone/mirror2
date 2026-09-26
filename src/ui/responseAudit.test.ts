import { afterEach, expect, it, vi } from "vitest";
import { recordModelRequest, retrievedSourceNames, sourceAuditVersions, summarizeAuditUsage } from "./responseAudit";
import type { MainChatAuditRequest, MainChatAuditToolEvent, SourceFile } from "../types";
import { runSourceTool } from "../data/sources";
import { db } from "../data/db";

const pricing = { inputPricePerMillionUsd: 2, outputPricePerMillionUsd: 6 };
afterEach(async () => { vi.unstubAllGlobals(); await db.sourceFiles.clear(); });

it("records every dispatched round, preserves the body, and sums reply and background usage", async () => {
  const requests: MainChatAuditRequest[] = [];
  const send = vi.fn(async () => new Response(JSON.stringify({ usage: { prompt_tokens: 100, completion_tokens: 20 }, choices: [] })));
  const payload = { model: "model", stream: false, messages: [{ role: "user", content: "Hello" }], tools: [{ function: { name: "finalize_turn" } }] };
  for (const purpose of ["reply", "reply", "compaction", "memory review"] as const) {
    const response = await recordModelRequest(payload, requests, purpose, pricing, send);
    expect(await response.json()).toHaveProperty("usage.prompt_tokens", 100);
  }
  expect(send).toHaveBeenCalledTimes(4);
  expect(send).toHaveBeenNthCalledWith(1, payload);
  expect(requests[0].payload).toEqual(payload);
  payload.messages[0].content = "changed later";
  expect(requests[0].payload.messages).toEqual([{ role: "user", content: "Hello" }]);
  expect(summarizeAuditUsage(requests)).toEqual({ input: 400, output: 80, total: 480, cost: 0.00128, missingUsage: 0, missingPricing: 0 });
});

it("captures streaming flags without consuming the stream and redacts only the local image snapshot", async () => {
  const requests: MainChatAuditRequest[] = [];
  const payload = { model: "model", stream: true, stream_options: { include_usage: true }, messages: [{ content: [{ image_url: { url: "data:image/png;base64,secret" } }] }] };
  const send = vi.fn(async () => new Response('data: {"usage":{"prompt_tokens":10}}\n\n'));
  const response = await recordModelRequest(payload, requests, "reply", pricing, send);
  expect(response.bodyUsed).toBe(false);
  expect(await response.text()).toContain('"prompt_tokens":10');
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith(payload);
  expect(JSON.stringify(payload)).toContain("base64,secret");
  expect(JSON.stringify(requests)).not.toContain("base64,secret");
  expect(requests[0].payload.stream_options).toEqual({ include_usage: true });
});

it("flags missing usage/pricing, preserves zero counts and records failed attempts", async () => {
  const requests: MainChatAuditRequest[] = [];
  const rates = { ...pricing };
  await recordModelRequest({}, requests, "reply", rates, async () => new Response('{"usage":{"prompt_tokens":0,"completion_tokens":0}}'));
  rates.inputPricePerMillionUsd = 999;
  expect(requests[0].pricing).toEqual(pricing);
  await expect(recordModelRequest({}, requests, "reply", undefined, async () => { throw new Error("Stopped"); })).rejects.toThrow("Stopped");
  expect(requests[1]).toMatchObject({ status: "failed", error: "Stopped" });
  expect(summarizeAuditUsage(requests)).toMatchObject({ total: 0, missingUsage: 1, missingPricing: 1 });
});

it("captures the source version used without adding it to the model tool result", async () => {
  const file: SourceFile = { id: "source", projectId: "project", name: "world.md", mimeType: "text/markdown", textContent: "Original passage", size: 16, createdAt: 1, updatedAt: 1 };
  await db.sourceFiles.add(file);
  let versions: Awaited<ReturnType<typeof sourceAuditVersions>> = [];
  const result = await runSourceTool("project", "read_source", '{"sourceId":"source"}', async (files) => { versions = await sourceAuditVersions(files); });
  await db.sourceFiles.update(file.id, { textContent: "Revised passage", updatedAt: 2 });
  expect(result).toMatchObject({ text: "Original passage" });
  expect(result).not.toHaveProperty("sha256");
  expect(result).not.toHaveProperty("updatedAt");
  expect(versions[0]).toMatchObject({ name: "world.md", updatedAt: 1, characters: 16 });
  expect(versions[0]).not.toHaveProperty("textContent");
});

it("distinguishes available sources and unsuccessful searches from actually returned text", () => {
  const event = (name: string, result: unknown): MainChatAuditToolEvent => ({ name, result: JSON.stringify(result), arguments: "{}", callId: "1", round: 1 });
  const events = [event("list_sources", { sources: [{ name: "world.md" }] }), event("search_sources", { hits: [] }), event("read_source", { error: "Not found" })];
  expect(retrievedSourceNames(events)).toEqual([]);
  events.push(event("search_sources", { hits: [{ name: "world.md", passages: [{ text: "Some text" }] }] }));
  events.push(event("read_source", { name: "world.md", text: "Some text" }));
  expect(retrievedSourceNames(events)).toEqual(["world.md"]);
});
