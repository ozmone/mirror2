import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Message } from "../../types";
import { VirtualMessageList } from "./MessageList";

const list = vi.hoisted(() => ({ scrollToItem: vi.fn(), onScroll: undefined as undefined | ((event: { scrollOffset: number; scrollUpdateWasRequested: boolean; scrollDirection: string }) => void) }));
vi.mock("react-window", async () => {
  const React = await import("react");
  return { VariableSizeList: React.forwardRef((props: { outerRef: React.Ref<HTMLDivElement>; onScroll: typeof list.onScroll }, ref) => {
    list.onScroll = props.onScroll;
    React.useImperativeHandle(ref, () => ({ scrollToItem: list.scrollToItem, resetAfterIndex: vi.fn() }));
    return <div ref={props.outerRef} />;
  }) };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("follows estimated-height corrections, respects scrolling up, and resets on chat switch", () => {
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ height: 600 } as DOMRect);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(3000);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 1));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  const message = { id: "reply", body: "Reply", updatedAt: 1 } as Message;
  const props = { projectId: "project", chatId: "one", messages: [message], bubbleMode: "bubbles" as const,
    onExpand: vi.fn(), onEdit: vi.fn(), onResend: vi.fn(), onInventoryUpdateAction: vi.fn(),
    onBeginDeltaBrief: vi.fn(), onAvoidDeltaBrief: vi.fn(), deltaLocked: false,
    onOpenChatSettings: vi.fn(), onRefresh: vi.fn() };
  const view = render(<VirtualMessageList {...props} />);
  act(() => vi.runOnlyPendingTimers());
  list.scrollToItem.mockClear();
  act(() => list.onScroll?.({ scrollOffset: 0, scrollUpdateWasRequested: true, scrollDirection: "backward" }));
  view.rerender(<VirtualMessageList {...props} messages={[{ ...message, body: "Longer reply" }]} />);
  act(() => vi.runOnlyPendingTimers());
  expect(list.scrollToItem).toHaveBeenCalledWith(0, "end");
  list.scrollToItem.mockClear();
  act(() => list.onScroll?.({ scrollOffset: 0, scrollUpdateWasRequested: false, scrollDirection: "backward" }));
  view.rerender(<VirtualMessageList {...props} messages={[{ ...message, body: "Even longer reply" }]} />);
  act(() => vi.runOnlyPendingTimers());
  expect(list.scrollToItem).not.toHaveBeenCalled();
  view.rerender(<VirtualMessageList {...props} chatId="two" />);
  act(() => vi.runOnlyPendingTimers());
  expect(list.scrollToItem).toHaveBeenCalledWith(0, "end");
});
