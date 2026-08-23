import type { WorldReplyMetadata, WorldState, WorldTracker } from "../types";

export const defaultWorldState = (): WorldState => ({
  timeMode: "disabled",
  fictionalSeconds: 0,
  realtimeUpdatedAt: Date.now(),
  calendarEnabled: false,
  calendar: { year: 1, month: 1, day: 1, yearPrefix: "", yearSuffix: "" },
  locationTracking: false,
  location: "",
  trackers: []
});

const unitSeconds = { seconds: 1, minutes: 60, hours: 3600, days: 86400 } as const;

export function worldTimeSeconds(world: WorldState, at = Date.now()) {
  return world.timeMode === "realtime" ? Math.floor(at / 1000) : world.fictionalSeconds;
}

export function formatWorldTime(world: WorldState, at = Date.now()) {
  if (world.timeMode === "disabled") return "";
  const seconds = worldTimeSeconds(world, at);
  const date = new Date(seconds * 1000);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

/** Calendar months are deliberately fixed at 30 days: small, predictable app-owned arithmetic. */
export function formatWorldCalendar(world: WorldState) {
  if (!world.calendarEnabled) return "";
  const days = Math.floor(worldTimeSeconds(world) / 86400);
  const totalMonths = Math.floor((world.calendar.month - 1 + Math.floor((world.calendar.day - 1 + days) / 30)));
  const day = ((world.calendar.day - 1 + days) % 30 + 30) % 30 + 1;
  const month = ((totalMonths % 12) + 12) % 12 + 1;
  const year = world.calendar.year + Math.floor(totalMonths / 12);
  return `${world.calendar.yearPrefix}${year}${world.calendar.yearSuffix} · ${month}/${day}`;
}

export function formatTracker(tracker: WorldTracker) {
  const value = Number.isInteger(tracker.currentValue) ? String(tracker.currentValue) : tracker.currentValue.toFixed(2).replace(/\.0+$/, "");
  if (tracker.display === "percentage") return `${tracker.label} ${value}%`;
  if (tracker.display === "currentMaximum") return `${tracker.label} ${value}/${tracker.maximum ?? 0}`;
  return `${tracker.label} ${value}`;
}

export function worldInstruction(world: WorldState) {
  if (world.timeMode !== "ai") return "";
  const trackerRows = world.trackers.map((tracker) => `- ${tracker.id}: ${tracker.label} (current ${tracker.currentValue}${tracker.maximum === undefined ? "" : `, maximum ${tracker.maximum}`})`).join("\n") || "(none)";
  return [
    "WORLD STATE (app authoritative): Return normal prose, then on its own final line exactly `<!--WORLD_STATE {json}-->`.",
    "The JSON must include a finite non-negative integer advanceSeconds on EVERY reply. Never calculate clock, date, passive time-rule changes, or final tracker values.",
    world.locationTracking ? "The JSON must include location as the player’s complete current location on EVERY reply, even if unchanged." : "Location tracking is off; omit location.",
    "trackerChanges may be [] or items of {trackerId, operation:add|subtract, value:number}; use only these stable IDs for direct story-event changes.",
    `Current fictional time: ${formatWorldTime(world) || "not displayed"}${formatWorldCalendar(world) ? `; calendar ${formatWorldCalendar(world)}` : ""}.`,
    `Current location: ${world.location || "(not set)"}.`,
    `Trackers:\n${trackerRows}`
  ].join("\n");
}

export function extractWorldMetadata(text: string): { text: string; metadata?: WorldReplyMetadata } {
  const match = text.match(/\s*<!--WORLD_STATE\s+({[\s\S]*?})\s*-->\s*$/);
  if (!match) return { text };
  try {
    const raw = JSON.parse(match[1]) as Record<string, unknown>;
    if (!Number.isFinite(raw.advanceSeconds) || Number(raw.advanceSeconds) < 0) return { text: text.slice(0, match.index).trim() };
    const trackerChanges = Array.isArray(raw.trackerChanges) ? raw.trackerChanges.filter((item): item is { trackerId: string; operation: "add" | "subtract"; value: number } => Boolean(item) && typeof item === "object" && typeof (item as Record<string, unknown>).trackerId === "string" && ((item as Record<string, unknown>).operation === "add" || (item as Record<string, unknown>).operation === "subtract") && Number.isFinite((item as Record<string, unknown>).value)) : [];
    return { text: text.slice(0, match.index).trim(), metadata: { advanceSeconds: Math.floor(Number(raw.advanceSeconds)), location: typeof raw.location === "string" ? raw.location : undefined, trackerChanges } };
  } catch { return { text: text.slice(0, match.index).trim() }; }
}

export function advanceWorldTrackers(world: WorldState, seconds: number) {
  const trackerById = new Map(world.trackers.map((tracker) => [tracker.id, { ...tracker }]));
  for (const tracker of trackerById.values()) {
    const rule = tracker.timeRule;
    if (!rule || !Number.isFinite(rule.amount) || !Number.isFinite(rule.every) || rule.every <= 0) continue;
    const delta = rule.amount * seconds / (rule.every * unitSeconds[rule.unit]);
    tracker.currentValue += rule.operation === "add" ? delta : -delta;
  }
  return { ...world, trackers: world.trackers.map((tracker) => trackerById.get(tracker.id)!) };
}

export function applyWorldReply(world: WorldState, metadata: WorldReplyMetadata) {
  const seconds = Math.max(0, Math.floor(metadata.advanceSeconds));
  const progressed = advanceWorldTrackers(world, seconds);
  const trackerById = new Map(progressed.trackers.map((tracker) => [tracker.id, { ...tracker }]));
  for (const change of metadata.trackerChanges ?? []) {
    const tracker = trackerById.get(change.trackerId);
    if (tracker && Number.isFinite(change.value)) tracker.currentValue += change.operation === "add" ? change.value : -change.value;
  }
  return { ...progressed, fictionalSeconds: world.fictionalSeconds + seconds, location: metadata.location ?? world.location, trackers: progressed.trackers.map((tracker) => trackerById.get(tracker.id)!) };
}

export function syncRealtimeWorld(world: WorldState, at = Date.now()) {
  if (world.timeMode !== "realtime") return world;
  const elapsed = Math.max(0, (at - (world.realtimeUpdatedAt ?? at)) / 1000);
  return { ...advanceWorldTrackers(world, elapsed), realtimeUpdatedAt: at };
}
