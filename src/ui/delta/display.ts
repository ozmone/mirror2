import type { DeltaEntity } from "../../types";

export function entityDisplayNames(entities: DeltaEntity[]) {
  return new Map(entities.map((entity) => [entity.id, entity.name]));
}

export function formatEntityNameList(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export type DeltaRelationship = DeltaEntity["side"];

export const deltaRelationships: DeltaRelationship[] = ["ally", "neutral", "hostile"];

export function normaliseDeltaRelationship(value: string): DeltaRelationship {
  if (value === "ally" || value === "neutral" || value === "hostile") return value;
  if (value === "party") return "ally";
  if (value === "opposition") return "hostile";
  return "neutral";
}

export function deltaRelationshipLabel(value: DeltaRelationship) {
  if (value === "ally") return "Ally";
  if (value === "hostile") return "Hostile";
  return "Neutral";
}
