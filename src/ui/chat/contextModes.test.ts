import { expect, it } from "vitest";
import { defaultSettings } from "../../data/defaults";
import { charactersModeFor, sourceFilesModeFor } from "./contextModes";

it("preserves lookup for old false or missing library preferences", () => {
  for (const legacy of [false, undefined]) {
    const settings = { ...defaultSettings(), includeSourceFiles: legacy, includeCharacters: legacy };
    expect(sourceFilesModeFor(settings)).toBe("lookup");
    expect(charactersModeFor(settings)).toBe("lookup");
  }
});

it("restores legacy send-all preferences", () => {
  const settings = { ...defaultSettings(), includeSourceFiles: true, includeCharacters: true };
  expect(sourceFilesModeFor(settings)).toBe("all");
  expect(charactersModeFor(settings)).toBe("all");
});

it("preserves every explicit new mode regardless of legacy preferences", () => {
  for (const mode of ["all", "lookup", "none"] as const) {
    for (const legacy of [true, false, undefined]) {
      const settings = { ...defaultSettings(), includeSourceFiles: legacy, includeCharacters: legacy, sourceFilesMode: mode, charactersMode: mode };
      expect(sourceFilesModeFor(settings)).toBe(mode);
      expect(charactersModeFor(settings)).toBe(mode);
    }
  }
});
