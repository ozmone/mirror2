export async function sendOpenRouterRequest(payload: Record<string, unknown>, apiKey: string | undefined, externalSignal?: AbortSignal) {
  const controller = new AbortController();
  const abortFromExternal = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromExternal();
  else externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), 90_000);
  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${(apiKey ?? "").trim()}`,
        "Content-Type": "application/json",
        "HTTP-Referer": location.origin,
        "X-Title": "Mirror 2.0"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (error) {
    if (externalSignal?.aborted) throw error;
    if (controller.signal.aborted) throw new Error("The AI provider did not start responding within 90 seconds. Please resend the message.");
    throw error;
  } finally {
    window.clearTimeout(timeout);
    // Keep the one-shot link alive while the caller consumes a streaming body.
    // It is released with the request controller after the send finishes.
  }
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `OpenRouter request failed (${response.status})`);
  }
  return response;
}
