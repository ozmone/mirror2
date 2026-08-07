import { AppSettings, Project } from "../types";
import { uid } from "../utils";

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
    privacyPreset: "balanced",
    compactionEnabled: false,
    includeSourceFiles: false,
    streamingEnabled: false
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
    gearEnabled: false
  };
};
