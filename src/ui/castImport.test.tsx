import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { db } from "../data/db";
import { defaultSettings, sampleProject } from "../data/defaults";
import { CharactersPage } from "./App";

afterEach(async () => { cleanup(); vi.unstubAllGlobals(); await db.sourceFiles.clear(); await db.characters.clear(); await db.settings.clear(); });

it("opens an unchecked file picker and processes only the chosen file after explicit import", async () => {
  const project = sampleProject();
  await db.settings.put({ ...defaultSettings(), apiKey: "test-key", defaultModelId: "test-model" });
  const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ characters: [{ name: "Alice", age: ["24"], gender: [], personality: [], misc: ["explorer"], bio: ["Alice is a 24-year-old explorer."] }] }) } }] }) });
  vi.stubGlobal("fetch", request);
  await db.sourceFiles.add({ id: "cast", projectId: project.id, name: "cast_Girls.md", textContent: "Alice is a 24-year-old explorer.", mimeType: "text/markdown", size: 40, createdAt: 1, updatedAt: 1 });
  await db.sourceFiles.add({ id: "other-cast", projectId: project.id, name: "cast_Unity.md", textContent: "Beth is a pilot.", mimeType: "text/markdown", size: 20, createdAt: 1, updatedAt: 1 });
  render(<CharactersPage project={project} onOpenProfile={() => {}} />);
  expect(await db.characters.count()).toBe(0);
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Import characters from source files" }));
  const girls = await screen.findByRole("checkbox", { name: "cast_Girls.md" });
  expect(girls).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "cast_Unity.md" })).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Import selected files (0)" })).toBeDisabled();
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(girls);
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Import selected files (1)" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Imported 1 character from 1 cast file"));
  expect(await screen.findByText("Alice")).toBeInTheDocument();
  expect(request).toHaveBeenCalledTimes(1);
  expect(JSON.parse(request.mock.calls[0][1].body).messages[1].content).toContain("cast_Girls.md");
  fireEvent.click(screen.getByRole("button", { name: "Import characters from source files" }));
  expect(await screen.findByRole("checkbox", { name: "cast_Girls.md" })).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(request).toHaveBeenCalledTimes(1);
});

it("explains which source files to upload when none match", async () => {
  render(<CharactersPage project={sampleProject()} onOpenProfile={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Import characters from source files" }));
  expect(await screen.findByRole("status")).toHaveTextContent("No cast_*.md source files found in this project");
});
