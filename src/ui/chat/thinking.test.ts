import { describe, expect, it } from "vitest";
import { thinkingCapabilitiesFor } from "./thinking";

describe("thinking capabilities", () => {
  it("keeps Aion 3.5 to its exact supported modes and high default", () => {
    expect(thinkingCapabilitiesFor({ modelId: "aion-labs/aion-3.5" })).toMatchObject({
      availableModes: ["low", "high"],
      defaultMode: "high",
      requestForMode: { low: { reasoning_effort: "low" }, high: { reasoning_effort: "high" } }
    });
  });

  it("uses Instant only when a model has no verified configurable reasoning modes", () => {
    expect(thinkingCapabilitiesFor({ modelId: "example/plain-chat" })).toEqual({
      availableModes: ["instant"], defaultMode: "instant", requestForMode: {}
    });
  });
});
