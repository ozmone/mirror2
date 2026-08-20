import type { DeltaEntity } from "../../types";

export function statModifier(value?: number) {
  if (typeof value !== "number") return "";
  const modifier = Math.floor((value - 10) / 2);
  return modifier >= 0 ? `+${modifier}` : `${modifier}`;
}

export const deltaRollAbilities = ["STR", "DEX", "CON", "INT", "WIS", "CHA"] as const;
export type DeltaRollAbility = typeof deltaRollAbilities[number];

export function deltaRollModifier(entity: DeltaEntity | undefined, ability: DeltaRollAbility | undefined) {
  if (!entity || !ability) return 0;
  const score = entity[ability.toLowerCase() as "str" | "dex" | "con" | "int" | "wis" | "cha"] ?? 10;
  return Math.floor((score - 10) / 2);
}

export function deltaRollResultText(die: number, results: number[], modifier: number) {
  const diceLabel = results.length > 1 ? `${results.length}d${die}` : `d${die}`;
  const diceMath = results.join(" + ");
  const rawTotal = results.reduce((total, result) => total + result, 0);
  const total = rawTotal + modifier;
  if (modifier === 0) return { text: results.length > 1 ? `${diceLabel} = ${diceMath} = ${total}` : `${diceLabel} = ${diceMath}`, total };
  const modifierMath = modifier > 0 ? ` + ${modifier}` : ` - ${Math.abs(modifier)}`;
  return { text: `${diceLabel} = ${diceMath}${modifierMath} = ${total}`, total };
}

export function deltaEntityStats(entity: DeltaEntity) {
  return [["STR", entity.str], ["DEX", entity.dex], ["CON", entity.con], ["INT", entity.int], ["WIS", entity.wis], ["CHA", entity.cha]] as const;
}
