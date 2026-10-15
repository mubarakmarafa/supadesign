import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useMemo, useState } from "react";
import {
  buildPendingNewTasks,
  freezeOpenDraftTask,
  type OpenDraftTask,
  type PendingNewTask,
} from "./pending-new-tasks-model";
import { flattenQueuedThreadMessages } from "./thread-outbox-model";
import { composerDraftsAtom } from "./use-composer-drafts";
import { useThreadOutboxMessages } from "./use-thread-outbox";

export type {
  PendingDraftTask,
  PendingNewTask,
  PendingQueuedTask,
} from "./pending-new-tasks-model";

export const openNewTaskDraftKeyAtom = Atom.make<string | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:open-new-task-draft-key"),
);

export function usePendingNewTasks(): ReadonlyArray<PendingNewTask> {
  const queuedMessagesByThreadKey = useThreadOutboxMessages();
  const drafts = useAtomValue(composerDraftsAtom);
  const openDraftKey = useAtomValue(openNewTaskDraftKeyAtom);
  const tasks = useMemo(
    () =>
      buildPendingNewTasks({
        queuedMessages: flattenQueuedThreadMessages(queuedMessagesByThreadKey),
        drafts,
      }),
    [queuedMessagesByThreadKey, drafts],
  );
  const [openDraft, setOpenDraft] = useState<OpenDraftTask | null>(null);
  if ((openDraft?.draftKey ?? null) !== openDraftKey) {
    setOpenDraft(
      openDraftKey === null
        ? null
        : {
            draftKey: openDraftKey,
            task: tasks.find((task) => task.kind === "draft" && task.draftKey === openDraftKey),
          },
    );
  }
  return useMemo(() => freezeOpenDraftTask(tasks, openDraft), [tasks, openDraft]);
}
