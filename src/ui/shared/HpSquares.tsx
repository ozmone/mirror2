export function HpSquares({ current, max, relationship, character = false }: { current: number; max: number; relationship?: "ally" | "neutral" | "hostile"; character?: boolean }) {
  const total = Math.max(1, Math.floor(max));
  const filled = Math.max(0, Math.min(total, Math.floor(current)));
  return <span className={`hp-squares ${character ? "character" : relationship ?? "ally"}`} aria-label={`${filled} of ${total} HP`}>{Array.from({ length: total }, (_, index) => <i className={index < filled ? "filled" : ""} key={index} />)}</span>;
}
