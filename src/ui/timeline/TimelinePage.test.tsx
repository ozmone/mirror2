import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { db } from "../../data/db";
import { defaultSettings, sampleProject } from "../../data/defaults";
import { addTimelineEntry, formatTimelineContinuity, timelineEntries } from "../../data/timeline";
import { TimelinePage } from "./TimelinePage";

afterEach(async () => { cleanup(); await Promise.all(db.tables.map((table) => table.clear())); });

it("keeps unchecked entries visible and persists their AI exclusion across remounts", async () => {
  const project = sampleProject();
  await db.projects.put(project);
  await addTimelineEntry(project.id, "Arrival", "Mara entered the observatory.");
  const props = { project, settings: defaultSettings(), selectedModelId: "", onOpenChat: vi.fn() };
  const view = render(<TimelinePage {...props} />);
  const checkbox = await screen.findByRole("checkbox", { name: "Include Arrival in AI context" });
  expect(checkbox).toBeChecked();
  fireEvent.click(checkbox);
  await waitFor(() => expect(checkbox).not.toBeChecked());
  expect(screen.getByText("Arrival:").closest("li")).toHaveClass("timeline-entry-excluded");
  expect(formatTimelineContinuity(await timelineEntries(project.id))).not.toContain("Mara");
  view.unmount();
  render(<TimelinePage {...props} />);
  const restored = await screen.findByRole("checkbox", { name: "Include Arrival in AI context" });
  expect(restored).not.toBeChecked();
  fireEvent.click(restored);
  await waitFor(() => expect(restored).toBeChecked());
  expect(formatTimelineContinuity(await timelineEntries(project.id))).toContain("Arrival: Mara");
});

it("approves and denies suggestions without sending pending content to the AI", async () => {
  const project = sampleProject();
  await db.projects.put(project);
  await addTimelineEntry(project.id, "Discovery", "The journal was found.", db, true);
  await addTimelineEntry(project.id, "Departure", "They left.", db, true);
  render(<TimelinePage project={project} settings={defaultSettings()} selectedModelId="" onOpenChat={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Approve Discovery" }));
  await screen.findByRole("checkbox", { name: "Include Discovery in AI context" });
  expect(formatTimelineContinuity(await timelineEntries(project.id))).toContain("The journal was found.");
  expect(formatTimelineContinuity(await timelineEntries(project.id))).not.toContain("They left.");
  fireEvent.click(screen.getByRole("button", { name: "Deny Departure" }));
  await screen.findByText("Suggestion denied.");
  expect(await timelineEntries(project.id)).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Undo removal" }));
  await screen.findByRole("button", { name: "Approve Departure" });
  expect(formatTimelineContinuity(await timelineEntries(project.id))).not.toContain("They left.");
});

it("adds, edits, searches, reorders, removes, and restores entries without timestamps", async () => {
  const project = sampleProject();
  await db.projects.put(project);
  await addTimelineEntry(project.id, "Arrival", "Mara entered the observatory.");
  render(<TimelinePage project={project} settings={defaultSettings()} selectedModelId="" onOpenChat={vi.fn()} />);
  await screen.findByText("Arrival:");
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Discovery:" } });
  fireEvent.change(screen.getByLabelText("Content"), { target: { value: "The journal was missing." } });
  fireEvent.click(screen.getByRole("button", { name: "Save entry" }));
  await screen.findByText("Discovery:");
  let discovery = screen.getByText("Discovery:").closest("li")!;
  fireEvent.click(within(discovery).getByLabelText("Actions for Discovery"));
  fireEvent.click(within(discovery).getByRole("button", { name: "Earlier" }));
  await waitFor(() => expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Discovery:"));
  fireEvent.click(within(discovery).getByRole("button", { name: "Edit" }));
  fireEvent.change(screen.getByLabelText("Content"), { target: { value: "Ellis found the journal." } });
  fireEvent.click(screen.getByRole("button", { name: "Save entry" }));
  await waitFor(() => expect(screen.queryByLabelText("Content")).not.toBeInTheDocument());
  await screen.findByText(/Ellis found the journal/);
  fireEvent.change(screen.getByRole("textbox", { name: "Search Timeline continuity" }), { target: { value: "Ellis" } });
  expect(screen.queryByText("Arrival:")).not.toBeInTheDocument();
  discovery = (await screen.findByText("Discovery:")).closest("li")!;
  fireEvent.click(within(discovery).getByRole("button", { name: "Delete" }));
  await screen.findByText("Entry deleted.");
  fireEvent.click(screen.getByRole("button", { name: "Undo removal" }));
  await screen.findByText("Discovery:");
  expect((await timelineEntries(project.id))[0].body).toBe("Ellis found the journal.");
});
