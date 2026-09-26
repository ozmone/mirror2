import { db } from "../../data/db";
import type { MainChatAuditRequest, Message, WorldReplyMetadata } from "../../types";
import { estimateTokens, now } from "../../utils";
import type { OpenRouterResponse, OpenRouterUsage } from "../openRouter";

type ToolReply = {
  replyText: string;
  inputTokens?: number;
  outputTokens?: number;
  memoryHandledByTool?: boolean;
  finalizedTurn?: { prose: string; metadata: WorldReplyMetadata };
  deltaImminentProposal?: Omit<NonNullable<Message["deltaBrief"]>, "status">;
};

type ReplyOptions = {
  messageId: string;
  stream: boolean;
  requests: MainChatAuditRequest[];
  requestInfo: NonNullable<Message["requestInfo"]>;
  request: () => Promise<Response>;
  runTools?: () => Promise<ToolReply>;
  onProgress: (messageId: string, patch: Partial<Message>) => void;
};

/** Consume complete SSE records even when network chunks split UTF-8 or the final line. */
export async function readReplyStream(response: Response, onText: (text: string) => Promise<void>, onUsage: (usage: OpenRouterUsage) => void) {
  if (!response.body) throw new Error("The provider returned an empty response stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let finished = false;
  async function line(value: string) {
    const clean = value.trim();
    if (finished || !clean.startsWith("data:")) return;
    const data = clean.slice(5).trim();
    if (!data) return;
    if (data === "[DONE]") { finished = true; return; }
    const chunk = JSON.parse(data) as { choices?: { delta?: { content?: string } }[]; usage?: OpenRouterUsage; error?: { message?: string } };
    if (chunk.error) throw new Error(chunk.error.message || "The provider could not complete the response.");
    if (chunk.usage) onUsage(chunk.usage);
    const addition = chunk.choices?.[0]?.delta?.content;
    if (addition) { text += addition; await onText(text); }
  }
  try {
    while (!finished) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const value of lines) await line(value);
      if (done) { if (buffer) await line(buffer); break; }
    }
    return text;
  } finally {
    try { await reader.cancel(); } finally { reader.releaseLock(); }
  }
}

/** One reply lifecycle for both send and resend, independent of React component state. */
export async function completeReply(options: ReplyOptions, database = db) {
  const { messageId, requests, requestInfo } = options;
  let text: string;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let memoryHandledByTool = false;
  let extra: Partial<Message> = {};
  if (options.runTools) {
    const completed = await options.runTools();
    const proposal = completed.deltaImminentProposal;
    text = proposal ? `### Δ Delta mode imminent...\n\n${proposal.brief}` : completed.finalizedTurn?.prose || completed.replyText;
    inputTokens = completed.inputTokens;
    outputTokens = completed.outputTokens;
    memoryHandledByTool = Boolean(completed.memoryHandledByTool);
    extra = {
      deltaBrief: proposal ? { ...proposal, status: "pending", avoidLabel: proposal.avoidLabel || "Escape", avoidPrompt: proposal.avoidPrompt || "What do you do to avoid the engagement?" } : undefined,
      worldState: completed.finalizedTurn?.metadata
    };
    // Preserve the existing estimate for engagement briefs.
    if (outputTokens === undefined && proposal) extra.outputTokens = estimateTokens(proposal.brief);
  } else {
    const response = await options.request();
    const audit = requests[requests.length - 1];
    if (options.stream) {
      text = await readReplyStream(response, async (body) => {
        const patch = { body, outputTokens: estimateTokens(body), updatedAt: now() };
        await database.messages.update(messageId, patch);
        options.onProgress(messageId, patch);
      }, (usage) => {
        inputTokens = usage.prompt_tokens ?? inputTokens;
        outputTokens = usage.completion_tokens ?? outputTokens;
        if (audit) audit.usage = { ...audit.usage, ...usage };
      });
    } else {
      const json = await response.json() as OpenRouterResponse;
      text = json.choices?.[0]?.message?.content ?? "";
      inputTokens = json.usage?.prompt_tokens;
      outputTokens = json.usage?.completion_tokens;
    }
    if (audit) audit.status = "complete";
  }
  const body = text || "(No response text returned.)";
  await database.messages.update(messageId, {
    body, inputTokens, outputTokens: outputTokens ?? estimateTokens(text), estimatedTokens: outputTokens === undefined,
    status: "complete", requestInfo: { ...requestInfo, toolCalls: requestInfo.toolCalls.length ? requestInfo.toolCalls : ["None"] },
    updatedAt: now(), ...extra
  });
  return { text: body, memoryHandledByTool };
}
