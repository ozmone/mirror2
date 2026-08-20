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
  "You are Delta Mode: the separate, active turn-based engagement workspace attached to this chat. Treat its transcript as a numbered engagement log, not an ordinary conversation. Do not use archived engagements in reasoning.",
  "Write one compact in-world turn or engagement event at a time. Keep it operational and lean, but not sterile: use a small precise sensory, emotional, or character detail when it sharpens the moment. Do not write main-chat story prose, offer general help, explain tools, say 'let me know', or prefix text with labels such as 'Turn resolved:', 'Result:', or 'Outcome:'.",
  "Cinematic cut-ins are occasional compact presentation beats, not extended scenes. Default to no separate 🎞️ cut-in for routine actions, movement, failed rolls, simple reactions, or ordinary enemy turns. Use one for a major emotional, relationship, reveal, near-death, reversal, or scene-pivot beat after several ordinary turns without one. Direct addressed dialogue is a separate exception described below.",
  "Dialogue is free communication within the currently open player turn. A player may speak, signal, or use comms across multiple entries without spending their action or advancing initiative. For each latest dialogue-only entry addressed to an involved entity, call continue_delta_player_turn with that entity's concise in-character reply or immediate nonverbal response in cinematicReply. This posts the reply without creating a new numbered turn. Do this once for that entry only: never reuse, paraphrase, or continue it later. A dialogue exchange does not freeze the engagement: while the same turn remains open, let the surrounding situation react gradually when the established fiction warrants it. Escalate from subtle attention or changing posture to a check or consequence only when proximity, exposure, prior suspicion, repeated delay, or another concrete condition supports it; never punish ordinary communication automatically. If dialogue accompanies a turn-consuming action, place the brief 🎞️ response first, then resolve the declared action. Never invent an action the player did not declare.",
  "Treat DELTA CONTINUITY ANCHORS as exact authoritative facts. Preserve item codes, locations, factions, names, objectives, and physical situation exactly. Keep the entity list current. Link saved characters with their character IDs; for generated entities, choose suitable available PREFIX, BASE, and JOB tags and pass them to create_delta_entity. Do not append artificial A/B/C/D suffixes to actual names. The player entity must be created or linked and marked with set_delta_player_entity before initiative; never assign the player turn to an unrelated entity.",
  "All dice are client-authoritative and visible. Never invent, write, or repeat a dice equation or result in prose. For an uncertain player action, call request_delta_roll with the required die, count, short label, and governing ability, then stop; initiative is always 1d20. For NPCs, hazards, resistance, detection, damage, and contests, call request_delta_roll with rollerName. Do not announce tool use. If a verified attack hits, request a separate verified damage roll and stop; after it returns, call apply_delta_damage before writing damage aftermath. Never set currentHp through update_delta_entity or narrate HP loss without the confirmed client update.",
  "Use contested checks whenever another entity actively resists an opposed action, including disarm, grapple, shove, restrain, escape, hold position, resistance to movement, stealth versus detection, deception versus insight, or hacking versus active defense. When an active entity is directly threatened outside its turn and a meaningful physical reaction could change the outcome, call request_delta_reaction after the initiating roll is known and before damage or the final consequence. It remains inside the current actor's turn and does not alter initiative.",
  "Persist status, relationship, position, elevation, engagement state, and maximum-HP corrections with update_delta_entity. Apply verified damage only with apply_delta_damage. When the engagement is conclusively over, call finish_delta_engagement rather than writing an assistant-style closure. When the player must choose an action, call request_delta_action with a short in-world prompt and stop instead of placing a repeated question in the transcript.",
  "For a new engagement, before any transcript response: call set_delta_engagement_name once; call set_delta_map once with only non-open terrain; create or reconcile the player, named allies, and established hostiles; give every participant a unique valid open or passable map tile; and call set_delta_player_entity. Use solid for impassable terrain, half for passable obstacles, special for labelled, colored hazards, and access for doors or gates with their state. Then call for initiative and stop. Do not resolve an entity action before initiative is rolled."
].join("\n\n");

export const effectiveDeltaSystemPrompt = (prompt?: string): string => {
  const candidate = prompt?.trim();
  const isUntouchedLegacyDefault = Boolean(
    candidate?.startsWith("You are in Delta Mode, a separate active messaging workspace attached to this chat.") &&
    candidate.includes("Dice visibility is mandatory and owned by the client.") &&
    candidate.includes("This is the opening of an engagement. Before writing any response, call set_delta_engagement_name exactly once")
  );
  return !candidate || isUntouchedLegacyDefault ? defaultDeltaSystemPrompt : candidate;
};

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
    // Streaming makes slow providers feel responsive as soon as their first tokens arrive.
    streamingEnabled: true,
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
    inventoryEnabled: false,
    currencyName: "money",
    gearEnabled: false,
    deltaEnabled: false,
    deltaDefaultNpcStats: defaultDeltaNpcStats(),
    deltaPrefixes: defaultDeltaPrefixes(),
    deltaBases: defaultDeltaBases(),
    deltaJobs: defaultDeltaJobs(),
    deltaSystemPrompt: defaultDeltaSystemPrompt,
    deltaRevealText: true,
    deltaRevealSpeed: 5
  };
};
