import type { ModelLibraryEntry } from "../../types";

export const thinkingModes = ["instant", "low", "medium", "high"] as const;
export type ThinkingMode = typeof thinkingModes[number];

export type ThinkingCapabilities = {
  availableModes: ThinkingMode[];
  defaultMode: ThinkingMode;
  requestForMode: Partial<Record<ThinkingMode, Record<string, unknown>>>;
};

const aion35: ThinkingCapabilities = {
  availableModes: ["low", "high"],
  defaultMode: "high",
  requestForMode: {
    low: { reasoning_effort: "low" },
    high: { reasoning_effort: "high" }
  }
};

const aion30: ThinkingCapabilities = {
  availableModes: ["instant", "low", "medium", "high"],
  defaultMode: "medium",
  requestForMode: {
    instant: { reasoning_effort: "none" },
    low: { reasoning_effort: "low" },
    medium: { reasoning_effort: "medium" },
    high: { reasoning_effort: "high" }
  }
};

/**
 * This intentionally only exposes levels whose exact API value is known. It is
 * safer to offer a model's ordinary Instant mode than to guess that every
 * OpenRouter reasoning model accepts the same effort names.
 */
export function thinkingCapabilitiesFor(model?: Pick<ModelLibraryEntry, "modelId" | "thinkingModes" | "defaultThinkingMode">): ThinkingCapabilities {
  if (model?.thinkingModes?.length && model.defaultThinkingMode) {
    return {
      availableModes: model.thinkingModes,
      defaultMode: model.defaultThinkingMode,
      requestForMode: Object.fromEntries(model.thinkingModes.map((mode) => [mode,
        mode === "instant" ? { reasoning: { enabled: false } } : { reasoning: { enabled: true, effort: mode } }
      ])) as ThinkingCapabilities["requestForMode"]
    };
  }
  const id = model?.modelId.toLowerCase() ?? "";
  if (id === "aion-labs/aion-3.5" || id === "aion-labs/aion-3.5-mini") return aion35;
  if (id === "aion-labs/aion-2.0" || id === "aion-labs/aion-3.0" || id === "aion-labs/aion-3.0-mini") return aion30;
  return { availableModes: ["instant"], defaultMode: "instant", requestForMode: {} };
}

export function thinkingModeLabel(mode: ThinkingMode) {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}
