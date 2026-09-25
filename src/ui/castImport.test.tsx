import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { db } from "../data/db";
import { defaultSettings, sampleProject } from "../data/defaults";
import { CharactersPage } from "./App";

afterEach(async () => { cleanup(); vi.unstubAllGlobals(); await db.sourceFiles.clear(); await db.characters.clear(); await db.settings.clear(); });

it("imports only after clicking the button and displays the characters and summary", async () => {
  const project = sampleProject();
  await db.settings.put({ ...defaultSettings(), apiKey: "test-key", defaultModelId: "test-model" });
  const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ characters: [{ name: "Alice", bio: "Alice is a 24-year-old explorer." }] }) } }] }) });
  vi.stubGlobal("fetch", request);
  await db.sourceFiles.add({ id: "cast", projectId: project.id, name: "cast_Girls.md", textContent: "Alice is a 24-year-old explorer.", mimeType: "text/markdown", size: 40, createdAt: 1, updatedAt: 1 });
  render(<CharactersPage project={project} onOpenProfile={() => {}} />);
  expect(await db.characters.count()).toBe(0);
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Import characters from source files" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Imported 1 character from 1 cast file"));
  expect(await screen.findByText("Alice")).toBeInTheDocument();
});

it("explains which source files to upload when none match", async () => {
  render(<CharactersPage project={sampleProject()} onOpenProfile={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Import characters from source files" }));
  expect(await screen.findByRole("status")).toHaveTextContent("No cast_*.md source files found in this project");
});
