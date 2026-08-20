import { useEffect, useState } from "react";
import type { DeltaMessage } from "../../types";

export function DeltaVerifiedRollRow({
  message,
  relationship,
  expanded,
  onToggle,
  animate = false,
  revealDelayMs = 0,
  onReveal
}: {
  message: DeltaMessage;
  relationship: "ally" | "neutral" | "hostile";
  expanded: boolean;
  onToggle: () => void;
  animate?: boolean;
  revealDelayMs?: number;
  onReveal?: () => void;
}) {
  const receipt = message.rollReceipt;
  const [visible, setVisible] = useState(!animate);
  useEffect(() => {
    if (!animate) {
      setVisible(true);
      return;
    }
    setVisible(false);
    const timer = window.setTimeout(() => {
      setVisible(true);
      onReveal?.();
    }, revealDelayMs);
    return () => window.clearTimeout(timer);
  }, [message.id]);
  if (!receipt) return null;
  if (!visible) return null;
  const toolArguments = { die: receipt.die, count: receipt.count, label: receipt.label, rollerName: receipt.rollerName, ability: receipt.ability ?? "NONE" };
  return (
    <article className={`delta-log-row delta-roll-event ${relationship}`}>
      <span className="delta-log-number delta-roll-marker" aria-label="App-generated dice roll">🎲</span>
      <div className="delta-roll-event-content">
        <button type="button" className="delta-roll-summary" onClick={onToggle} aria-expanded={expanded} aria-label={`${message.body}. Show client roll receipt`}><span>{message.body}</span></button>
        {expanded && (
          <div className="delta-roll-audit">
            <div className="delta-roll-audit-heading"><strong>Client roll receipt</strong><span>{receipt.id}</span></div>
            <dl>
              <div><dt>Tool</dt><dd>{receipt.toolName}</dd></div><div><dt>Request</dt><dd><code>{JSON.stringify(toolArguments)}</code></dd></div><div><dt>Generator</dt><dd>{receipt.generator}</dd></div><div><dt>Method</dt><dd>{receipt.algorithm}</dd></div><div><dt>Accepted uint32</dt><dd>{receipt.rawValues.join(", ")}</dd></div><div><dt>Raw dice</dt><dd>{receipt.results.join(", ")}</dd></div>
              {receipt.ability && <div><dt>Stat modifier</dt><dd>{receipt.ability} {receipt.modifier !== undefined && receipt.modifier >= 0 ? "+" : ""}{receipt.modifier ?? 0}</dd></div>}
              {receipt.total !== undefined && <div><dt>Total</dt><dd>{receipt.total}</dd></div>}<div><dt>Generated</dt><dd>{new Date(receipt.generatedAt).toLocaleString()}</dd></div>
              {receipt.hpApplications?.map((application) => <div key={`${application.entityId}:${application.appliedAt}`}><dt>HP applied</dt><dd>{application.entityName}: {application.beforeHp} - {application.amount} = {application.afterHp}</dd></div>)}
            </dl>
            <pre>{`crypto.getRandomValues(uint32)\nlimit = 2^32 - (2^32 % ${receipt.die})\naccept only uint32 < limit\nresult = (uint32 % ${receipt.die}) + 1`}</pre>
            <p>This receipt was created by the client at the same point the random values were generated. It was not parsed from AI-written text.</p>
          </div>
        )}
      </div>
    </article>
  );
}
