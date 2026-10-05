import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

type Balance = { amount: number };

export async function fetchOpenRouterBalance(apiKey: string, signal: AbortSignal): Promise<Balance> {
  const headers = { Authorization: `Bearer ${apiKey.trim()}` };
  const response = await fetch("https://openrouter.ai/api/v1/credits", { headers, signal, cache: "no-store" });
  if (!response.ok) throw new Error(response.status === 401 ? "Check your API key in Settings" : "Balance unavailable");
  const { data } = await response.json();
  if (typeof data?.total_credits !== "number" || !Number.isFinite(data.total_credits) || typeof data?.total_usage !== "number" || !Number.isFinite(data.total_usage)) throw new Error("Balance unavailable");
  return { amount: data.total_credits - data.total_usage };
}

export function OpenRouterBalance({ apiKey, visible }: { apiKey?: string; visible: boolean }) {
  const key = apiKey?.trim() ?? "";
  const [state, setState] = useState<{ key: string; balance?: Balance; error?: string; updated?: number }>({ key: "" });
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!key || !visible) return;
    let disposed = false;
    let busy = false;
    let controller: AbortController | undefined;
    async function update() {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      setLoading(true);
      const requestController = new AbortController();
      controller = requestController;
      const timeout = window.setTimeout(() => requestController.abort(), 15000);
      try {
        const balance = await fetchOpenRouterBalance(key, requestController.signal);
        if (!disposed) setState({ key, balance, updated: Date.now() });
      } catch (error) {
        if (!disposed) setState((previous) => ({ ...(previous.key === key ? previous : { key }), error: error instanceof Error && error.name !== "AbortError" ? error.message : "Balance unavailable" }));
      } finally {
        window.clearTimeout(timeout);
        busy = false;
        if (!disposed) setLoading(false);
      }
    }
    void update();
    const interval = window.setInterval(() => void update(), 60000);
    const resume = () => void update();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      disposed = true;
      controller?.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [key, visible, refresh]);

  const current = state.key === key ? state : undefined;
  const balance = current?.balance;
  const label = !key ? "Add a key in API Settings" : balance ? `US$${balance.amount.toFixed(2)} remaining` : current?.error ?? "Checking balance…";
  const detail = current?.error && balance ? "Update failed · showing last balance" : "OpenRouter credits";
  return <div className="openrouter-balance">
    <div className="openrouter-balance-copy" title={current?.updated ? `Last updated ${new Date(current.updated).toLocaleTimeString()}` : undefined}>
      <span>{key ? detail : "OpenRouter"}</span>
      <strong aria-live="polite">{label}</strong>
    </div>
    {key && <button className="icon-button" aria-label="Refresh OpenRouter balance" title="Refresh balance" disabled={loading} onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={15} /></button>}
  </div>;
}
