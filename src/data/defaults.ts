import { Ability, AbilityScores, AppSettings, DeltaBaseTemplate, DeltaJobTemplate, DeltaPrefixTemplate, Project } from "../types";
import { uid } from "../utils";

const deltaAbilities: Ability[] = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];

export const defaultDeltaNpcStats = (): AbilityScores => ({
  STR: 10,
  DEX: 10,
  CON: 10,
  INT: 10,
  WIS: 10,
  CHA: 10
});

export const defaultDeltaPrefixes = (): DeltaPrefixTemplate[] =>
  deltaAbilities.map((ability) => ({
    id: ability.toLowerCase(),
    label: ability,
    statModifiers: { [ability]: 3 },
    notes: ""
  }));

export const defaultDeltaBases = (): DeltaBaseTemplate[] => [
  { id: "light", label: "LIGHT", statModifiers: { STR: -2, DEX: 4 }, hpBonus: -5, notes: "" },
  { id: "medium", label: "MEDIUM", statModifiers: { DEX: 2, CON: 2 }, notes: "" },
  { id: "heavy", label: "HEAVY", statModifiers: { STR: 4, DEX: -1, CON: 4 }, hpBonus: 8, notes: "" }
];

export const defaultDeltaJobs = (): DeltaJobTemplate[] => [];

export const defaultMemoryInstruction =
  "Save only durable, noteworthy details that are likely to remain useful in future conversations within this project. A memory should describe a stable fact, preference, relationship, rule, character trait, world detail, recurring constraint, important decision, or established continuity. Do not save transient actions, momentary emotions, ordinary scene narration, speculation, duplicates, model-generated assumptions, or details that are only relevant to the current reply. Write each memory so it remains understandable without the surrounding conversation. Prefer one clear fact or tightly related set of facts per memory. When uncertain, do not save it.";

export const defaultSettings = (): AppSettings => {
  const now = Date.now();
  return {
    id: "settings",
    createdAt: now,
    updatedAt: now,
    theme: "onyx",
    accent: "sage",
    font: "system",
    fontSize: "standard",
    fontScale: 16,
    bubbleMode: "bubbles",
    bubbleScope: "global",
    entryWidth: 80,
    messageSpacing: 4,
    paragraphSpacing: 4,
    privacyPreset: "balanced",
    compactionEnabled: false,
    includeWorld: true,
    includeInstructions: true,
    includeCharacters: false,
    includeSourceFiles: false,
    streamingEnabled: false,
    autoManageInventory: false,
    confirmInventoryUpdates: true,
    autoManageGear: false,
    confirmGearUpdates: true
  };
};

export const sampleProject = (): Project => {
  const now = Date.now();
  return {
    id: uid(),
    createdAt: now,
    updatedAt: now,
    name: "First Project",
    iconName: "moth",
    iconColor: "#a7d8c4",
    orderIndex: 0,
    pinned: true,
    instructions: "",
    worldSetting: "",
    memoryMode: "approval",
    memoryInstruction: defaultMemoryInstruction,
    locked: false,
    inventoryEnabled: false,
    gearEnabled: false,
    deltaDefaultNpcStats: defaultDeltaNpcStats(),
    deltaPrefixes: defaultDeltaPrefixes(),
    deltaBases: defaultDeltaBases(),
    deltaJobs: defaultDeltaJobs()
  };
};
