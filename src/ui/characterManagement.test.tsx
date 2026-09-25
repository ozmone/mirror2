import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { db } from "../data/db";
import { sampleProject } from "../data/defaults";
import { CharactersPage } from "./App";

afterEach(async () => {
  cleanup(); vi.useRealTimers(); vi.unstubAllGlobals();
  await db.characters.clear();
});

async function library() {
  const project = sampleProject();
  await db.characters.bulkAdd(["Alice", "Beth", "Cara"].map((name) => ({
    id: name, projectId: project.id, name, normalisedName: name.toLowerCase(),
    age: "", gender: "", personality: "", misc: "", bio: "", statsEnabled: false,
    str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8, createdAt: 1, updatedAt: 1
  })));
  const open = vi.fn();
  render(<CharactersPage project={project} onOpenProfile={open} />);
  const alice = await screen.findByRole("button", { name: "Alice" });
  vi.stubGlobal("PointerEvent", MouseEvent);
  return { alice, open };
}

it("holds to select, suppresses the release click, and deletes only selected characters", async () => {
  const { alice, open } = await library();
  vi.useFakeTimers();
  fireEvent.pointerDown(alice, { button: 0, clientX: 20, clientY: 20 });
  act(() => vi.advanceTimersByTime(499));
  expect(alice).not.toHaveAttribute("aria-pressed");
  act(() => vi.advanceTimersByTime(1));
  fireEvent.pointerUp(alice);
  fireEvent.click(alice, { detail: 1 });
  expect(alice).toHaveAttribute("aria-pressed", "true");
  expect(open).not.toHaveBeenCalled();
  vi.useRealTimers();
  fireEvent.click(screen.getByRole("button", { name: "Beth" }));
  const confirm = vi.fn().mockReturnValue(false);
  vi.stubGlobal("confirm", confirm);
  fireEvent.click(screen.getByRole("button", { name: "Delete selected (2)" }));
  expect(await db.characters.count()).toBe(3);
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Delete selected (2)" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Alice" })).not.toBeInTheDocument());
  expect((await db.characters.toArray()).map((c) => c.name)).toEqual(["Cara"]);
});

it("keeps normal clicks and cancels holds on scrolling, release, and pointer cancellation", async () => {
  const { alice, open } = await library();
  fireEvent.click(alice);
  expect(open).toHaveBeenCalledWith("Alice");
  vi.useFakeTimers();
  for (const cancel of [() => fireEvent.pointerMove(alice, { clientX: 40, clientY: 20 }), () => fireEvent.pointerUp(alice), () => fireEvent.pointerCancel(alice)]) {
    fireEvent.pointerDown(alice, { button: 0, clientX: 20, clientY: 20 });
    cancel();
    act(() => vi.advanceTimersByTime(600));
    expect(alice).not.toHaveAttribute("aria-pressed");
  }
  fireEvent.click(screen.getByRole("button", { name: "Manage characters" }));
  fireEvent.click(screen.getByRole("button", { name: "Select all" }));
  expect(screen.getByRole("button", { name: "Delete selected (3)" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(alice).not.toHaveAttribute("aria-pressed");
});
