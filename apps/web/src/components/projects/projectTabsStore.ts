import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../../lib/storage";
import {
  closeProjectTab,
  openProjectTab,
  pruneProjectTabs,
  type ProjectTab,
} from "./projectTabs.logic";

interface ProjectTabsState {
  /** The projects open as tabs on this device, in tab order. */
  readonly tabs: ReadonlyArray<ProjectTab>;
  /** The tab shown last, which the app reopens on launch. */
  readonly last: ProjectTab | null;
  /** Opens the tab if needed and makes it the last one shown. */
  readonly show: (tab: ProjectTab) => void;
  /** Closes a tab and returns the one to show instead, or null for the grid. */
  readonly close: (tab: ProjectTab) => ProjectTab | null;
  readonly prune: (exists: (tab: ProjectTab) => boolean) => void;
}

export const useProjectTabsStore = create<ProjectTabsState>()(
  persist(
    (set, get) => ({
      tabs: [],
      last: null,
      show: (tab) => set((state) => ({ tabs: openProjectTab(state.tabs, tab), last: tab })),
      close: (tab) => {
        const result = closeProjectTab(get().tabs, tab);
        set({ tabs: result.tabs, last: result.next });
        return result.next;
      },
      prune: (exists) =>
        set((state) => {
          const tabs = pruneProjectTabs(state.tabs, exists);
          if (tabs === state.tabs) return state;
          const last = state.last !== null && exists(state.last) ? state.last : (tabs[0] ?? null);
          return { tabs, last };
        }),
    }),
    {
      name: "supadesign:project-tabs:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ tabs: state.tabs, last: state.last }),
    },
  ),
);
