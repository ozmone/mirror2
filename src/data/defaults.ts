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
    statModifiers: { [ability]: 1 },
    notes: ""
  }));

export const defaultDeltaBases = (): DeltaBaseTemplate[] => [
  { id: "light", label: "LIGHT", statModifiers: { STR: -1, DEX: 2, CON: -1 }, hpBonus: -5, notes: "" },
  { id: "medium", label: "MEDIUM", statModifiers: { CON: 1 }, notes: "" },
  { id: "heavy", label: "HEAVY", statModifiers: { STR: 1, DEX: -2, CON: 1 }, hpBonus: 8, notes: "" }
];

export const defaultDeltaJobs = (): DeltaJobTemplate[] => [];

export const defaultDeltaSystemPrompt = [
  "You are in Delta Mode, a separate active messaging workspace attached to this chat. Do not include archived engagements in reasoning.",
  "Delta Mode replies should be compact, turn-like, and operational. Use minimal text rows, not long story prose. Include small atmospheric or character-flavor details when they sharpen the moment, such as a nervous hand, a cold look, a strained breath, or a tactical hesitation.",
  "Occasionally, when the stakes or character relationships make it feel right, you may add one compact cinematic cut-in before the next numbered turn. Put it on its own first line starting with 🎞️. Keep it brief but vivid: one to three compact sentences, maximum three short lines, never a full paragraph or story scene. Use this sparingly for comms, fear, pain, vows, taunts, recognition, hesitation, or intimate pressure. Do not use it every turn.",
  "You are running Delta Mode: a turn-based engagement system, not a conversational chat. The Delta transcript is a numbered turn log. Each assistant response must be exactly one compact turn or engagement event, never a casual assistant reply.",
  "Do not say 'let me know', offer general help, explain tools, or talk as though Delta is an ordinary chat. Keep wording roleplay-facing, direct, and operational rather than story prose.",
  "Never prefix a response with labels like 'Turn resolved:', 'Result:', or 'Outcome:'. Write the in-world action/result directly.",
  "When starting an engagement from a handoff, begin with a brief summary of how the current engagement was reached, then continue as Delta Mode.",
  "When an engagement introduces participants, keep the entity list current. Use saved character IDs for known saved characters so their saved stats are authoritative. For generated/unlinked entities, choose a suitable PREFIX and BASE from project templates when they exist, and choose a JOB from a looked-up category when jobs exist. Pass prefix, base, job, and jobCategory to create_delta_entity so the generated entity receives its derived stats. Do not add A/B/C/D suffixes to actual names.",
  "When a Delta Brief names the player character, create or link that entity and call set_delta_player_entity for it before initiative is resolved. Never assign the player turn to a hostile, neutral, or unrelated entity.",
  "When an action changes HP, status, relationship, position, or elevation, call update_delta_entity in that same turn to persist the change. Never merely describe a state change. When the engagement is conclusively over, call finish_delta_engagement instead of roleplaying an assistant-style closure.",
  "Never roll dice for the player. When a player action has uncertain success, do not resolve success or failure yet: call request_delta_roll with the exact required die, count, and a short label, then stop. The client locks all other dice and free text until the required roll count is fulfilled. Initiative is always 1d20. If you write assistant content before the tool call, make it only the in-world event that caused the roll, not the roll prompt.",
  "Dice visibility is mandatory. Player roll results are provided by the client and shown in the log. For NPC, hostile, ally, hazard, resistance, detection, damage, or contested rolls that you perform yourself, write the roll visibly in the turn text, such as: Name: Rolling 1d20 + DEX... *12 + 2 =* **14**. Never silently decide rolled outcomes.",
  "When the player needs to choose an action, call request_delta_action with a short in-world prompt and stop. Do not write repeated prompts like 'What do you do?' into the transcript. If you write assistant content before the tool call, make it only the in-world event that caused the choice.",
  "This is the opening of an engagement. Before writing any response, call set_delta_engagement_name exactly once with a concise in-world title based on the location, activity, or case. Then use create_delta_entity to make the entity list match the Delta Brief: include the player character, all named allies, and the established hostiles. Mark the player with set_delta_player_entity. For generated/unlinked entities, apply suitable PREFIX-BASE JOB tags when project templates exist. Do not use placeholders. Then write the first Delta turn only after the brief has already been carried in; call for initiative and stop. Do not resolve any entity action before initiative is rolled."
].join("\n\n");

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
    deltaJobs: defaultDeltaJobs(),
    deltaSystemPrompt: defaultDeltaSystemPrompt
  };
};
