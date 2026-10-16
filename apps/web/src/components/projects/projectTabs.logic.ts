export interface ProjectTab {
  readonly environmentId: string;
  readonly projectId: string;
}

const sameTab = (a: ProjectTab, b: ProjectTab) =>
  a.environmentId === b.environmentId && a.projectId === b.projectId;

/** Adds `tab` after the existing tabs, unless it is already open. */
export function openProjectTab(tabs: ReadonlyArray<ProjectTab>, tab: ProjectTab) {
  return tabs.some((existing) => sameTab(existing, tab)) ? tabs : [...tabs, tab];
}

/**
 * Closes `tab`. `next` is the tab to show instead when the closed one was in
 * view: its right neighbor, else its left one, else null for the grid.
 */
export function closeProjectTab(
  tabs: ReadonlyArray<ProjectTab>,
  tab: ProjectTab,
): { readonly tabs: ReadonlyArray<ProjectTab>; readonly next: ProjectTab | null } {
  const index = tabs.findIndex((existing) => sameTab(existing, tab));
  if (index === -1) return { tabs, next: null };
  const remaining = tabs.toSpliced(index, 1);
  return { tabs: remaining, next: remaining[index] ?? remaining[index - 1] ?? null };
}

/** Drops tabs whose project is gone, once the projects have loaded. */
export function pruneProjectTabs(
  tabs: ReadonlyArray<ProjectTab>,
  exists: (tab: ProjectTab) => boolean,
) {
  const kept = tabs.filter(exists);
  return kept.length === tabs.length ? tabs : kept;
}
