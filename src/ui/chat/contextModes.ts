import type { AppSettings } from "../../types";

// Legacy false meant "do not send the whole library"; lookup was still enabled.
// Only an explicit new mode can disable lookup entirely.
export function sourceFilesModeFor(settings: AppSettings) {
  return settings.sourceFilesMode ?? (settings.includeSourceFiles ? "all" : "lookup");
}

export function charactersModeFor(settings: AppSettings) {
  return settings.charactersMode ?? (settings.includeCharacters ? "all" : "lookup");
}
