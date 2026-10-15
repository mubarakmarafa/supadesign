import { create } from "zustand";

/**
 * Where the user was on each project board this session, so returning from a
 * card's thread puts them back at the same scroll and the same focused card.
 * Not persisted: a fresh launch starts at the top of every board.
 */
export interface BoardViewState {
  readonly scrollLeft: number;
  readonly columnScrollTop: Readonly<Record<string, number>>;
  readonly focusedCardId: string | null;
  /** The Done column shows its archived cards. */
  readonly doneExpanded: boolean;
  /** The archive was loaded once this session; its count stays live after collapsing. */
  readonly archiveRequested: boolean;
}

const EMPTY_VIEW: BoardViewState = {
  scrollLeft: 0,
  columnScrollTop: {},
  focusedCardId: null,
  doneExpanded: false,
  archiveRequested: false,
};

interface BoardViewStore {
  readonly byProjectKey: Readonly<Record<string, BoardViewState>>;
  update: (projectKey: string, patch: Partial<BoardViewState>) => void;
  setColumnScrollTop: (projectKey: string, columnId: string, scrollTop: number) => void;
}

export const useBoardViewStore = create<BoardViewStore>((set) => ({
  byProjectKey: {},
  update: (projectKey, patch) =>
    set((state) => ({
      byProjectKey: {
        ...state.byProjectKey,
        [projectKey]: { ...(state.byProjectKey[projectKey] ?? EMPTY_VIEW), ...patch },
      },
    })),
  setColumnScrollTop: (projectKey, columnId, scrollTop) =>
    set((state) => {
      const current = state.byProjectKey[projectKey] ?? EMPTY_VIEW;
      return {
        byProjectKey: {
          ...state.byProjectKey,
          [projectKey]: {
            ...current,
            columnScrollTop: { ...current.columnScrollTop, [columnId]: scrollTop },
          },
        },
      };
    }),
}));

export function readBoardView(projectKey: string): BoardViewState {
  return useBoardViewStore.getState().byProjectKey[projectKey] ?? EMPTY_VIEW;
}

/** Subscribe to one field, so scroll writes do not re-render the board. */
export function useBoardViewField<K extends keyof BoardViewState>(
  projectKey: string,
  key: K,
): BoardViewState[K] {
  return useBoardViewStore((state) => (state.byProjectKey[projectKey] ?? EMPTY_VIEW)[key]);
}
