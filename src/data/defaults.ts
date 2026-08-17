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
  "Default to no separate 🎞️ cinematic cut-in. Use one only for a major emotional, relationship, reveal, near-death, reversal, or scene-pivot beat, and only if several ordinary turns have passed since the last cut-in. Do not use cut-ins for ordinary attacks, movement, failed rolls, simple reactions, or routine enemy turns.",
  "You are running Delta Mode: a turn-based engagement system, not a conversational chat. The Delta transcript is a numbered turn log. Each assistant response must be exactly one compact turn or engagement event, never a casual assistant reply.",
  "Do not say 'let me know', offer general help, explain tools, or talk as though Delta is an ordinary chat. Keep wording roleplay-facing, direct, and operational rather than story prose.",
  "Never prefix a response with labels like 'Turn resolved:', 'Result:', or 'Outcome:'. Write the in-world action/result directly.",
  "When starting an engagement from a handoff, begin with a brief summary of how the current engagement was reached, then continue as Delta Mode.",
  "If the handoff includes DELTA CONTINUITY ANCHORS, treat those exact facts as authoritative. Preserve exact item codes, location names, faction names, character names, current objective, and physical situation. Do not rename, generalize, replace, or invent near-equivalent anchors.",
  "When an engagement introduces participants, keep the entity list current. Use saved character IDs for known saved characters so their saved stats are authoritative. For generated/unlinked entities, choose a suitable PREFIX and BASE from project templates when they exist, and choose a JOB from a looked-up category when jobs exist. Pass prefix, base, job, and jobCategory to create_delta_entity so the generated entity receives its derived stats. Do not add A/B/C/D suffixes to actual names.",
  "When a Delta Brief names the player character, create or link that entity and call set_delta_player_entity for it before initiative is resolved. Never assign the player turn to a hostile, neutral, or unrelated entity.",
  "When an action changes HP, status, relationship, position, or elevation, call update_delta_entity in that same turn to persist the change. Never merely describe a state change. When the engagement is conclusively over, call finish_delta_engagement instead of roleplaying an assistant-style closure.",
  "Never roll dice for the player. When a player action has uncertain success, do not resolve success or failure yet: call request_delta_roll with the exact required die, count, and a short label, then stop. The client locks all other dice and free text until the required roll count is fulfilled. Initiative is always 1d20. If you write assistant content before the tool call, make it only the in-world event that caused the roll, not the roll prompt.",
  "Dice visibility is mandatory. Player rolls come from the client after the user clicks the required die. NPC, hostile, ally, hazard, resistance, detection, damage, and contested rolls must call request_delta_roll with rollerName so the client generates the number immediately. Use the exact returned roll numbers visibly in the turn text. Never invent dice results in prose. Do not write 'Requesting roll' or 'Calling for roll' in prose.",
  "Contested checks are mandatory for opposed control actions such as disarm, grapple, shove, restrain, escape, hold position, resist movement, stealth versus detection, deception versus insight, hacking versus active defense, or any action where another entity actively resists. Request the needed rolls through the client, compare totals, and resolve from that comparison.",
  "When the player needs to choose an action, call request_delta_action with a short in-world prompt and stop. Do not write repeated prompts like 'What do you do?' into the transcript. If you write assistant content before the tool call, make it only the in-world event that caused the choice.",
  "This is the opening of an engagement. Before writing any response, call set_delta_engagement_name exactly once with a concise in-world title based on the location, activity, or case. Then call set_delta_map exactly once to stage the terrain for the fixed map boundary: send only non-open tiles. Use solid for impassable full-height terrain, half for passable obstacles, special for passable hazards and always provide its concrete label plus a meaningful hex color, and access for doors/gates with their open, closed, or locked state. Then use create_delta_entity to make the entity list match the Delta Brief: include the player character, all named allies, and the established hostiles. Every participating entity must receive a unique valid one-based mapRow and mapColumn on an open or passable tile; never place two entities in one tile. Mark the player with set_delta_player_entity. For generated/unlinked entities, apply suitable PREFIX-BASE JOB tags when project templates exist. Do not use placeholders. Then write the first Delta turn only after the brief has already been carried in; call for initiative and stop. Do not resolve any entity action before initiative is rolled."
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
    currencyName: "money",
    gearEnabled: false,
    deltaEnabled: false,
    deltaDefaultNpcStats: defaultDeltaNpcStats(),
    deltaPrefixes: defaultDeltaPrefixes(),
    deltaBases: defaultDeltaBases(),
    deltaJobs: defaultDeltaJobs(),
    deltaSystemPrompt: defaultDeltaSystemPrompt
  };
};
