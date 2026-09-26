import type { MainChatAuditRequest, MainChatAuditToolEvent, SourceAuditVersion, SourceFile } from "../types";

export function auditSafeValue(value: unknown): unknown {
  if (typeof value === "string") {
    if (/^data:image\//i.test(value)) return `[${value.slice(5, value.indexOf(";")) || "image"} attachment bytes omitted from local audit]`;
    return value;
  }
  if (Array.isArray(value)) return value.map(auditSafeValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, auditSafeValue(item)]));
  return value;
}

export async function sourceAuditVersions(files: SourceFile[]): Promise<SourceAuditVersion[]> {
  return Promise.all(files.map(async (file) => {
    const bytes = new TextEncoder().encode(file.textContent ?? "");
    // Hashing is local; never send audit metadata back to the model.
    const digest = globalThis.crypto?.subtle ? await crypto.subtle.digest("SHA-256", bytes) : undefined;
    return { id: file.id, name: file.name, updatedAt: file.updatedAt, characters: file.textContent?.length ?? 0,
      sha256: digest ? Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("") : undefined };
  }));
}

export function summarizeAuditUsage(requests: MainChatAuditRequest[]) {
  let input = 0;
  let output = 0;
  let cost = 0;
  let missingUsage = 0;
  let missingPricing = 0;
  for (const request of requests) {
    const usage = request.usage;
    input += usage?.prompt_tokens ?? 0;
    output += usage?.completion_tokens ?? 0;
    if (usage?.prompt_tokens === undefined || usage?.completion_tokens === undefined) missingUsage++;
    if (request.pricing?.inputPricePerMillionUsd === undefined || request.pricing?.outputPricePerMillionUsd === undefined) missingPricing++;
    cost += ((usage?.prompt_tokens ?? 0) * (request.pricing?.inputPricePerMillionUsd ?? 0)
      + (usage?.completion_tokens ?? 0) * (request.pricing?.outputPricePerMillionUsd ?? 0)) / 1_000_000;
  }
  return { input, output, total: input + output, cost, missingUsage, missingPricing };
}

/** Observe the existing transport once; this never dispatches another model request. */
export async function recordModelRequest(
  payload: Record<string, unknown>,
  requests: MainChatAuditRequest[],
  purpose: MainChatAuditRequest["purpose"],
  pricing: MainChatAuditRequest["pricing"],
  send: (payload: Record<string, unknown>) => Promise<Response>
) {
  const record: MainChatAuditRequest = {
    purpose, capturedAt: Date.now(), payload: auditSafeValue(payload) as Record<string, unknown>,
    status: "pending", pricing: pricing ? { ...pricing } : undefined
  };
  requests.push(record);
  try {
    const response = await send(payload);
    if (!payload.stream) {
      try {
        record.usage = (await response.clone().json()).usage;
        record.status = "complete";
      } catch {
        record.status = "failed";
        record.error = "Could not parse provider response.";
      }
    }
    return response;
  } catch (error) {
    record.status = "failed";
    record.error = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

export function retrievedSourceNames(events: MainChatAuditToolEvent[]) {
  const names = new Set<string>();
  for (const event of events) {
    if (event.name !== "read_source" && event.name !== "search_sources") continue;
    try {
      const result = JSON.parse(event.result);
      if (event.name === "read_source" && typeof result.text === "string" && result.text.length && typeof result.name === "string") names.add(result.name);
      if (event.name === "search_sources" && Array.isArray(result.hits)) {
        for (const hit of result.hits) if (typeof hit.name === "string" && hit.passages?.some((passage: { text?: string }) => passage.text?.length)) names.add(hit.name);
      }
    } catch { /* Legacy malformed results cannot establish retrieval. */ }
  }
  return [...names];
}
