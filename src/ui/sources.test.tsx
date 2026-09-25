import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { db } from "../data/db";
import { sampleProject } from "../data/defaults";
import { SourceFilesSection } from "./App";

afterEach(async () => { cleanup(); vi.unstubAllGlobals(); await db.sourceFiles.clear(); await db.settings.clear(); });

it("uploads a source without requesting or queuing a card", async () => {
  const request = vi.fn(); vi.stubGlobal("fetch", request);
  const project = sampleProject();
  const { container } = render(<SourceFilesSection project={project} />);
  const file = new File(["Original lore"], "lore.MD", { type: "text/markdown" });
  Object.defineProperty(file, "text", { value: async () => "Original lore" });
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
  await screen.findByText("lore.MD");
  const files = await db.sourceFiles.toArray();
  expect(files[0].textContent).toBe("Original lore");
  expect(request).not.toHaveBeenCalled();
});
