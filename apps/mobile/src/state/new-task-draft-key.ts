const NEW_TASK_DRAFT_PREFIX = "new-task:";

/** Every new-task draft key: `new-task:<draftId>`. */
export function newTaskDraftKey(draftId: string): string {
  return `${NEW_TASK_DRAFT_PREFIX}${draftId}`;
}

export function isNewTaskDraftKey(draftKey: string): boolean {
  return draftKey.startsWith(NEW_TASK_DRAFT_PREFIX);
}

/**
 * The draft a rejected queued task's content is restored into. The outbox
 * drain writes it and the thread screen's "Edit task" action opens it, so both
 * sides derive the key here rather than rebuilding the string.
 */
export function restoredNewTaskDraftKey(messageId: string): string {
  return newTaskDraftKey(`restored-${messageId}`);
}
