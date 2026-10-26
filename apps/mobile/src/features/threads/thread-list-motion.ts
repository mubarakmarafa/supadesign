const MAX_CHANGED_ROWS = 20;
export const THREAD_LIST_MOTION_DURATION = 220;

export type ThreadListMotionItem = {
  readonly key: string;
  readonly expanded?: boolean;
};

export function shouldAnimateThreadList(input: {
  readonly previousItems: ReadonlyArray<ThreadListMotionItem>;
  readonly items: ReadonlyArray<ThreadListMotionItem>;
  readonly previousScope: string;
  readonly scope: string;
  readonly searching: boolean;
  readonly previousDoneLimit: number;
  readonly doneLimit: number;
}) {
  if (
    input.searching ||
    input.previousScope !== input.scope ||
    input.previousItems.length === 0 ||
    input.items.length === 0
  ) {
    return false;
  }
  if (
    input.items.length === input.previousItems.length &&
    input.items.every((item, index) => item.key === input.previousItems[index]?.key)
  ) {
    return false;
  }
  if (input.doneLimit > input.previousDoneLimit) {
    return true;
  }
  const previous = new Map(input.previousItems.map((item) => [item.key, item.expanded]));
  for (const item of input.items) {
    const previousExpanded = previous.get(item.key);
    if (
      previousExpanded !== undefined &&
      item.expanded !== undefined &&
      previousExpanded !== item.expanded
    ) {
      return true;
    }
  }
  const next = new Set(input.items.map((item) => item.key));
  let changed = 0;
  for (const key of previous.keys()) if (!next.has(key)) changed++;
  for (const key of next) if (!previous.has(key)) changed++;
  return changed <= MAX_CHANGED_ROWS;
}
