import { useEffect, useState } from "react";
import { MarkdownText } from "../shared/MarkdownText";

const deltaRevealSpeedsMs = [1400, 1200, 1000, 850, 720, 600, 480, 360, 260, 180] as const;

export function deltaRevealStepMs(speed?: number) {
  const index = Math.max(0, Math.min(deltaRevealSpeedsMs.length - 1, Math.round(speed ?? 5) - 1));
  return deltaRevealSpeedsMs[index];
}

export function deltaRevealLines(text: string) {
  return text.split(/\r?\n/).flatMap((line) => line.trim().split(/(?<=[.!?])\s+(?=["'“‘(*A-Z0-9])/)).filter((line) => line.trim().length > 0 && !/^---+$/.test(line.trim()));
}

export function DeltaTurnText({ text, animate = false, startDelayMs = 0, stepMs = deltaRevealStepMs(), onReveal }: { text: string; animate?: boolean; startDelayMs?: number; stepMs?: number; onReveal?: () => void }) {
  const lines = deltaRevealLines(text);
  const [visibleLineCount, setVisibleLineCount] = useState(animate ? 0 : lines.length);
  useEffect(() => {
    if (!animate) { setVisibleLineCount(lines.length); return; }
    setVisibleLineCount(0);
    const timers = lines.map((_, index) => window.setTimeout(() => { setVisibleLineCount(index + 1); onReveal?.(); }, startDelayMs + index * stepMs));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [text]);
  return <div className="delta-turn-lines">{lines.slice(0, visibleLineCount).map((line, index) => <div className="delta-turn-line" key={`${index}:${line}`}><MarkdownText text={line} emptyText=" " inventoryMarkers /></div>)}</div>;
}

export function cinematicMarker() { return "🎞️"; }

export function cleanDeltaCinematic(text: string) { return text.replace(/^🎞️\s*/, ""); }

export function splitDeltaCinematic(text: string) {
  const lines = text.split(/\r?\n/);
  const cinematic: string[] = [];
  while (lines[0]?.trim().startsWith(cinematicMarker())) cinematic.push(lines.shift() ?? "");
  return { cinematic: cinematic.map(cleanDeltaCinematic).join("\n").trim(), turn: lines.join("\n").trim() };
}
