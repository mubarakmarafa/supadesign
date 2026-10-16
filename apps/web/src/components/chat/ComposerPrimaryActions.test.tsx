import { DEFAULT_RESOLVED_KEYBINDINGS } from "@supaterm/shared/keybindings";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const stageArtworkState = vi.hoisted(() => ({
  mode: "none" as "artwork" | "none",
  visible: false,
}));

vi.mock("~/hooks/useSettings", () => ({
  useEnvironmentIdentificationMode: () => stageArtworkState.mode,
}));
vi.mock("../SidebarStageBackdrop", () => ({
  StageBackdropButtonArt: () => "stage-production",
  useSidebarStageBackdrop: (enabled = true) => enabled && stageArtworkState.visible,
}));
vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ render, children }: { render: ReactNode; children: ReactNode }) =>
    createElement("div", null, render, children),
  TooltipPopup: ({ children }: { children: ReactNode }) => children,
  TooltipShortcutLabel: ({ children }: { children: ReactNode }) => children,
}));

import { ComposerPrimaryActions } from "./ComposerPrimaryActions";

function renderPendingActions(isRunning: boolean) {
  return renderToStaticMarkup(
    createElement(ComposerPrimaryActions, {
      compact: true,
      keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
      canOperateThread: true,
      canQueueMessage: true,
      pendingAction: {
        questionIndex: 0,
        isLastQuestion: true,
        canAdvance: true,
        isResponding: false,
        isComplete: true,
      },
      isRunning,
      canInterrupt: isRunning,
      isSendBusy: false,
      sendDisabledReason: null,
      isConnecting: false,
      isEnvironmentUnavailable: false,
      isPreparingWorktree: false,
      hasSendableContent: false,
      onPreviousPendingQuestion: () => {},
      onInterrupt: () => {},
    }),
  );
}

function renderRunningActions(hasSendableContent: boolean) {
  return renderToStaticMarkup(
    createElement(ComposerPrimaryActions, {
      compact: true,
      keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
      canOperateThread: true,
      canQueueMessage: true,
      pendingAction: null,
      isRunning: true,
      canInterrupt: true,
      followUpBehavior: "queue",
      isSendBusy: false,
      sendDisabledReason: null,
      isConnecting: false,
      isEnvironmentUnavailable: false,
      isPreparingWorktree: false,
      hasSendableContent,
      onPreviousPendingQuestion: () => {},
      onInterrupt: () => {},
    }),
  );
}

function renderSendButton(
  sendDisabledReason: string | null = null,
  overrides: Partial<ComponentProps<typeof ComposerPrimaryActions>> = {},
) {
  return renderToStaticMarkup(
    createElement(ComposerPrimaryActions, {
      compact: true,
      keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
      canOperateThread: true,
      canQueueMessage: true,
      pendingAction: null,
      isRunning: false,
      canInterrupt: false,
      isSendBusy: false,
      sendDisabledReason,
      isConnecting: false,
      isEnvironmentUnavailable: false,
      isPreparingWorktree: false,
      hasSendableContent: true,
      onPreviousPendingQuestion: () => {},
      onInterrupt: () => {},
      ...overrides,
    }),
  );
}

afterEach(() => {
  stageArtworkState.mode = "none";
  stageArtworkState.visible = false;
});

describe("ComposerPrimaryActions", () => {
  it("disables and labels the send button while feedback is uploading", () => {
    const markup = renderSendButton("Sending feedback");

    expect(markup).toContain("disabled");
    expect(markup).toContain('aria-label="Sending feedback"');
  });

  it("offers Stop generation while a running turn is waiting for user input", () => {
    expect(renderPendingActions(true)).toContain('aria-label="Stop generation"');
  });

  it("does not offer Stop generation for a pending request without a running turn", () => {
    expect(renderPendingActions(false)).not.toContain('aria-label="Stop generation"');
  });

  it("renders stage artwork inside the send button when artwork identification is active", () => {
    stageArtworkState.mode = "artwork";
    stageArtworkState.visible = true;

    const markup = renderSendButton();

    expect(markup).toContain("stage-production");
  });

  it("hides stage artwork when artwork identification is inactive", () => {
    stageArtworkState.visible = true;

    const markup = renderSendButton();

    expect(markup).not.toContain("stage-production");
  });

  it("lists the background send for a new thread", () => {
    const markup = renderSendButton(null, { isDraftThread: true });

    expect(markup).toContain("Send in background");
    expect(markup).toContain("New line");
  });

  it("lists sending into a new thread from an existing thread", () => {
    const markup = renderSendButton(null, { sendShortcut: "mod-enter" });

    expect(markup).toContain("Send and start new thread");
    expect(markup).toContain("New line");
  });

  it("renders a queue action alongside stop while running with a sendable draft", () => {
    const markup = renderRunningActions(true);

    expect(markup).toContain('aria-label="Stop generation"');
    expect(markup).toContain('aria-label="Queue message"');
    expect(markup).toContain('type="submit"');
  });

  it("keeps stop as the only action while running with an empty composer", () => {
    const markup = renderRunningActions(false);

    expect(markup).toContain('aria-label="Stop generation"');
    expect(markup).not.toContain('aria-label="Queue message"');
  });
});
