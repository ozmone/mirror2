import { describe, expect, it } from "vitest";
import { applyWorldReply, defaultWorldState, extractWorldMetadata, formatWorldCalendar } from "./world";

describe("world state", () => {
  it("advances trackers continuously and then applies direct changes", () => {
    const world = defaultWorldState();
    world.timeMode = "ai";
    world.trackers = [{ id: "hunger", label: "Hunger", currentValue: 0, display: "percentage", visibleInStatusBar: true, orderIndex: 0, timeRule: { operation: "add", amount: 50, every: 3, unit: "hours" } }];
    const next = applyWorldReply(world, { advanceSeconds: 3600, trackerChanges: [{ trackerId: "hunger", operation: "subtract", value: 2 }] });
    expect(next.fictionalSeconds).toBe(3600);
    expect(next.trackers[0].currentValue).toBeCloseTo(50 / 3 - 2);
  });

  it("keeps structured world metadata out of chat prose", () => {
    const result = extractWorldMetadata("The door slides open.\n<!--WORLD_STATE {\"advanceSeconds\":20,\"location\":\"Deck 3\",\"trackerChanges\":[]}-->");
    expect(result.text).toBe("The door slides open.");
    expect(result.metadata?.advanceSeconds).toBe(20);
  });

  it("formats calendar prefix and suffix literally", () => {
    const world = defaultWorldState();
    world.calendarEnabled = true;
    world.calendar = { year: 132, month: 1, day: 1, yearPrefix: "SY", yearSuffix: "" };
    expect(formatWorldCalendar(world)).toBe("SY132 · 1/1");
  });
});
