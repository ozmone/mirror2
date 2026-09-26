import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { db } from "../../data/db";
import { useAttachmentImages } from "./useAttachmentImages";

afterEach(async () => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); await db.attachments.clear(); });

function urls() {
  let count = 0;
  const create = vi.fn(() => `blob:test-${++count}`);
  const revoke = vi.fn();
  vi.stubGlobal("URL", class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
  return { create, revoke };
}
async function image(id: string, ownerId: string) {
  await db.attachments.put({ id, ownerId, ownerType: "character", mimeType: "image/png", size: 1, blob: new Blob(["x"]), createdAt: 1, updatedAt: 1 });
}

it("releases current URLs on refresh, owner changes, and unmount", async () => {
  const { create, revoke } = urls();
  await image("a", "alice"); await image("b", "beth");
  const hook = renderHook(({ owner }) => useAttachmentImages("character", owner), { initialProps: { owner: "alice" } });
  await waitFor(() => expect(hook.result.current.images[0]?.id).toBe("a"));
  await act(() => hook.result.current.refresh());
  expect(revoke).toHaveBeenCalledWith("blob:test-1");
  hook.rerender({ owner: "beth" });
  await waitFor(() => expect(hook.result.current.images[0]?.id).toBe("b"));
  expect(revoke).toHaveBeenCalledWith("blob:test-2");
  hook.unmount();
  expect(revoke).toHaveBeenCalledWith("blob:test-3");
  expect(revoke).toHaveBeenCalledTimes(create.mock.calls.length);
});

it("does not allocate URLs for a query that resolves after unmount", async () => {
  const { create } = urls();
  const original = db.attachments.where.bind(db.attachments);
  let finish!: (rows: unknown[]) => void;
  vi.spyOn(db.attachments, "where").mockImplementation(((index: string) => {
    const clause = original(index);
    const equals = clause.equals.bind(clause);
    clause.equals = ((value: string[]) => {
      const collection = equals(value);
      collection.toArray = (() => new Promise((resolve) => { finish = resolve; })) as typeof collection.toArray;
      return collection;
    }) as typeof clause.equals;
    return clause;
  }) as typeof db.attachments.where);
  const hook = renderHook(() => useAttachmentImages("character", "alice"));
  hook.unmount();
  await act(async () => { finish([{ id: "a", mimeType: "image/png", blob: new Blob(["x"]) }]); });
  expect(create).not.toHaveBeenCalled();
});
