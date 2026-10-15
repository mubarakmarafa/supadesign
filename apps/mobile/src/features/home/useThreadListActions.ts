import type { ThreadMoveDestination } from "../threads/threadOrder";
import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/shell";
import { canSnooze, effectiveSnoozed } from "@supaterm/client-runtime/state/thread-snooze";
import { AuthOrchestrationOperateScope } from "@supaterm/contracts";
import * as Cause from "effect/Cause";
import * as Haptics from "expo-haptics";
import { useCallback, useRef } from "react";
import { Alert, Platform } from "react-native";

import { withThreadDismissal } from "./thread-dismissal";
import { showConfirmDialog, showTextInputDialog } from "../../components/ConfirmDialogHost";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { refreshArchivedThreadsForEnvironment } from "../archive/useArchivedThreadSnapshots";
import { pinOrderKeyBetween } from "@supaterm/client-runtime/state/thread-sort";
import { appAtomRegistry } from "../../state/atom-registry";
import { environmentServerConfigsAtom } from "../../state/server";
import { readEnvironmentScope } from "../../state/session";
import { environmentThreadShells, threadEnvironment } from "../../state/threads";
import { queuedThreadKeysAtom } from "../../state/use-thread-outbox";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  beginPendingThreadOrder,
  getPendingThreadOrder,
  threadDropBusyAtom,
} from "../../state/thread-order";
import {
  createPendingThreadOrder,
  createThreadMovePlanner,
  threadDropLifecycle,
} from "../threads/threadOrder";
import { getThreadListV2OrderedSection } from "../threads/threadListV2";
import { threadCanArchive } from "./threadArchive";
import { resolveThreadTitleRename } from "../threads/thread-title-rename";

function environmentSupportsMarkDone(environmentId: EnvironmentThreadShell["environmentId"]) {
  return appAtomRegistry.get(environmentServerConfigsAtom).has(environmentId);
}

function environmentSupportsSnooze(environmentId: EnvironmentThreadShell["environmentId"]) {
  return appAtomRegistry.get(environmentServerConfigsAtom).has(environmentId);
}

function environmentSupportsPinning(environmentId: EnvironmentThreadShell["environmentId"]) {
  return appAtomRegistry.get(environmentServerConfigsAtom).has(environmentId);
}

function environmentSupportsPinReorder(environmentId: EnvironmentThreadShell["environmentId"]) {
  return appAtomRegistry.get(environmentServerConfigsAtom).has(environmentId);
}

function environmentSupportsAutoMarkDoneOptOut(
  environmentId: EnvironmentThreadShell["environmentId"],
) {
  return appAtomRegistry.get(environmentServerConfigsAtom).has(environmentId);
}

function environmentSupportsTitleRegeneration(
  environmentId: EnvironmentThreadShell["environmentId"],
) {
  return appAtomRegistry.get(environmentServerConfigsAtom).has(environmentId);
}

type ThreadListAction = "archive" | "unarchive" | "delete" | "mark-done" | "reopen";

const ACTION_VERBS: Record<ThreadListAction, string> = {
  archive: "archived",
  unarchive: "unarchived",
  delete: "deleted",
  "mark-done": "marked as done",
  reopen: "reopened",
};

function actionFailureMessage(action: ThreadListAction, cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause);
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return `The thread could not be ${ACTION_VERBS[action]}.`;
}

function selectionHaptic(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

function actionFailureTitle(action: ThreadListAction): string {
  if (action === "archive") return "Could not archive thread";
  if (action === "unarchive") return "Could not unarchive thread";
  if (action === "mark-done") return "Could not mark thread as done";
  if (action === "reopen") return "Could not reopen thread";
  return "Could not delete thread";
}

function checkThreadOperationPermission(thread: EnvironmentThreadShell, title: string): boolean {
  if (readEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope)) return true;
  Alert.alert(title, "This connection cannot change threads.");
  return false;
}

/** Resolves to true iff the action was dispatched and succeeded. */
function useThreadActionExecutor(
  onCompleted?: (action: ThreadListAction, thread: EnvironmentThreadShell) => void,
) {
  const archiveMutation = useAtomCommand(threadEnvironment.archive, { reportFailure: false });
  const unarchiveMutation = useAtomCommand(threadEnvironment.unarchive, { reportFailure: false });
  const deleteMutation = useAtomCommand(threadEnvironment.delete, { reportFailure: false });
  const markDoneMutation = useAtomCommand(threadEnvironment.markDone, { reportFailure: false });
  const reopenMutation = useAtomCommand(threadEnvironment.reopen, { reportFailure: false });
  const inFlightThreadKeys = useRef(new Set<string>());

  const executeAction = useCallback(
    async (action: ThreadListAction, thread: EnvironmentThreadShell) => {
      if (!checkThreadOperationPermission(thread, actionFailureTitle(action))) return false;
      const key = scopedThreadKey(thread.environmentId, thread.id);
      if (inFlightThreadKeys.current.has(key)) {
        return false;
      }

      inFlightThreadKeys.current.add(key);
      selectionHaptic();
      const run = async () => {
        if (
          (action === "mark-done" || action === "reopen") &&
          !environmentSupportsMarkDone(thread.environmentId)
        ) {
          Alert.alert(
            actionFailureTitle(action),
            "This environment is still connecting. Try again once it is connected.",
          );
          return false;
        }
        // Archive keeps its original, narrower guard: never interrupt a
        // thread mid-turn.
        if (action === "archive" && !threadCanArchive(thread.runtime)) {
          Alert.alert(
            actionFailureTitle(action),
            "This thread is working. Interrupt it first, then try again.",
          );
          return false;
        }
        const result = await withThreadDismissal(
          key,
          async () =>
            action === "reopen"
              ? // reason "user" pins the thread active: auto-mark-done stays
                // suppressed until real activity clears the pin server-side.
                await reopenMutation({
                  environmentId: thread.environmentId,
                  input: { threadId: thread.id, reason: "user" },
                })
              : await (
                  action === "mark-done"
                    ? markDoneMutation
                    : action === "archive"
                      ? archiveMutation
                      : action === "unarchive"
                        ? unarchiveMutation
                        : deleteMutation
                )({
                  environmentId: thread.environmentId,
                  input: { threadId: thread.id },
                }),
          (result) => result._tag === "Success",
        );
        if (result._tag === "Failure") {
          Alert.alert(actionFailureTitle(action), actionFailureMessage(action, result.cause));
          return false;
        }
        // Done threads stay in the live shell stream; only the archive
        // lifecycle still feeds the archived-snapshot surface.
        if (action === "archive" || action === "unarchive" || action === "delete") {
          refreshArchivedThreadsForEnvironment(thread.environmentId);
        }
        onCompleted?.(action, thread);
        return true;
      };
      return run().finally(() => {
        inFlightThreadKeys.current.delete(key);
      });
    },
    [
      archiveMutation,
      deleteMutation,
      onCompleted,
      markDoneMutation,
      unarchiveMutation,
      reopenMutation,
    ],
  );

  return executeAction;
}

function useConfirmDeleteThread(
  executeAction: (action: ThreadListAction, thread: EnvironmentThreadShell) => Promise<boolean>,
) {
  return useCallback(
    (thread: EnvironmentThreadShell) => {
      if (!checkThreadOperationPermission(thread, actionFailureTitle("delete"))) return;
      const title = "Delete thread?";
      const message = `“${thread.title}” will be permanently deleted, including its terminal history.`;
      if (process.env.EXPO_OS === "ios") {
        Alert.alert(title, message, [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              void executeAction("delete", thread);
            },
          },
        ]);
        return;
      }
      showConfirmDialog({
        title,
        message,
        confirmText: "Delete",
        destructive: true,
        onConfirm: () => {
          void executeAction("delete", thread);
        },
      });
    },
    [executeAction],
  );
}

export function useThreadListActions(): {
  readonly archiveThread: (thread: EnvironmentThreadShell) => void;
  readonly confirmDeleteThread: (thread: EnvironmentThreadShell) => void;
  readonly markThreadDone: (thread: EnvironmentThreadShell) => Promise<boolean>;
  readonly snoozeThread: (thread: EnvironmentThreadShell, snoozedUntil: string) => Promise<boolean>;
  readonly unsnoozeThread: (thread: EnvironmentThreadShell) => Promise<boolean>;
  readonly reopenThread: (thread: EnvironmentThreadShell) => Promise<boolean>;
  readonly pinThread: (thread: EnvironmentThreadShell) => Promise<boolean>;
  readonly unpinThread: (thread: EnvironmentThreadShell) => Promise<boolean>;
  /** Sets per-thread automatic completion on or off. */
  readonly setThreadAutoMarkDone: (
    thread: EnvironmentThreadShell,
    enabled: boolean,
  ) => Promise<boolean>;
  readonly moveThread: (
    thread: EnvironmentThreadShell,
    direction: ThreadMoveDestination,
  ) => Promise<boolean>;
  readonly renameThread: (thread: EnvironmentThreadShell) => void;
  readonly regenerateThreadTitle: (thread: EnvironmentThreadShell) => Promise<boolean>;
} {
  const executeAction = useThreadActionExecutor();
  const snoozeMutation = useAtomCommand(threadEnvironment.snooze, { reportFailure: false });
  const unsnoozeMutation = useAtomCommand(threadEnvironment.unsnooze, { reportFailure: false });
  const pinMutation = useAtomCommand(threadEnvironment.pin, { reportFailure: false });
  const unpinMutation = useAtomCommand(threadEnvironment.unpin, { reportFailure: false });
  const setAutoMarkDoneMutation = useAtomCommand(threadEnvironment.setAutoMarkDone, {
    reportFailure: false,
  });
  const updateThreadMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const snoozeInFlightThreadKeys = useRef(new Set<string>());
  const titleRegenerationInFlightThreadKeys = useRef(new Set<string>());

  const archiveThread = useCallback(
    (thread: EnvironmentThreadShell) => {
      void executeAction("archive", thread);
    },
    [executeAction],
  );
  const markThreadDone = useCallback(
    async (thread: EnvironmentThreadShell) => (await executeAction("mark-done", thread)) === true,
    [executeAction],
  );
  const snoozeThread = useCallback(
    async (thread: EnvironmentThreadShell, snoozedUntil: string) => {
      if (!checkThreadOperationPermission(thread, "Could not snooze thread")) return false;
      const key = scopedThreadKey(thread.environmentId, thread.id);
      if (snoozeInFlightThreadKeys.current.has(key)) {
        return false;
      }
      snoozeInFlightThreadKeys.current.add(key);
      const run = async () => {
        if (!environmentSupportsSnooze(thread.environmentId)) {
          Alert.alert(
            "Could not snooze thread",
            "This environment's server does not support snoozing yet. Update the server to use Snooze.",
          );
          return false;
        }
        if (!canSnooze(thread, { now: new Date().toISOString() })) {
          Alert.alert(
            "Could not snooze thread",
            thread.hasPendingApprovals || thread.hasPendingUserInput
              ? "This thread is waiting on you. Respond to the pending request before snoozing it."
              : "This thread is still starting a turn. Try again once it's running.",
          );
          return false;
        }

        selectionHaptic();
        const result = await withThreadDismissal(
          key,
          () =>
            snoozeMutation({
              environmentId: thread.environmentId,
              input: {
                threadId: thread.id,
                snoozedUntil,
              },
            }),
          (result) => result._tag === "Success",
        );
        if (result._tag === "Failure") {
          const error = Cause.squash(result.cause);
          Alert.alert(
            "Could not snooze thread",
            error instanceof Error && error.message.trim().length > 0
              ? error.message
              : "The thread could not be snoozed.",
          );
          return false;
        }
        return true;
      };
      return run().finally(() => {
        snoozeInFlightThreadKeys.current.delete(key);
      });
    },
    [snoozeMutation],
  );
  const unsnoozeThread = useCallback(
    async (thread: EnvironmentThreadShell) => {
      if (!checkThreadOperationPermission(thread, "Could not wake thread")) return false;
      const key = scopedThreadKey(thread.environmentId, thread.id);
      if (snoozeInFlightThreadKeys.current.has(key)) {
        return false;
      }
      snoozeInFlightThreadKeys.current.add(key);
      const run = async () => {
        if (!environmentSupportsSnooze(thread.environmentId)) {
          Alert.alert(
            "Could not wake thread",
            "This environment's server does not support snoozing yet. Update the server to wake this thread.",
          );
          return false;
        }

        selectionHaptic();
        const result = await withThreadDismissal(
          key,
          () =>
            unsnoozeMutation({
              environmentId: thread.environmentId,
              input: { threadId: thread.id, reason: "user" },
            }),
          (result) => result._tag === "Success",
        );
        if (result._tag === "Failure") {
          const error = Cause.squash(result.cause);
          Alert.alert(
            "Could not wake thread",
            error instanceof Error && error.message.trim().length > 0
              ? error.message
              : "The thread could not be woken.",
          );
          return false;
        }
        return true;
      };
      return run().finally(() => {
        snoozeInFlightThreadKeys.current.delete(key);
      });
    },
    [unsnoozeMutation],
  );
  const reopenThread = useCallback(
    async (thread: EnvironmentThreadShell) => (await executeAction("reopen", thread)) === true,
    [executeAction],
  );
  const pinThread = useCallback(
    async (thread: EnvironmentThreadShell) => {
      if (!checkThreadOperationPermission(thread, "Could not pin thread")) return false;
      if (!environmentSupportsPinning(thread.environmentId)) {
        Alert.alert(
          "Could not pin thread",
          "This environment's server does not support pinning yet. Update the server to use Pin.",
        );
        return false;
      }
      selectionHaptic();
      // Same placement as web: a fresh pin takes the top of the arranged
      // run. Servers that predate reordering get the bare pin (keyless).
      let orderKey: string | undefined;
      if (environmentSupportsPinReorder(thread.environmentId)) {
        const shells = appAtomRegistry.get(environmentThreadShells.threadShellsAtom);
        let firstKey: string | null = null;
        for (const shell of shells) {
          if (shell.pinnedAt == null || shell.pinOrderKey == null) continue;
          if (firstKey === null || shell.pinOrderKey < firstKey) firstKey = shell.pinOrderKey;
        }
        orderKey = pinOrderKeyBetween(null, firstKey) ?? undefined;
      }
      const result = await pinMutation({
        environmentId: thread.environmentId,
        input: { threadId: thread.id, ...(orderKey !== undefined ? { orderKey } : {}) },
      });
      if (result._tag === "Failure") {
        const error = Cause.squash(result.cause);
        Alert.alert(
          "Could not pin thread",
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "The thread could not be pinned.",
        );
        return false;
      }
      return true;
    },
    [pinMutation],
  );
  const unpinThread = useCallback(
    async (thread: EnvironmentThreadShell) => {
      if (!checkThreadOperationPermission(thread, "Could not unpin thread")) return false;
      if (!environmentSupportsPinning(thread.environmentId)) {
        Alert.alert(
          "Could not unpin thread",
          "This environment's server does not support pinning yet. Update the server to use Pin.",
        );
        return false;
      }
      selectionHaptic();
      const result = await unpinMutation({
        environmentId: thread.environmentId,
        input: { threadId: thread.id },
      });
      if (result._tag === "Failure") {
        const error = Cause.squash(result.cause);
        Alert.alert(
          "Could not unpin thread",
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "The thread could not be unpinned.",
        );
        return false;
      }
      return true;
    },
    [unpinMutation],
  );
  const setThreadAutoMarkDone = useCallback(
    async (thread: EnvironmentThreadShell, enabled: boolean) => {
      if (!environmentSupportsAutoMarkDoneOptOut(thread.environmentId)) {
        Alert.alert(
          "Could not update auto-mark-done",
          "This environment's server does not support turning auto-mark-done off per thread yet. Update the server to use it.",
        );
        return false;
      }
      selectionHaptic();
      const result = await setAutoMarkDoneMutation({
        environmentId: thread.environmentId,
        input: { threadId: thread.id, enabled },
      });
      if (result._tag === "Failure") {
        const error = Cause.squash(result.cause);
        Alert.alert(
          "Could not update auto-mark-done",
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "The auto-mark-done setting could not be changed.",
        );
        return false;
      }
      return true;
    },
    [setAutoMarkDoneMutation],
  );
  const regenerateThreadTitle = useCallback(
    async (thread: EnvironmentThreadShell) => {
      if (!checkThreadOperationPermission(thread, "Could not regenerate title")) return false;
      const key = scopedThreadKey(thread.environmentId, thread.id);
      if (
        thread.titleRegeneration != null ||
        titleRegenerationInFlightThreadKeys.current.has(key)
      ) {
        return false;
      }
      if (!environmentSupportsTitleRegeneration(thread.environmentId)) {
        Alert.alert(
          "Could not regenerate title",
          "This environment's server does not support title regeneration yet. Update the server to regenerate thread titles.",
        );
        return false;
      }

      titleRegenerationInFlightThreadKeys.current.add(key);
      selectionHaptic();
      const run = async () => {
        const result = await updateThreadMetadata({
          environmentId: thread.environmentId,
          input: { threadId: thread.id, regenerateTitle: true },
        });
        if (result._tag === "Failure") {
          const error = Cause.squash(result.cause);
          Alert.alert(
            "Could not regenerate title",
            error instanceof Error && error.message.trim().length > 0
              ? error.message
              : "The thread title could not be regenerated.",
          );
          return false;
        }
        return true;
      };
      return run().finally(() => {
        titleRegenerationInFlightThreadKeys.current.delete(key);
      });
    },
    [updateThreadMetadata],
  );
  const renameThread = useCallback(
    (thread: EnvironmentThreadShell) => {
      const commit = (title: string) => {
        const resolution = resolveThreadTitleRename({ title, originalTitle: thread.title });
        if (resolution.action === "reject-empty") {
          Alert.alert("Could not rename thread", "Thread title cannot be empty.");
          return;
        }
        if (resolution.action === "noop") return;
        selectionHaptic();
        void updateThreadMetadata({
          environmentId: thread.environmentId,
          input: { threadId: thread.id, title: resolution.title },
        }).then((result) => {
          if (result._tag === "Success") return;
          const error = Cause.squash(result.cause);
          Alert.alert(
            "Could not rename thread",
            error instanceof Error && error.message.trim().length > 0
              ? error.message
              : "The thread could not be renamed.",
          );
        });
      };

      if (Platform.OS === "ios") {
        Alert.prompt(
          "Rename thread",
          undefined,
          (title) => commit(title ?? ""),
          "plain-text",
          thread.title,
        );
        return;
      }
      showTextInputDialog({
        title: "Rename thread",
        initialValue: thread.title,
        confirmText: "Rename",
        onConfirm: commit,
      });
    },
    [updateThreadMetadata],
  );

  // Plan against the complete section so filtering does not change a move.
  const reorderPinnedMutation = useAtomCommand(threadEnvironment.reorderPin, {
    reportFailure: false,
  });
  const moveThread = useCallback(
    async (thread: EnvironmentThreadShell, direction: ThreadMoveDestination) => {
      if (!checkThreadOperationPermission(thread, "Could not move thread")) return false;
      if (getPendingThreadOrder() !== null || appAtomRegistry.get(threadDropBusyAtom)) return false;
      const shells = appAtomRegistry.get(environmentThreadShells.threadShellsAtom);
      const current = shells.find(
        (row) => row.id === thread.id && row.environmentId === thread.environmentId,
      );
      if (!current || current.archivedAt !== null) return false;
      thread = current;
      const section =
        typeof direction === "object" && direction.section !== undefined
          ? direction.section
          : thread.pinnedAt != null
            ? "pinned"
            : "active";
      if (section === "done") {
        if (!environmentSupportsMarkDone(thread.environmentId)) return false;
        appAtomRegistry.set(threadDropBusyAtom, true);
        return markThreadDone(thread).finally(() => {
          appAtomRegistry.set(threadDropBusyAtom, false);
        });
      }
      // The inbox is time-ordered, so entering Active only changes lifecycle.
      if (section === "active") {
        const lifecycle = threadDropLifecycle(thread, section, new Date().toISOString());
        if (!lifecycle.unpin && !lifecycle.reopen && !lifecycle.unsnooze) return false;
        if (
          (lifecycle.unpin && !environmentSupportsPinning(thread.environmentId)) ||
          (lifecycle.reopen && !environmentSupportsMarkDone(thread.environmentId)) ||
          (lifecycle.unsnooze && !environmentSupportsSnooze(thread.environmentId))
        )
          return false;
        selectionHaptic();
        appAtomRegistry.set(threadDropBusyAtom, true);
        const enterActive = async () => {
          if (lifecycle.unpin && !(await unpinThread(thread))) return false;
          if (lifecycle.reopen && !(await reopenThread(thread))) return false;
          if (lifecycle.unsnooze && !(await unsnoozeThread(thread))) return false;
          return true;
        };
        return enterActive().finally(() => {
          appAtomRegistry.set(threadDropBusyAtom, false);
        });
      }
      const configs = appAtomRegistry.get(environmentServerConfigsAtom);
      const supportsReorder = (environmentId: EnvironmentThreadShell["environmentId"]) =>
        configs.has(environmentId);
      if (!supportsReorder(thread.environmentId)) {
        Alert.alert("Could not move thread", "Connect to this environment to arrange its threads.");
        return false;
      }
      const ordered = getThreadListV2OrderedSection({
        threads: shells,
        section,
        now: new Date().toISOString(),
        queuedThreadKeys: appAtomRegistry.get(queuedThreadKeysAtom),
      });
      const assignments = createThreadMovePlanner({
        allThreads: shells,
        ordered,
        section,
        reorderableEnvironmentIds: new Set(configs.keys()),
      })(scopedThreadKey(thread.environmentId, thread.id), direction);
      if (assignments === null) return false;
      const crossSection = !ordered.some(
        (row) => row.id === thread.id && row.environmentId === thread.environmentId,
      );
      if (
        crossSection &&
        (!environmentSupportsPinning(thread.environmentId) ||
          (thread.doneOverride === "done" && !environmentSupportsMarkDone(thread.environmentId)) ||
          (effectiveSnoozed(thread, { now: new Date().toISOString() }) &&
            !environmentSupportsSnooze(thread.environmentId)))
      )
        return false;
      const shellByKey = new Map(
        shells.map((shell) => [scopedThreadKey(shell.environmentId, shell.id), shell]),
      );
      for (const assignment of assignments) {
        const target = shellByKey.get(assignment.id);
        if (target && !checkThreadOperationPermission(target, "Could not move thread"))
          return false;
      }
      selectionHaptic();
      appAtomRegistry.set(threadDropBusyAtom, true);
      const pending = crossSection
        ? null
        : beginPendingThreadOrder(
            createPendingThreadOrder({
              section,
              ordered,
              movedId: scopedThreadKey(thread.environmentId, thread.id),
              direction,
              assignments,
            }),
          );
      let succeeded = false;
      const run = async () => {
        if (crossSection) {
          const orderKey = assignments.find(
            ({ id }) => id === scopedThreadKey(thread.environmentId, thread.id),
          )?.orderKey;
          const result = await pinMutation({
            environmentId: thread.environmentId,
            input: { threadId: thread.id, ...(orderKey === undefined ? {} : { orderKey }) },
          });
          if (result._tag === "Failure") {
            Alert.alert("Could not pin thread", String(Cause.squash(result.cause)));
            return false;
          }
        }
        for (const assignment of assignments) {
          if (
            crossSection &&
            thread.pinnedAt == null &&
            assignment.id === scopedThreadKey(thread.environmentId, thread.id)
          )
            continue;
          if (pending !== null && !pending.isPending()) return false;
          const target = shellByKey.get(assignment.id);
          if (target === undefined) continue;
          if (!checkThreadOperationPermission(target, "Could not move thread")) return false;
          const result = await reorderPinnedMutation({
            environmentId: target.environmentId,
            input: { threadId: target.id, orderKey: assignment.orderKey },
          });
          if (result._tag === "Failure") {
            const error = Cause.squash(result.cause);
            Alert.alert(
              "Could not move thread",
              error instanceof Error && error.message.trim().length > 0
                ? error.message
                : "The thread could not be moved.",
            );
            // Keep confirmed keys when a later environment rejects its write.
            return false;
          }
        }
        succeeded = true;
        pending?.complete();
        return true;
      };
      return run().finally(() => {
        if (!succeeded) pending?.cancel();
        appAtomRegistry.set(threadDropBusyAtom, false);
      });
    },
    [markThreadDone, reorderPinnedMutation, pinMutation, unpinThread, reopenThread, unsnoozeThread],
  );

  const confirmDeleteThread = useConfirmDeleteThread(executeAction);

  return {
    archiveThread,
    confirmDeleteThread,
    markThreadDone,
    snoozeThread,
    unsnoozeThread,
    reopenThread,
    pinThread,
    unpinThread,
    setThreadAutoMarkDone,
    moveThread,
    renameThread,
    regenerateThreadTitle,
  };
}

export function useArchivedThreadListActions(
  onCompleted: (thread: EnvironmentThreadShell) => void,
): {
  readonly unarchiveThread: (thread: EnvironmentThreadShell) => void;
  readonly confirmDeleteThread: (thread: EnvironmentThreadShell) => void;
} {
  const handleCompleted = useCallback(
    (_action: ThreadListAction, thread: EnvironmentThreadShell) => {
      onCompleted(thread);
    },
    [onCompleted],
  );
  const executeAction = useThreadActionExecutor(handleCompleted);
  const unarchiveThread = useCallback(
    (thread: EnvironmentThreadShell) => {
      void executeAction("unarchive", thread);
    },
    [executeAction],
  );
  const confirmDeleteThread = useConfirmDeleteThread(executeAction);

  return { unarchiveThread, confirmDeleteThread };
}
