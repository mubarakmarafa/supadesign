import { expect, it } from "vite-plus/test";
import { resolveThreadListV2RowStatusLabel } from "./thread-list-row-status";

const state = {
  environmentConnected: true,
  isUnread: false,
  goalActive: false,
  mutedClassName: "text-drawer-foreground-muted",
};

it.each([
  ["working", "Working"],
  ["waiting", "Waiting"],
  ["approval", "Approval"],
  ["input", "Input"],
  ["failed", "Failed"],
  ["limited", "Limited"],
  ["ready", undefined],
] as const)("replaces cached %s status until the environment connects", (status, label) => {
  expect(
    resolveThreadListV2RowStatusLabel({
      ...state,
      status,
      environmentConnected: false,
      isUnread: true,
      goalActive: true,
    }),
  ).toEqual({ label: "Connecting", className: state.mutedClassName });
  expect(resolveThreadListV2RowStatusLabel({ ...state, status })?.label).toBe(label);
});

it("restores goal and unread completion labels when connected", () => {
  expect(
    resolveThreadListV2RowStatusLabel({ ...state, status: "working", goalActive: true })?.label,
  ).toBe("Goal");
  expect(
    resolveThreadListV2RowStatusLabel({ ...state, status: "ready", isUnread: true })?.label,
  ).toBe("Ready");
});

it.each(["text-drawer-foreground-muted", "text-foreground-muted"])(
  "uses %s for waiting rows",
  (mutedClassName) => {
    const waiting = resolveThreadListV2RowStatusLabel({
      ...state,
      status: "waiting",
      mutedClassName,
    });

    expect(waiting?.className).toBe(mutedClassName);
  },
);
